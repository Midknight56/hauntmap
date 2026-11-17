import { act, cleanup, render, screen } from "@testing-library/react";
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App, createCompareServices } from "../../src/components/App";
import { MapView } from "../../src/components/MapView";
import { analysisApi } from "../../src/features/investigation/analysisApi";
import { place } from "../../src/features/compare/placement";
import { createCompareStore, type CompareStore } from "../../src/features/compare/store";
import { styleOf } from "../../src/features/compare/style";
import type { ComparisonStyle } from "../../src/scene/compare";
import type { SceneInit, SceneOptions } from "../../src/scene/types";
import { createFakeScene, type FakeScene } from "../ui/fakeScene";
import { nodeSha256 } from "./loadFolder";
import { createHarness, flush, openManorBefore, type Harness } from "./storeHarness";

afterEach(cleanup);

async function activeComparison(): Promise<{ h: Harness; cs: CompareStore }> {
  const h = createHarness();
  await openManorBefore(h);
  const cs = createCompareStore({ store: h.store, analysisApi, analysisClient: h.analysisClient, loadSample: h.loadSample, base: h.base, place, sha256Hex: nodeSha256 });
  await cs.actions.compareWithSample();
  expect(cs.getState().status).toBe("active");
  return { h, cs };
}

/** The `comparison` object MapView takes under gate G2: the style of the compare store and its subscription. */
function recording(cs: CompareStore) {
  const seen: (ComparisonStyle | null)[] = [];
  const comparison = {
    get: (): ComparisonStyle | null => styleOf(cs.getState()),
    subscribe: (listener: () => void) =>
      cs.subscribe(() => {
        seen.push(styleOf(cs.getState()));
        listener();
      }),
  };
  return { comparison, seen };
}

async function mount(h: Harness, comparison?: { get(): unknown; subscribe(listener: () => void): () => void }) {
  const scenes: FakeScene[] = [];
  const createScene = vi.fn<(options: SceneOptions) => Promise<SceneInit>>(async () => {
    const fake = createFakeScene();
    scenes.push(fake);
    return { ok: true, scene: fake.handle };
  });
  render(<MapView store={h.store} createScene={createScene} comparison={comparison} />);
  await act(async () => {
    await flush();
  });
  const scene = scenes[0];
  if (scene === undefined) throw new Error("no scene");
  return scene;
}

describe("toggling the shown snapshot (4.7, P10a)", () => {
  it("twenty toggles: zero setLayout calls, zero layout requests, the same layout object, and the right shown side each time", async () => {
    const { h, cs } = await activeComparison();
    const scene = await mount(h);
    const { comparison, seen } = recording(cs);
    const off = comparison.subscribe(() => undefined);
    const layout = h.store.getState().layout;
    const setLayouts = scene.calls.filter((c) => c.name === "setLayout").length;
    const requests = h.layoutClient.requests.length;
    for (let i = 0; i < 20; i++) {
      const side = i % 2 === 0 ? "before" : "after";
      act(() => cs.actions.show(side));
      expect(comparison.get()?.shown).toBe(side);
      expect(seen.at(-1)?.shown).toBe(side);
    }
    off();
    expect(scene.calls.filter((c) => c.name === "setLayout").length).toBe(setLayouts);
    expect(h.layoutClient.requests.length).toBe(requests);
    expect(h.store.getState().layout).toBe(layout);
  });

  it("P10a: any sequence of toggles keeps the layout object and sends no request", async () => {
    const { h, cs } = await activeComparison();
    const layout = h.store.getState().layout;
    const requests = h.layoutClient.requests.length;
    fc.assert(
      fc.property(fc.array(fc.constantFrom("before" as const, "after" as const), { maxLength: 30 }), (sides) => {
        for (const side of sides) cs.actions.show(side);
        return h.store.getState().layout === layout && h.layoutClient.requests.length === requests;
      }),
      { numRuns: 200 },
    );
  });

  it("styleOf is null unless a comparison is active, and carries the five lists and both labels", async () => {
    const { cs } = await activeComparison();
    const style = styleOf(cs.getState());
    expect(style).toMatchObject({
      comparisonStyleVersion: 1,
      shown: "after",
      changedModules: ["src/notifications/receipt.ts", "src/orders/checkout.ts"],
      removedModules: [],
      addedModules: [],
      earlierLabel: "manor/before",
      newerLabel: "manor/after",
    });
    expect(style?.removedRelationIds).toHaveLength(1);
    expect(style?.addedRelationIds).toHaveLength(1);
    cs.actions.end();
    expect(styleOf(cs.getState())).toBeNull();
  });
});

