import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Investigation } from "../../src/contracts/types";
import { CompareControl } from "../../src/features/compare/CompareControl";
import type { HostIntake } from "../../src/features/compare/host";
import { place } from "../../src/features/compare/placement";
import { registerCompare } from "../../src/features/compare/register";
import { createCompareStore, type CompareStore } from "../../src/features/compare/store";
import { analysisApi } from "../../src/features/investigation/analysisApi";
import { createHarness, flush, openManorBefore, type Harness } from "./storeHarness";

// Gate I4 (intake design, Compare additions): `compareWithIntake(kind)` and the two idle panel buttons for the newer snapshot.
// The intake service is a fake here: `src/features/compare` imports nothing from `src/features/import`.

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type OpenResult = Awaited<ReturnType<HostIntake["open"]>>;

function fakeIntake(kinds: HostIntake["kinds"], answer: (kind: "local" | "github") => OpenResult | Promise<OpenResult>): HostIntake & { calls: { purpose: string; kind: string }[] } {
  const calls: { purpose: string; kind: string }[] = [];
  return {
    kinds,
    calls,
    open(args) {
      calls.push(args);
      return Promise.resolve(answer(args.kind));
    },
  };
}

function storeWith(h: Harness, intake?: HostIntake): CompareStore {
  const cs = createCompareStore({ store: h.store, analysisApi, analysisClient: h.analysisClient, loadSample: h.loadSample, base: h.base, place, ...(intake === undefined ? {} : { intake }) });
  registerCompare(h.registry, cs);
  return cs;
}

function preserved(h: Harness) {
  const s = h.store.getState();
  return { investigation: s.investigation, sourceText: s.sourceText, selection: s.selection, routeFilter: s.routeFilter, camera: s.camera, expandedWings: s.expandedWings, layout: s.layout };
}

/** A newer snapshot that differs from `before` by one module hash. */
function newerOf(before: Investigation, label: string): Investigation {
  const changed = before.modules[0]?.id as string;
  return { ...before, sourceLabel: label, modules: before.modules.map((m) => (m.id === changed ? { ...m, sourceHash: "e".repeat(64) } : m)) };
}

describe("compareWithIntake (gate I4, 9.1, 9.2)", () => {
  it("without an intake service there are no kinds and the action does nothing", async () => {
    const h = createHarness();
    await openManorBefore(h);
    const cs = storeWith(h);
    expect(cs.intakeKinds).toBeUndefined();
    await cs.actions.compareWithIntake("local");
    expect(cs.getState().status).toBe("idle");
  });

  it("ok: opens the dialog in after mode, then compares the open investigation with the result using the current layout key", async () => {
    const h = createHarness();
    const before = await openManorBefore(h);
    const newer = newerOf(before, "local:newer");
    const sourceText = new Map([["src/a.ts", "export {};"]]);
    const intake = fakeIntake(["local", "github"], () => ({ ok: true, investigation: newer, sourceText, label: "local:newer" }));
    const cs = storeWith(h, intake);
    expect(cs.intakeKinds).toEqual(["local", "github"]);
    await cs.actions.compareWithIntake("local");
    expect(intake.calls).toEqual([{ purpose: "after", kind: "local" }]);
    const state = cs.getState();
    expect(state.status).toBe("active");
    expect(state.before?.investigation).toBe(before);
    expect(state.after?.label).toBe("local:newer");
    expect(state.after?.sourceText).toBe(sourceText);
    expect(h.store.getState().investigation).toBe(newer);
    expect(h.store.getState().status.startsWith("Comparison ready:")).toBe(true);
  });

  it("failed: writes the message and the unchanged sentence, stays idle and leaves the view state alone", async () => {
    const h = createHarness();
    await openManorBefore(h);
    h.store.actions.select({ kind: "module", id: "src/orders/checkout.ts" }, { from: "dom" });
    const kept = preserved(h);
    const intake = fakeIntake(["local"], () => ({ ok: false, reason: "failed", message: "The folder could not be analyzed (disk unplugged)." }));
    const cs = storeWith(h, intake);
    await cs.actions.compareWithIntake("local");
    expect(h.store.getState().status).toBe("The folder could not be analyzed (disk unplugged). The current investigation is unchanged.");
    expect(cs.getState().status).toBe("idle");
    expect(preserved(h)).toEqual(kept);
  });

  it("cancelled: writes nothing", async () => {
    const h = createHarness();
    await openManorBefore(h);
    const before = h.store.getState().status;
    const kept = preserved(h);
    const intake = fakeIntake(["github"], () => ({ ok: false, reason: "cancelled" }));
    const cs = storeWith(h, intake);
    await cs.actions.compareWithIntake("github");
    expect(intake.calls).toEqual([{ purpose: "after", kind: "github" }]);
    expect(h.store.getState().status).toBe(before);
    expect(cs.getState().status).toBe("idle");
    expect(preserved(h)).toEqual(kept);
  });

  it("a comparison that cannot be made resolves, never rejects, and shows its own message", async () => {
    const h = createHarness();
    const before = await openManorBefore(h);
    const bad = { ...before, sourceLabel: "local:x", schemaVersion: 2 } as unknown as Investigation;
    const intake = fakeIntake(["local"], () => ({ ok: true, investigation: bad, sourceText: null, label: "local:x" }));
    const cs = storeWith(h, intake);
    await expect(cs.actions.compareWithIntake("local")).resolves.toBeUndefined();
    expect(h.store.getState().status).toBe("The snapshots cannot be compared: schema version 2 is not 1. The current investigation is unchanged.");
    expect(cs.getState().status).toBe("idle");
  });
});

