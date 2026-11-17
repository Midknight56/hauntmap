import { describe, expect, it } from "vitest";
import type { Investigation } from "../../src/contracts/types";
import { analysisApi } from "../../src/features/investigation/analysisApi";
import { callCompareHandoff } from "../../src/features/investigation/handoffs";
import { LEGEND_ENTRIES } from "../../src/features/compare/legend";
import { itemLabel } from "../../src/features/compare/labels";
import { place } from "../../src/features/compare/placement";
import { getCompareStore, registerCompare } from "../../src/features/compare/register";
import { createCompareStore } from "../../src/features/compare/store";
import { loadFixture } from "./expected";
import { createHarness, openManorBefore, type Harness } from "./storeHarness";

function registered(h: Harness) {
  const cs = createCompareStore({ store: h.store, analysisApi, analysisClient: h.analysisClient, loadSample: h.loadSample, base: h.base, place });
  registerCompare(h.registry, cs);
  return cs;
}

describe("legend entries (5.3)", () => {
  it("are the three concepts of 5.3", () => {
    expect(LEGEND_ENTRIES).toEqual([
      { concept: "Changed source", costume: "amber lamp" },
      { concept: "Removed in the newer snapshot", costume: "ghost outline" },
      { concept: "Added in the newer snapshot", costume: "green doorway" },
    ]);
  });

  it("appear in the registry only while a comparison is active", async () => {
    const h = createHarness();
    await openManorBefore(h);
    const cs = registered(h);
    expect(h.registry.legendEntries()).toEqual([]);
    await cs.actions.compareWithSample();
    expect(h.registry.legendEntries()).toEqual(LEGEND_ENTRIES);
    cs.actions.end();
    expect(h.registry.legendEntries()).toEqual([]);
  });
});

describe("registration (1.4, 10.6)", () => {
  it("registers the compare control and handoff and makes the store reachable to the control", () => {
    const h = createHarness();
    const cs = registered(h);
    expect(h.registry.getControl("compare")).not.toBeNull();
    expect(h.registry.getHandoff("compare")).not.toBeNull();
    expect(h.registry.getControl("export")).toBeNull();
    expect(getCompareStore()).toBe(cs);
  });

  it("the handoff with { sample: \"manor/after\" } resolves when the comparison is active", async () => {
    const h = createHarness();
    await openManorBefore(h);
    const cs = registered(h);
    const outcome = await callCompareHandoff(h.store, h.registry, { sample: "manor/after" });
    expect(outcome).toBe("done");
    expect(cs.getState().status).toBe("active");
  });

  it("the handoff with an investigation compares it without a source map", async () => {
    const h = createHarness();
    const before = await openManorBefore(h);
    const cs = registered(h);
    const live: Investigation = { ...before, sourceLabel: "live:samples/manor" };
    const handoff = h.registry.getHandoff("compare") as (args: { before: Investigation; after: Investigation; layoutKey: string | null }) => Promise<void>;
    await handoff({ before, after: live, layoutKey: h.store.getState().layout?.layoutKey ?? null });
    expect(cs.getState().after?.label).toBe("live:samples/manor");
    expect(cs.getState().after?.sourceText).toBeNull();
    expect(cs.getState().detail?.identical).toBe(true);
  });

  it("a failed handoff rejects with the shown message and writes no second message", async () => {
    const h = createHarness();
    const before = await openManorBefore(h);
    registered(h);
    const messages: string[] = [];
    const setStatus = h.store.actions.setStatus;
    h.store.actions.setStatus = (m) => {
      messages.push(m);
      setStatus(m);
    };
    const bad = { ...before, schemaVersion: 7 } as unknown as Investigation;
    const handoff = h.registry.getHandoff("compare") as (args: { before: Investigation; after: Investigation; layoutKey: string | null }) => Promise<void>;
    const shown = "The snapshots cannot be compared: schema version 7 is not 1. The current investigation is unchanged.";
    await expect(handoff({ before, after: bad, layoutKey: null })).rejects.toThrow(shown);
    expect(messages.at(-1)).toBe(shown);
    const count = messages.length;
    expect(await callCompareHandoff(h.store, h.registry, bad)).toBe("failed");
    expect(messages.slice(count).filter((m) => !m.startsWith("Comparing "))).toEqual([shown]);
    expect(h.store.getState().status).toBe(shown);
  });
});

describe("item labels (7.2)", () => {
  it("words relations, boundaries and modules as 7.2 says", () => {
    const { before, after } = loadFixture("boundary-change");
    const local = after.imports.find((r) => r.resolution === "local");
    const missing = before.imports.find((r) => r.resolution === "unresolved");
    if (local === undefined || missing === undefined) throw new Error("fixture changed");
    expect(itemLabel(local, null)).toBe("src/app.ts imports src/ghosts/present.ts \u00b7 import \u00b7 value");
    expect(itemLabel(missing, null)).toBe('src/app.ts \u2192 "./ghosts/missing" \u00b7 unresolved');
    const detail = {
      detailVersion: 1 as const,
      common: [],
      occurrenceCounts: { "src/a.ts": { before: 2, after: 1 }, "src/r.ts": { before: 4, after: 4 } },
      relationChangesByModule: { "src/r.ts": { removed: 1, added: 1 } },
      optionsDiffer: [],
      parseFailed: [],
      identical: false,
    };
    expect(itemLabel("src/a.ts", detail)).toBe("src/a.ts \u00b7 import statements 2 \u2192 1");
    expect(itemLabel("src/r.ts", detail)).toBe("src/r.ts \u00b7 import statements 4 \u2192 4 \u00b7 1 relations removed, 1 added");
    expect(itemLabel("src/other.ts", detail)).toBe("src/other.ts");
  });
});