describe("the comparison prop of MapView (gate G2)", () => {
  it("puts comparison into every setStyleState call and sends the right shown side on each of twenty toggles, with no setLayout", async () => {
    const { h, cs } = await activeComparison();
    const { comparison } = recording(cs);
    const scene = await mount(h, comparison);
    const styleCalls = () => scene.calls.filter((c) => c.name === "setStyleState").map((c) => c.args[0] as { comparison?: ComparisonStyle | null });
    expect(styleCalls().length).toBeGreaterThan(0);
    expect(styleCalls().every((s) => "comparison" in s)).toBe(true);
    const setLayouts = scene.calls.filter((c) => c.name === "setLayout").length;
    for (let i = 0; i < 20; i++) {
      const side = i % 2 === 0 ? "before" : "after";
      const before = styleCalls().length;
      act(() => cs.actions.show(side));
      expect(styleCalls().length).toBeGreaterThan(before);
      expect(styleCalls().at(-1)?.comparison?.shown).toBe(side);
    }
    expect(scene.calls.filter((c) => c.name === "setLayout").length).toBe(setLayouts);
    act(() => cs.actions.end());
    expect(styleCalls().at(-1)?.comparison).toBeNull();
  });

  it("without the prop MapView sends no comparison key, as before", async () => {
    const { h } = await activeComparison();
    const scene = await mount(h);
    const calls = scene.calls.filter((c) => c.name === "setStyleState").map((c) => c.args[0] as object);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.some((s) => "comparison" in s)).toBe(false);
  });
});

describe("the app wiring (1.4, 6.1, 6.7)", () => {
  it("createCompareServices registers the control, the handoff and the legend, and the App draws the comparison", async () => {
    const h = createHarness();
    const compareStore = createCompareServices({ store: h.store, registry: h.registry, analysisClient: h.analysisClient, base: h.base, loadSample: h.loadSample, sha256Hex: nodeSha256 });
    expect(h.registry.getControl("compare")).not.toBeNull();
    expect(h.registry.getHandoff("compare")).not.toBeNull();
    const scenes: FakeScene[] = [];
    const createScene = vi.fn(async (): Promise<SceneInit> => {
      const fake = createFakeScene();
      scenes.push(fake);
      return { ok: true, scene: fake.handle };
    });
    await openManorBefore(h);
    render(<App services={{ store: h.store, registry: h.registry, analysisClient: h.analysisClient, base: h.base, createScene, compareStore }} />);
    await act(async () => {
      await flush();
    });
    expect(screenButton("Compare revisions")).toBeTruthy();
    await act(async () => {
      await compareStore.actions.compareWithSample();
    });
    const last = scenes[0]?.lastStyleState as { comparison?: ComparisonStyle | null } | null;
    expect(last?.comparison?.shown).toBe("after");
    expect(h.store.getState().status).toMatch(/^Comparison ready: 1 removed, 1 added, 2 changed modules/);
    act(() => h.store.actions.restart());
    expect(compareStore.getState().status).toBe("idle");
    expect(compareStore.getState().before).toBeNull();
  });
});

function screenButton(name: string): HTMLElement {
  return screen.getByRole("button", { name });
}