async function mount(h: Harness): Promise<void> {
  render(
    <div role="toolbar" aria-label="Investigation tools">
      <CompareControl store={h.store} />
    </div>,
  );
  await act(async () => {
    await flush();
  });
}

const panel = () => screen.getByRole("region", { name: "Compare revisions" });
const labels = () => within(panel()).getAllByRole("button").map((b) => b.textContent);

describe("the idle panel buttons for the newer snapshot (9.1)", () => {
  it("on manor/before: Revised manor, then the local button, then the GitHub button when kinds has it", async () => {
    const h = createHarness();
    await openManorBefore(h);
    storeWith(h, fakeIntake(["local", "github"], () => ({ ok: false, reason: "cancelled" })));
    await mount(h);
    fireEvent.click(screen.getByRole("button", { name: "Compare revisions" }));
    expect(labels()).toEqual(["Revised manor", "Local folder as the newer snapshot", "GitHub repository as the newer snapshot"]);
  });

  it("with only the local kind there is no GitHub button, and on another investigation Bundled manor pair comes first", async () => {
    const h = createHarness();
    const open = await openManorBefore(h);
    h.store.actions.openInvestigation({ ...open, sourceLabel: "annex" }, null, { demo: false });
    storeWith(h, fakeIntake(["local"], () => ({ ok: false, reason: "cancelled" })));
    await mount(h);
    fireEvent.click(screen.getByRole("button", { name: "Compare revisions" }));
    expect(labels()).toEqual(["Bundled manor pair", "Local folder as the newer snapshot"]);
  });

  it("without an intake service the panel keeps its one button and no word about folders or GitHub", async () => {
    const h = createHarness();
    await openManorBefore(h);
    storeWith(h);
    await mount(h);
    fireEvent.click(screen.getByRole("button", { name: "Compare revisions" }));
    expect(labels()).toEqual(["Revised manor"]);
    expect(within(panel()).queryByText(/folder|GitHub/i)).toBeNull();
  });

  it("a click calls compareWithIntake with its kind, and a second click while the dialog is pending asks the service nothing more", async () => {
    const h = createHarness();
    await openManorBefore(h);
    let finish: (result: OpenResult) => void = () => undefined;
    const intake = fakeIntake(["local", "github"], () => new Promise<OpenResult>((resolve) => (finish = resolve)));
    storeWith(h, intake);
    await mount(h);
    fireEvent.click(screen.getByRole("button", { name: "Compare revisions" }));
    fireEvent.click(screen.getByRole("button", { name: "GitHub repository as the newer snapshot" }));
    expect(intake.calls).toEqual([{ purpose: "after", kind: "github" }]);
    fireEvent.click(screen.getByRole("button", { name: "Local folder as the newer snapshot" }));
    expect(intake.calls).toHaveLength(1);
    await act(async () => {
      finish({ ok: false, reason: "cancelled" });
      await flush();
    });
    fireEvent.click(screen.getByRole("button", { name: "Local folder as the newer snapshot" }));
    expect(intake.calls.map((call) => call.kind)).toEqual(["github", "local"]);
  });
});
