import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ANALYSIS_OPTIONS } from "../../src/analysis";
import type { Investigation } from "../../src/contracts/types";
import { analysisApi } from "../../src/features/investigation/analysisApi";
import { acquireSnapshot } from "../../src/features/compare/sources";
import { createCompareStore, type CompareStore } from "../../src/features/compare/store";
import { place } from "../../src/features/compare/placement";
import { relationIdFor } from "./ids";
import { loadFixture } from "./expected";
import { simpleInvestigation } from "./generators";
import { REPO } from "./loadFolder";
import { AnalysisCancelled, AnalysisFailed, createHarness, flush, layoutSettled, openManorBefore, type Harness } from "./storeHarness";

const READY = "Comparison ready: 1 removed, 1 added, 2 changed modules; loops 1 \u2192 0. Showing the newer snapshot.";
const RECEIPT_CHECKOUT = relationIdFor("src/notifications/receipt.ts", "src/orders/checkout.ts", "import", "value");
const RECEIPT_SUMMARY = relationIdFor("src/notifications/receipt.ts", "src/orders/summary.ts", "import", "value");

function compareStoreFor(h: Harness): CompareStore {
  return createCompareStore({
    store: h.store,
    analysisApi,
    analysisClient: h.analysisClient,
    loadSample: h.loadSample,
    base: h.base,
    place,
  });
}

/** The parts of the view state a failed comparison must leave as they were (I11). */
function preserved(h: Harness) {
  const s = h.store.getState();
  return { investigation: s.investigation, sourceText: s.sourceText, selection: s.selection, routeFilter: s.routeFilter, camera: s.camera, expandedWings: s.expandedWings, layout: s.layout };
}

async function openFixtureSide(h: Harness, inv: Investigation, expand: readonly string[] = []): Promise<void> {
  h.store.actions.openInvestigation(inv, null, { demo: false });
  await layoutSettled(h.store);
  for (const wing of expand) {
    h.store.actions.expandWing(wing);
    await layoutSettled(h.store);
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("acquisition (1.2, 1.4, 1.6)", () => {
  it("Revised manor: one sources.json request, analyzed with the earlier options, compared at run time", async () => {
    const h = createHarness();
    await openManorBefore(h);
    h.store.actions.setPreset("type-inclusive");
    await layoutSettled(h.store);
    const cs = compareStoreFor(h);
    const urlsBefore = h.fetcher.urls.length;
    await cs.actions.compareWithSample();
    expect(h.fetcher.urls.slice(urlsBefore)).toEqual(["/demo/manor/after/sources.json"]);
    expect(h.analysisClient.calls.at(-1)).toEqual({ rootLabel: "manor/after", options: DEFAULT_ANALYSIS_OPTIONS, fileCount: 40 });
    const state = cs.getState();
    expect(state.status).toBe("active");
    expect(state.shown).toBe("after");
    expect(state.before?.label).toBe("manor/before");
    expect(state.after?.label).toBe("manor/after");
    expect(state.result?.removedRelations.map((r) => r.relationId)).toEqual([RECEIPT_CHECKOUT]);
    expect(state.result?.addedRelations.map((r) => r.relationId)).toEqual([RECEIPT_SUMMARY]);
    expect(state.detail?.optionsDiffer).toEqual([]);
    expect(state.after?.sourceText?.get("src/notifications/receipt.ts")).toContain("summarizeOrder");
  });

  it("the handoff path takes the given live snapshot with no source map and does not re-analyze the earlier one", async () => {
    const h = createHarness();
    const before = await openManorBefore(h);
    const sourceText = h.store.getState().sourceText;
    const cs = compareStoreFor(h);
    const calls = h.analysisClient.calls.length;
    const changed = before.modules[0]?.id as string;
    const live: Investigation = { ...before, sourceLabel: "live:haunts/manor", modules: before.modules.map((m) => (m.id === changed ? { ...m, sourceHash: "d".repeat(64) } : m)) };
    await cs.actions.compareWith({ kind: "investigation", snapshot: { label: live.sourceLabel, investigation: live, sourceText: null } }, h.store.getState().layout?.layoutKey ?? null);
    expect(h.analysisClient.calls.length).toBe(calls);
    const state = cs.getState();
    expect(state.before?.investigation).toBe(before);
    expect(state.before?.sourceText).toBe(sourceText);
    expect(state.after?.sourceText).toBeNull();
    expect(state.after?.label).toBe("live:haunts/manor");
    expect(h.store.getState().investigation).toBe(live);
    expect(h.store.getState().sourceText).toBeNull();
    expect(state.result?.changedModules).toEqual([changed]);
  });

  it("an earlier snapshot that is not the open investigation has no source map (1.4)", async () => {
    const h = createHarness();
    const open = await openManorBefore(h);
    const cs = compareStoreFor(h);
    const other: Investigation = { ...open, sourceLabel: "other" };
    await cs.actions.compareWith({ kind: "investigation", snapshot: { label: "live:x", investigation: open, sourceText: null } }, null, other);
    expect(cs.getState().before?.investigation).toBe(other);
    expect(cs.getState().before?.sourceText).toBeNull();
  });

  it("acquireSnapshot analyzes the sample with the given options and builds the source map from the files", async () => {
    const h = createHarness();
    const options = { ...DEFAULT_ANALYSIS_OPTIONS, maxFiles: 999 };
    const out = await acquireSnapshot({ kind: "sample", id: "manor/after" }, { analysisClient: h.analysisClient, loadSample: h.loadSample, base: h.base }, options);
    if (!out.ok) throw new Error(out.message);
    expect(out.snapshot.label).toBe("manor/after");
    expect(out.snapshot.investigation.options).toEqual(options);
    expect(out.snapshot.sourceText?.size).toBe(40);
  });
});

describe("the bundled pair path (1.3, 10.1)", () => {
  it("opens manor/before with src/orders expanded, waits for its layout and compares it with manor/after", async () => {
    const h = createHarness();
    h.store.actions.openInvestigation(loadFixture("comment-shift").before, null, { demo: false });
    await layoutSettled(h.store);
    const cs = compareStoreFor(h);
    await cs.actions.compareWithPair();
    expect(h.fetcher.urls).toEqual(["/demo/manor/before/sources.json", "/demo/manor/after/sources.json"]);
    expect(cs.getState().status).toBe("active");
    expect(cs.getState().before?.label).toBe("manor/before");
    expect(h.store.getState().expandedWings).toEqual(["src/orders"]);
    expect(h.store.getState().status).toBe(READY);
    expect(cs.getState().layoutPath).toBe("extended");
  });

  it("a failing manor/after leaves manor/before open with its own layout and says so", async () => {
    const h = createHarness();
    const cs = compareStoreFor(h);
    h.fetcher.failWith("manor/after", 500);
    await cs.actions.compareWithPair();
    expect(h.store.getState().investigation?.sourceLabel).toBe("manor/before");
    expect(h.store.getState().layoutStatus).toBe("idle");
    expect(h.store.getState().status).toBe("The revised manor sample could not be loaded (500). manor/before stays open.");
    expect(cs.getState().status).toBe("idle");
  });

  it("a failing manor/before shows the fleet's 1.6 message and keeps the previous investigation", async () => {
    const h = createHarness();
    const previous = loadFixture("comment-shift").before;
    await openFixtureSide(h, previous);
    const cs = compareStoreFor(h);
    h.fetcher.failWith("manor/before", 503);
    await cs.actions.compareWithPair();
    expect(h.store.getState().investigation).toBe(previous);
    expect(h.store.getState().status).toBe("The manor sample could not be loaded (503). Reload the page.");
    expect(cs.getState().status).toBe("idle");
  });

  it("a rejected analysis of manor/before shows the fleet's 1.10 message and keeps the previous investigation", async () => {
    const h = createHarness();
    const previous = loadFixture("comment-shift").before;
    await openFixtureSide(h, previous);
    const cs = compareStoreFor(h);
    h.analysisClient.rejectNext(new AnalysisFailed("worker crashed"));
    await cs.actions.compareWithPair();
    expect(h.store.getState().investigation).toBe(previous);
    expect(h.store.getState().status).toBe("The manor sample could not be analyzed (worker crashed). Reload the page.");
    expect(cs.getState().status).toBe("idle");
  });

  it("a failed layout of manor/before stops the comparison and keeps the fleet's message", async () => {
    const h = createHarness();
    const cs = compareStoreFor(h);
    h.layoutClient.failNext("engine exploded");
    await cs.actions.compareWithPair();
    expect(h.store.getState().layoutStatus).toBe("failed");
    expect(h.store.getState().status).toBe("The map layout did not finish (engine exploded). The Evidence view has the full investigation.");
    expect(cs.getState().status).toBe("idle");
    expect(h.fetcher.urls).toEqual(["/demo/manor/before/sources.json"]);
  });
});

describe("busy guard and preservation (1.7, I11)", () => {
  it("ignores a second activation while busy, returns the pending promise and touches the fleet store only through setStatus", async () => {
    const h = createHarness();
    await openManorBefore(h);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = async (id: "manor/before" | "manor/after" | "annex", base: string) => {
      await gate;
      return h.loadSample(id, base);
    };
    const cs = createCompareStore({ store: h.store, analysisApi, analysisClient: h.analysisClient, loadSample: slow, base: h.base, place });
    const kept = preserved(h);
    const first = cs.actions.compareWithSample();
    await flush();
    expect(cs.getState().status).toBe("acquiring");
    expect(h.store.getState().status).toBe("Comparing manor/before with manor/after\u2026");
    const second = cs.actions.compareWith({ kind: "sample", id: "manor/after" }, null);
    expect(second).toBe(cs.actions.compareWith({ kind: "sample", id: "manor/after" }, null));
    expect(preserved(h)).toEqual(kept);
    expect(preserved(h).layout).toBe(kept.layout);
    release();
    await first;
    await second;
    expect(h.fetcher.urls.filter((u) => u.endsWith("manor/after/sources.json"))).toHaveLength(1);
    expect(cs.getState().status).toBe("active");
  });
});

describe("failures (10.1, 10.2, 10.4, 10.7, 10.8)", () => {
  it("10.1 the sample request fails: the exact message, idle, and the view state deep-equal", async () => {
    const h = createHarness();
    await openManorBefore(h);
    h.store.actions.select({ kind: "module", id: "src/orders/checkout.ts" }, { from: "dom" });
    h.store.actions.setCamera({ x: 12, y: 34, zoom: 1.5 });
    const cs = compareStoreFor(h);
    cs.actions.openPanel();
    const kept = preserved(h);
    h.fetcher.failWith("manor/after", 500);
    await cs.actions.compareWithSample();
    expect(h.store.getState().status).toBe("The revised manor sample could not be loaded (500). The current investigation is unchanged.");
    expect(cs.getState().status).toBe("idle");
    expect(cs.getState().panelOpen).toBe(true);
    expect(cs.getState().error).toBe("The revised manor sample could not be loaded (500). The current investigation is unchanged.");
    expect(preserved(h)).toEqual(kept);
  });

  it("10.2 the analysis rejects or is cancelled: the exact message and nothing replaced", async () => {
    for (const error of [new AnalysisFailed("timed out"), new AnalysisCancelled()]) {
      const h = createHarness();
      await openManorBefore(h);
      const cs = compareStoreFor(h);
      const kept = preserved(h);
      h.analysisClient.rejectNext(error);
      await cs.actions.compareWithSample();
      expect(h.store.getState().status).toBe(`The newer snapshot could not be analyzed (${error.message}). The current investigation is unchanged.`);
      expect(preserved(h)).toEqual(kept);
      expect(cs.getState().status).toBe("idle");
    }
  });

  it("10.4 incompatible snapshots: the message of 2.2, the handoff promise rejects with it", async () => {
    const h = createHarness();
    const before = await openManorBefore(h);
    const cs = compareStoreFor(h);
    const kept = preserved(h);
    const bad = { ...before, sourceLabel: "live:x", schemaVersion: 2 } as unknown as Investigation;
    await expect(cs.actions.compareWith({ kind: "investigation", snapshot: { label: "live:x", investigation: bad, sourceText: null } }, null)).rejects.toThrow(
      "The snapshots cannot be compared: schema version 2 is not 1. The current investigation is unchanged.",
    );
    expect(h.store.getState().status).toBe("The snapshots cannot be compared: schema version 2 is not 1. The current investigation is unchanged.");
    expect(preserved(h)).toEqual(kept);
  });

  it("a failure during an active comparison returns to active and keeps the comparison", async () => {
    const h = createHarness();
    const before = await openManorBefore(h);
    const cs = compareStoreFor(h);
    await cs.actions.compareWithSample();
    const result = cs.getState().result;
    const bad = { ...before, resolverMode: "node" } as unknown as Investigation;
    await expect(cs.actions.compareWith({ kind: "investigation", snapshot: { label: "live:y", investigation: bad, sourceText: null } }, null)).rejects.toThrow();
    expect(cs.getState().status).toBe("active");
    expect(cs.getState().result).toBe(result);
    expect(h.store.getState().status).toBe('The snapshots cannot be compared: resolver mode "node" is not "documented-source-subset". The current investigation is unchanged.');
  });

  it("10.7 logs only the error name and stack frames, never a label, path, specifier or hash", async () => {
    const h = createHarness();
    await openManorBefore(h);
    const cs = compareStoreFor(h);
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const err = new AnalysisFailed("src/notifications/receipt.ts manor/after ../orders/checkout abcdef0123");
    h.analysisClient.rejectNext(err);
    await cs.actions.compareWithSample();
    expect(spy).toHaveBeenCalled();
    const logged = spy.mock.calls.flat().map(String).join("\n");
    expect(logged).toContain("AnalysisFailed");
    for (const secret of ["receipt.ts", "manor/after", "../orders/checkout", "abcdef0123", "manor/before"]) expect(logged).not.toContain(secret);
  });
});

describe("the layout paths (4.5, 4.6, 4.7)", () => {
  it("extended path: no layout request, applyLayout before replaceInvestigation, every room keeps its box", async () => {
    const h = createHarness();
    await openManorBefore(h);
    const rooms = h.store.getState().layout?.rooms.map((r) => [r.id, r.x, r.y]);
    const cs = compareStoreFor(h);
    const order: string[] = [];
    const apply = h.store.actions.applyLayout;
    const replace = h.store.actions.replaceInvestigation;
    h.store.actions.applyLayout = (r) => {
      order.push("applyLayout");
      apply(r);
    };
    h.store.actions.replaceInvestigation = (...args) => {
      order.push(`replace:${cs.getState().status}`);
      replace(...args);
    };
    const requests = h.layoutClient.requests.length;
    await cs.actions.compareWithSample();
    expect(h.layoutClient.requests.length).toBe(requests);
    expect(order).toEqual(["applyLayout", "replace:active"]);
    expect(h.store.getState().layout?.rooms.map((r) => [r.id, r.x, r.y])).toEqual(rooms);
    expect(cs.getState().layoutPath).toBe("extended");
    expect(cs.getState().unionLayoutKey).toMatch(/^[0-9a-f]{64}$/);
    expect(h.store.getState().layout?.layoutKey).toBe(cs.getState().unionLayoutKey);
    expect(h.store.getState().status).toBe(READY);
  });

  it("4.5 fresh path when the layout key differs: one union request through the store, the sentence appended", async () => {
    const h = createHarness();
    await openManorBefore(h);
    const cs = compareStoreFor(h);
    const requests = h.layoutClient.requests.length;
    await cs.actions.compareWith({ kind: "sample", id: "manor/after" }, "some-other-key");
    expect(h.layoutClient.requests.length).toBe(requests + 1);
    const payload = h.layoutClient.requests.at(-1)?.payload;
    expect(payload?.relations.map((r) => r.relationId)).toEqual(expect.arrayContaining([RECEIPT_CHECKOUT, RECEIPT_SUMMARY]));
    expect(cs.getState().layoutPath).toBe("fresh");
    expect(h.store.getState().status).toBe(`${READY} The map was laid out again for the comparison; rooms may have moved.`);
  });

  it("10.5 a failed union request still activates the comparison and appends the layout sentence", async () => {
    const h = createHarness();
    await openManorBefore(h);
    const cs = compareStoreFor(h);
    h.layoutClient.failNext("no answer");
    await cs.actions.compareWith({ kind: "sample", id: "manor/after" }, null);
    expect(cs.getState().status).toBe("active");
    expect(h.store.getState().layoutStatus).toBe("failed");
    expect(h.store.getState().investigation?.sourceLabel).toBe("manor/after");
    expect(h.store.getState().status).toBe(
      `${READY} The map was laid out again for the comparison; rooms may have moved. The map layout did not finish (no answer). The Evidence view has the full investigation.`,
    );
  });

  it("4.6 while active every expansion sends one union request; after End comparison the builder is gone", async () => {
    const h = createHarness();
    await openManorBefore(h);
    const cs = compareStoreFor(h);
    await cs.actions.compareWithSample();
    const n = h.layoutClient.requests.length;
    h.store.actions.expandWing("src/notifications");
    await layoutSettled(h.store);
    expect(h.layoutClient.requests.length).toBe(n + 1);
    const union = h.layoutClient.requests.at(-1)?.payload;
    expect(union?.relations.map((r) => r.relationId)).toEqual(expect.arrayContaining([RECEIPT_CHECKOUT, RECEIPT_SUMMARY]));
    cs.actions.end();
    await layoutSettled(h.store);
    expect(h.layoutClient.requests.length).toBe(n + 2);
    const plain = h.layoutClient.requests.at(-1)?.payload;
    expect(plain?.relations.map((r) => r.relationId)).toContain(RECEIPT_CHECKOUT);
    expect(plain?.relations.map((r) => r.relationId)).not.toContain(RECEIPT_SUMMARY);
    h.store.actions.collapseWing("src/notifications");
    await layoutSettled(h.store);
    expect(h.layoutClient.requests.at(-1)?.payload.relations.map((r) => r.relationId)).not.toContain(RECEIPT_SUMMARY);
  });

  it("4.7 twenty toggles send no layout request and keep the same layout object", async () => {
    const h = createHarness();
    await openManorBefore(h);
    const cs = compareStoreFor(h);
    await cs.actions.compareWithSample();
    const layout = h.store.getState().layout;
    const n = h.layoutClient.requests.length;
    for (let i = 0; i < 20; i++) cs.actions.show(i % 2 === 0 ? "before" : "after");
    expect(h.layoutClient.requests.length).toBe(n);
    expect(h.store.getState().layout).toBe(layout);
  });
});

describe("activation, toggle and end (6.1, 6.2, 6.3, 6.5, 6.6)", () => {
  it("6.1 shows the newer snapshot first and keeps camera, expansion and selection", async () => {
    const h = createHarness();
    await openManorBefore(h);
    h.store.actions.select({ kind: "module", id: "src/orders/checkout.ts" }, { from: "dom" });
    h.store.actions.setCamera({ x: 5, y: 6, zoom: 2 });
    const cs = compareStoreFor(h);
    await cs.actions.compareWithSample();
    const s = h.store.getState();
    expect(s.investigation?.sourceLabel).toBe("manor/after");
    expect(s.camera).toEqual({ x: 5, y: 6, zoom: 2 });
    expect(s.expandedWings).toEqual(["src/orders"]);
    expect(s.selection).toEqual({ kind: "module", id: "src/orders/checkout.ts" });
    expect(cs.getState().shown).toBe("after");
  });

  it("6.2 the toggle swaps the shown investigation and writes the two status texts", async () => {
    const h = createHarness();
    await openManorBefore(h);
    const cs = compareStoreFor(h);
    await cs.actions.compareWithSample();
    cs.actions.show("before");
    expect(h.store.getState().investigation?.sourceLabel).toBe("manor/before");
    expect(h.store.getState().status).toBe("Showing the earlier snapshot (manor/before).");
    expect(cs.getState().shown).toBe("before");
    cs.actions.show("after");
    expect(h.store.getState().investigation?.sourceLabel).toBe("manor/after");
    expect(h.store.getState().status).toBe("Showing the newer snapshot (manor/after).");
  });

  it("6.3 a witness that holds a removed relation is the closing set, at activation and at each show", async () => {
    const h = createHarness();
    const { before, after } = loadFixture("cycle-closes");
    await openFixtureSide(h, before, ["src"]);
    h.store.actions.openLoops();
    h.store.actions.chooseLoop(0);
    expect(h.store.getState().routeFilter?.kind).toBe("witness");
    const cs = compareStoreFor(h);
    await cs.actions.compareWith({ kind: "investigation", snapshot: { label: "cycle-closes/after", investigation: after, sourceText: null } }, h.store.getState().layout?.layoutKey ?? null);
    const yx = relationIdFor("src/y.ts", "src/x.ts", "import", "value");
    expect(cs.getState().closingRelationIds).toEqual([yx]);
    expect(h.store.getState().routeFilter).toBeNull();
    cs.actions.show("before");
    expect(cs.getState().closingRelationIds).toEqual([]);
    h.store.actions.openLoops();
    h.store.actions.chooseLoop(0);
    cs.actions.show("after");
    expect(cs.getState().closingRelationIds).toEqual([yx]);
    expect(h.store.getState().routeFilter).toBeNull();
  });

  it("6.5 a witness without a removed relation survives the toggle", async () => {
    const h = createHarness();
    const ids = ["src/x.ts", "src/y.ts", "src/z.ts"];
    const before = simpleInvestigation("b", ids, [["src/x.ts", "src/y.ts"], ["src/y.ts", "src/x.ts"]]);
    const after = simpleInvestigation("a", ids, [["src/x.ts", "src/y.ts"], ["src/y.ts", "src/x.ts"], ["src/z.ts", "src/x.ts"]], (id) => (id === "src/z.ts" ? "e".repeat(64) : "c".repeat(64)));
    await openFixtureSide(h, before, ["src"]);
    h.store.actions.openLoops();
    h.store.actions.chooseLoop(0);
    const witness = h.store.getState().routeFilter;
    const cs = compareStoreFor(h);
    await cs.actions.compareWith({ kind: "investigation", snapshot: { label: "a", investigation: after, sourceText: null } }, h.store.getState().layout?.layoutKey ?? null);
    expect(cs.getState().closingRelationIds).toEqual([]);
    expect(h.store.getState().routeFilter).toEqual(witness);
    cs.actions.show("before");
    expect(h.store.getState().routeFilter).toEqual(witness);
    cs.actions.show("after");
    expect(h.store.getState().routeFilter).toEqual(witness);
  });

  it("6.6 End comparison shows the earlier snapshot, sends one ordinary request, drops the newer one and keeps a selection that exists", async () => {
    const h = createHarness();
    await openManorBefore(h);
    const cs = compareStoreFor(h);
    await cs.actions.compareWithSample();
    h.store.actions.select({ kind: "relation", relationId: RECEIPT_CHECKOUT }, { from: "dom" });
    const n = h.layoutClient.requests.length;
    cs.actions.end();
    expect(h.store.getState().investigation?.sourceLabel).toBe("manor/before");
    expect(h.store.getState().status).toBe("Comparison ended. Showing manor/before.");
    expect(h.store.getState().selection).toEqual({ kind: "relation", relationId: RECEIPT_CHECKOUT });
    expect(h.layoutClient.requests.length).toBe(n + 1);
    const s = cs.getState();
    expect([s.status, s.before, s.after, s.result, s.detail, s.union]).toEqual(["idle", null, null, null, null, null]);
  });

  it("6.6 End comparison clears a selection whose ID is not in the earlier snapshot", async () => {
    const h = createHarness();
    await openManorBefore(h);
    const cs = compareStoreFor(h);
    await cs.actions.compareWithSample();
    h.store.actions.select({ kind: "relation", relationId: RECEIPT_SUMMARY }, { from: "dom" });
    cs.actions.end();
    expect(h.store.getState().selection).toEqual({ kind: "none" });
  });

  it("7.3 selectChange selects through the fleet store from the DOM and remembers the item", async () => {
    const h = createHarness();
    await openManorBefore(h);
    const cs = compareStoreFor(h);
    await cs.actions.compareWithSample();
    cs.actions.selectChange({ kind: "relation", id: RECEIPT_CHECKOUT });
    expect(h.store.getState().selection).toEqual({ kind: "relation", relationId: RECEIPT_CHECKOUT });
    expect(h.store.getState().selectionOrigin).toBe("dom");
    expect(cs.getState().selected).toEqual({ kind: "relation", id: RECEIPT_CHECKOUT });
    cs.actions.selectChange({ kind: "module", id: "src/orders/checkout.ts" });
    expect(h.store.getState().selection).toEqual({ kind: "module", id: "src/orders/checkout.ts" });
  });
});

describe("restart, replacement and memory (6.7, 6.8, 1.8)", () => {
  it("6.7 Restart demo resets the comparison store through its subscription", async () => {
    const h = createHarness();
    await openManorBefore(h);
    const cs = compareStoreFor(h);
    await cs.actions.compareWithSample();
    h.store.actions.restart();
    const s = cs.getState();
    expect([s.status, s.before, s.after, s.result, s.detail, s.union]).toEqual(["idle", null, null, null, null, null]);
  });

  it("6.8 a second handoff keeps the earlier snapshot, replaces the newer one and keeps every earlier room's box", async () => {
    const h = createHarness();
    const before = await openManorBefore(h);
    const cs = compareStoreFor(h);
    await cs.actions.compareWithSample();
    const rooms = new Map(h.store.getState().layout?.rooms.map((r) => [r.id, [r.x, r.y, r.w, r.h]]));
    const live: Investigation = { ...before, sourceLabel: "live:haunts/manor", modules: [...before.modules, { id: "src/orders/extra.ts", sourceHash: "f".repeat(64), language: "ts", parseStatus: "ok" }] };
    await cs.actions.compareWith({ kind: "investigation", snapshot: { label: live.sourceLabel, investigation: live, sourceText: null } }, h.store.getState().layout?.layoutKey ?? null);
    expect(cs.getState().before?.investigation).toBe(before);
    expect(cs.getState().after?.label).toBe("live:haunts/manor");
    expect(cs.getState().layoutPath).toBe("extended");
    const now = h.store.getState().layout;
    for (const id of before.modules.map((m) => m.id)) {
      if (rooms.has(id)) expect([now?.rooms.find((r) => r.id === id)].map((r) => r && [r.x, r.y, r.w, r.h])[0]).toEqual(rooms.get(id));
    }
    expect(now?.rooms.some((r) => r.id === "src/orders/extra.ts")).toBe(true);
    expect(cs.getState().result?.removedRelations).toEqual([]);
    expect(cs.getState().result?.addedModules).toEqual(["src/orders/extra.ts"]);
  });

  it("1.8 the store keeps snapshots in memory only and holds no investigation after End comparison", async () => {
    const h = createHarness();
    await openManorBefore(h);
    const cs = compareStoreFor(h);
    await cs.actions.compareWithSample();
    cs.actions.end();
    expect(JSON.stringify(cs.getState())).not.toContain("schemaVersion");
    const dir = join(REPO, "src", "features", "compare");
    for (const file of readdirSync(dir)) {
      expect(readFileSync(join(dir, file), "utf8")).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    }
  });

  it("2.5 identical snapshots still activate and say so in the status region", async () => {
    const h = createHarness();
    const { before, after } = loadFixture("identical");
    await openFixtureSide(h, before, ["src"]);
    const cs = compareStoreFor(h);
    await cs.actions.compareWith({ kind: "investigation", snapshot: { label: after.sourceLabel, investigation: after, sourceText: null } }, h.store.getState().layout?.layoutKey ?? null);
    expect(cs.getState().status).toBe("active");
    expect(h.store.getState().status).toBe("No differences: the snapshots have the same modules, relations and source hashes.");
  });

  it("4.3 grown wings that push others report the moved rooms in the ready message", async () => {
    const h = createHarness();
    const names = ["src/a/m1.ts", "src/a/m2.ts", "src/b/n1.ts", "src/b/n2.ts"];
    // No relation between the wings: dagre puts both in one rank, one above the other, so the upper one grows into the lower one.
    const before = simpleInvestigation("b", names);
    const after = simpleInvestigation("a", [...names, "src/a/m3.ts", "src/a/m4.ts", "src/a/m5.ts", "src/b/n3.ts", "src/b/n4.ts", "src/b/n5.ts"]);
    await openFixtureSide(h, before, ["src/a", "src/b"]);
    const cs = compareStoreFor(h);
    const was = h.store.getState().layout;
    await cs.actions.compareWith({ kind: "investigation", snapshot: { label: "a", investigation: after, sourceText: null } }, was?.layoutKey ?? null);
    const now = h.store.getState().layout;
    const moved = (was?.rooms ?? []).filter((r) => now?.rooms.find((x) => x.id === r.id)?.y !== r.y).length;
    expect(moved).toBe(2);
    expect(h.store.getState().status).toBe(
      "Comparison ready: 0 removed, 0 added, 0 changed modules; loops 0 \u2192 0. Showing the newer snapshot. 2 rooms moved to make room for 6 added modules.",
    );
  });
});
