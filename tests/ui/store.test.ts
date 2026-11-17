import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImportRecord, Investigation } from "../../src/contracts/types";
import type { LayoutRequest } from "../../src/scene/layout/types";
import { analysisApi, type AnalysisApi } from "../../src/features/investigation/analysisApi";
import { callCompareHandoff } from "../../src/features/investigation/handoffs";
import { PREFS_KEY, createPrefsStore } from "../../src/features/investigation/prefs";
import { createInvestigationStore } from "../../src/features/investigation/store";
import { createSwitchableAnalysisApi, createThrowingAnalysisApi } from "./fakeAnalysisApi";
import { createFakeLayoutClient, flush, makeLayoutResult } from "./fakeLayoutClient";
import { fixture } from "./fixtureFiles";
import { mulberry32, wide } from "./generators";
import { relationIdFor } from "./ids";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

function setup(options: { api?: AnalysisApi; compareAvailable?: () => boolean } = {}) {
  const layoutClient = createFakeLayoutClient();
  const storage = memoryStorage();
  const store = createInvestigationStore({
    analysisApi: options.api ?? analysisApi,
    layoutClient,
    prefs: createPrefsStore(storage),
    ...(options.compareAvailable === undefined ? {} : { compareAvailable: options.compareAvailable }),
  });
  return { store, layoutClient, storage };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("layout requests and the revision guard (3.2, I2)", () => {
  it("openInvestigation sends exactly one request and marks the layout pending", () => {
    const { store, layoutClient } = setup();
    store.actions.openInvestigation(fixture("triad"), null, { demo: false });
    const state = store.getState();
    expect(state.screen).toBe("investigation");
    expect(state.layoutRevision).toBe(1);
    expect(state.layoutStatus).toBe("pending");
    expect(layoutClient.requests).toHaveLength(1);
    const payload = layoutClient.requests[0]!.payload;
    expect(payload.layoutVersion).toBe(1);
    expect(payload.engine).toBe("dagre");
    expect(payload.preset).toBe("static-value");
    expect(payload.room).toEqual({ w: 96, h: 64 });
    expect(payload.modules).toEqual([
      { id: "src/a.ts", wing: "src" },
      { id: "src/b.ts", wing: "src" },
      { id: "src/c.ts", wing: "src" },
      { id: "src/d.ts", wing: "src" },
    ]);
    expect(payload.relations.map((r) => [r.from, r.to])).toHaveLength(3);
    expect(payload.boundaries).toEqual([]);
    expect(payload.expandedWings).toEqual([]);
  });

  it("two results delivered out of order (revision 2 then 1) leave revision 2 applied", async () => {
    const { store, layoutClient } = setup();
    store.actions.openInvestigation(fixture("two-wings"), null, { demo: false });
    store.actions.expandWing("src/orders");
    expect(store.getState().layoutRevision).toBe(2);
    layoutClient.requests[1]!.resolve(makeLayoutResult("two"));
    await flush();
    layoutClient.requests[0]!.resolve(makeLayoutResult("one"));
    await flush();
    expect(store.getState().layout?.layoutKey).toBe("two");
    expect(store.getState().layoutStatus).toBe("idle");
    store.actions.layoutResult(makeLayoutResult("late"), 1);
    expect(store.getState().layout?.layoutKey).toBe("two");
  });

  it("select, focusModule, chooseLoop and setStatus send no request and keep the revision", () => {
    const { store, layoutClient } = setup();
    store.actions.openInvestigation(fixture("cycle"), null, { demo: false });
    const before = layoutClient.requests.length;
    const revision = store.getState().layoutRevision;
    store.actions.select({ kind: "module", id: "src/x.ts" }, { from: "dom" });
    store.actions.focusModule("src/x.ts");
    store.actions.openLoops();
    store.actions.chooseLoop(0);
    store.actions.setStatus("hello");
    store.actions.setView("evidence");
    store.actions.openWhoImports("src/x.ts");
    store.actions.chooseImporter("src/y.ts");
    store.actions.clearSelection();
    expect(layoutClient.requests).toHaveLength(before);
    expect(store.getState().layoutRevision).toBe(revision);
  });

  it("setPreset, expandWing, collapseWing and retryLayout send exactly one request each", () => {
    const { store, layoutClient } = setup();
    store.actions.openInvestigation(fixture("two-wings"), null, { demo: false });
    let count = layoutClient.requests.length;
    const expectOne = (act: () => void) => {
      act();
      expect(layoutClient.requests).toHaveLength(count + 1);
      count++;
    };
    expectOne(() => store.actions.setPreset("type-inclusive"));
    expectOne(() => store.actions.expandWing("src/orders"));
    expectOne(() => store.actions.collapseWing("src/orders"));
    expectOne(() => store.actions.retryLayout());
    expect(store.getState().layoutRevision).toBe(count);
  });

  it("setPreset to the same preset and a repeated expand send nothing", () => {
    const { store, layoutClient } = setup();
    store.actions.openInvestigation(fixture("two-wings"), null, { demo: false });
    store.actions.expandWing("src/orders");
    const count = layoutClient.requests.length;
    store.actions.setPreset("static-value");
    store.actions.expandWing("src/orders");
    store.actions.collapseWing("src/payments");
    store.actions.expandWing("src/missing");
    expect(layoutClient.requests).toHaveLength(count);
  });

  it("setPreset persists the preset in the prefs record", () => {
    const { store, storage } = setup();
    store.actions.openInvestigation(fixture("two-wings"), null, { demo: false });
    store.actions.setPreset("dynamic-inclusive");
    expect(JSON.parse(storage.data.get(PREFS_KEY) ?? "{}")).toMatchObject({ preset: "dynamic-inclusive" });
  });
});

describe("layout failures (3.7)", () => {
  it("an unanswered request fails after 10,000 ms, switches to the Evidence view and keeps selection and panel", () => {
    vi.useFakeTimers();
    const { store, layoutClient } = setup();
    store.actions.openInvestigation(fixture("cycle"), null, { demo: false });
    store.actions.select({ kind: "module", id: "src/x.ts" }, { from: "dom" });
    store.actions.openLoops();
    vi.advanceTimersByTime(9_999);
    expect(store.getState().layoutStatus).toBe("pending");
    vi.advanceTimersByTime(1);
    const state = store.getState();
    expect(state.layoutStatus).toBe("failed");
    expect(state.activeView).toBe("evidence");
    expect(state.status).toBe(
      "The map layout did not finish (no answer in 10,000 ms). The Evidence view has the full investigation.",
    );
    expect(state.selection).toEqual({ kind: "module", id: "src/x.ts" });
    expect(state.panel.kind).toBe("loops");
    expect(layoutClient.cancelCount).toBe(1);
    const count = layoutClient.requests.length;
    store.actions.retryLayout();
    expect(layoutClient.requests).toHaveLength(count + 1);
    expect(store.getState().layoutStatus).toBe("pending");
  });

  it("a rejection sets layoutStatus failed with the reason", async () => {
    const { store, layoutClient } = setup();
    store.actions.openInvestigation(fixture("triad"), null, { demo: false });
    layoutClient.requests[0]!.reject(new Error("boom"));
    await flush();
    expect(store.getState().layoutStatus).toBe("failed");
    expect(store.getState().layoutError).toBe("boom");
    expect(store.getState().status).toBe("The map layout did not finish (boom). The Evidence view has the full investigation.");
    expect(store.getState().activeView).toBe("evidence");
  });

  it("a rejection of a superseded request changes nothing", async () => {
    const { store, layoutClient } = setup();
    store.actions.openInvestigation(fixture("two-wings"), null, { demo: false });
    store.actions.expandWing("src/orders");
    layoutClient.requests[0]!.reject(new Error("superseded"));
    await flush();
    expect(store.getState().layoutStatus).toBe("pending");
    expect(store.getState().status).toBe("");
  });

  it("a late answer to a timed-out request is ignored", async () => {
    vi.useFakeTimers();
    const { store, layoutClient } = setup();
    store.actions.openInvestigation(fixture("triad"), null, { demo: false });
    vi.advanceTimersByTime(10_000);
    layoutClient.requests[0]!.resolve(makeLayoutResult("late"));
    await flush();
    expect(store.getState().layout).toBeNull();
    expect(store.getState().layoutStatus).toBe("failed");
  });
});

describe("wing expansion (3.5, I3)", () => {
  it("shows the 80 smallest modules of a 120-module wing and says so in the status region", () => {
    const { store, layoutClient } = setup();
    store.actions.openInvestigation(wide, null, { demo: false });
    store.actions.expandWing("src/big");
    const request = layoutClient.requests[1]!.payload;
    const entry = request.expandedWings.find((e) => e.wing === "src/big")!;
    expect(entry.shownIds).toHaveLength(80);
    expect(entry.shownIds[0]).toBe("src/big/m000.ts");
    expect(entry.shownIds[79]).toBe("src/big/m079.ts");
    expect(entry.hiddenCount).toBe(40);
    expect(entry.shownIds.length + entry.hiddenCount).toBe(120);
    expect(store.getState().status).toBe(
      "Showing 80 of 120 modules in src/big. Search to bring another module into view, or use the Evidence view for the full list.",
    );
    expect(store.getState().expandedWings).toEqual(["src/big"]);
  });

  it("expandWing(wing, bring) swaps the module into the last slot", () => {
    const { store, layoutClient } = setup();
    store.actions.openInvestigation(wide, null, { demo: false });
    store.actions.expandWing("src/big");
    store.actions.expandWing("src/big", "src/big/m119.ts");
    const entry = layoutClient.requests[2]!.payload.expandedWings[0]!;
    expect(entry.shownIds).toHaveLength(80);
    expect(entry.shownIds[79]).toBe("src/big/m119.ts");
    expect(entry.shownIds).not.toContain("src/big/m079.ts");
    expect(entry.shownIds.length + entry.hiddenCount).toBe(120);
  });

  it("a wing of at most 80 modules is shown whole and the status stays empty", () => {
    const { store, layoutClient } = setup();
    store.actions.openInvestigation(fixture("two-wings"), null, { demo: false });
    store.actions.expandWing("src/orders");
    const entry = layoutClient.requests[1]!.payload.expandedWings[0]!;
    expect(entry).toEqual({ wing: "src/orders", shownIds: ["src/orders/a.ts", "src/orders/b.ts", "src/orders/c.ts"], hiddenCount: 0 });
    expect(store.getState().status).toBe("");
  });

  it("opening with expandWing expands it in the first request", () => {
    const { store, layoutClient } = setup();
    store.actions.openInvestigation(fixture("two-wings"), null, { expandWing: "src/orders", demo: true });
    expect(layoutClient.requests).toHaveLength(1);
    expect(layoutClient.requests[0]!.payload.expandedWings.map((e) => e.wing)).toEqual(["src/orders"]);
    expect(store.getState().expandedWings).toEqual(["src/orders"]);
    expect(store.getState().demo).toBe(true);
  });
});

describe("external layouts and replaceInvestigation (3.9)", () => {
  it("applyLayout accepts an external result, increments the revision and keeps the camera", async () => {
    const { store, layoutClient } = setup();
    store.actions.openInvestigation(fixture("triad"), null, { demo: false });
    store.actions.setCamera({ x: 40, y: -20, zoom: 2 });
    store.actions.applyLayout(makeLayoutResult("external"));
    const state = store.getState();
    expect(state.layout?.layoutKey).toBe("external");
    expect(state.layoutStatus).toBe("idle");
    expect(state.layoutRevision).toBe(2);
    expect(state.camera).toEqual({ x: 40, y: -20, zoom: 2 });
    layoutClient.requests[0]!.resolve(makeLayoutResult("in-flight"));
    await flush();
    expect(store.getState().layout?.layoutKey).toBe("external");
  });

  it("replaceInvestigation keeps the listed fields, drops a route filter with an absent ID and sends no request", () => {
    const { store, layoutClient } = setup();
    const triad = fixture("triad");
    store.actions.openInvestigation(triad, null, { demo: false });
    store.actions.applyLayout(makeLayoutResult("kept"));
    store.actions.expandWing("src");
    layoutClient.requests[layoutClient.requests.length - 1]!.resolve(makeLayoutResult("kept2"));
    store.actions.openWhoImports("src/c.ts");
    store.actions.chooseImporter("src/d.ts");
    expect(store.getState().routeFilter?.kind).toBe("trace");
    store.actions.select({ kind: "module", id: "src/a.ts" }, { from: "dom" });
    store.actions.setView("evidence");
    store.actions.setPreset("type-inclusive");
    const before = store.getState();
    const requests = layoutClient.requests.length;

    const smaller: Investigation = {
      ...triad,
      modules: triad.modules.filter((m) => m.id !== "src/d.ts"),
      imports: triad.imports.filter((r) => r.from !== "src/d.ts"),
    };
    store.actions.replaceInvestigation(smaller, new Map([["src/a.ts", "x"]]), { keepLayout: true });
    const after = store.getState();
    expect(after.investigation).toBe(smaller);
    expect(after.sourceText?.get("src/a.ts")).toBe("x");
    expect(after.layout).toBe(before.layout);
    expect(after.layoutRevision).toBe(before.layoutRevision);
    expect(after.layoutStatus).toBe(before.layoutStatus);
    expect(after.camera).toEqual(before.camera);
    expect(after.expandedWings).toEqual(before.expandedWings);
    expect(after.preset).toBe("type-inclusive");
    expect(after.activeView).toBe("evidence");
    expect(after.selection).toEqual({ kind: "module", id: "src/a.ts" });
    expect(after.routeFilter).toBeNull();
    expect(layoutClient.requests).toHaveLength(requests);
  });

  it("replaceInvestigation keeps a route filter whose IDs all exist, recomputes an open loops panel and closes who-imports for an absent origin", () => {
    const { store } = setup();
    const cycle = fixture("cycle");
    store.actions.openInvestigation(cycle, null, { demo: false });
    store.actions.openLoops();
    store.actions.chooseLoop(0);
    const filter = store.getState().routeFilter;
    expect(filter?.kind).toBe("witness");
    store.actions.replaceInvestigation({ ...cycle }, null, { keepLayout: true });
    expect(store.getState().routeFilter).toEqual(filter);
    const panel = store.getState().panel;
    expect(panel.kind).toBe("loops");
    if (panel.kind === "loops") expect(panel.chosen).toBe(0);

    store.actions.openWhoImports("src/x.ts");
    const without: Investigation = {
      ...cycle,
      modules: cycle.modules.filter((m) => m.id !== "src/x.ts"),
      imports: cycle.imports.filter((r) => r.from !== "src/x.ts" && r.to !== "src/x.ts"),
    };
    store.actions.replaceInvestigation(without, null, { keepLayout: true });
    expect(store.getState().panel.kind).toBe("none");
  });

  it("a layout request builder is used by the five requesting actions and ignored when it returns null", () => {
    const { store, layoutClient } = setup();
    const built = vi.fn();
    let answer = false;
    const built_request: LayoutRequest = {
      layoutVersion: 1,
      engine: "dagre",
      modules: [],
      relations: [],
      boundaries: [],
      expandedWings: [],
      preset: "dynamic-inclusive",
      room: { w: 96, h: 64 },
    };
    store.actions.setLayoutRequestBuilder((state) => {
      built(state.layoutRevision);
      return answer ? built_request : null;
    });
    store.actions.openInvestigation(fixture("two-wings"), null, { demo: false });
    expect(layoutClient.requests[0]!.payload.preset).toBe("static-value");
    answer = true;
    const count = layoutClient.requests.length;
    store.actions.setPreset("type-inclusive");
    store.actions.expandWing("src/orders");
    store.actions.collapseWing("src/orders");
    store.actions.retryLayout();
    store.actions.openInvestigation(fixture("two-wings"), null, { demo: false });
    expect(layoutClient.requests).toHaveLength(count + 5);
    for (const request of layoutClient.requests.slice(count)) expect(request.payload.preset).toBe("dynamic-inclusive");
    expect(built).toHaveBeenCalledTimes(6);
    store.actions.setLayoutRequestBuilder(null);
    store.actions.retryLayout();
    expect(layoutClient.requests[layoutClient.requests.length - 1]!.payload.preset).toBe("type-inclusive");
  });

  it("a comparison-side toggle through replaceInvestigation or applyLayout sends nothing", () => {
    const { store, layoutClient } = setup();
    store.actions.openInvestigation(fixture("triad"), null, { demo: false });
    const count = layoutClient.requests.length;
    store.actions.replaceInvestigation(fixture("triad"), null, { keepLayout: true });
    store.actions.applyLayout(makeLayoutResult("u"));
    expect(layoutClient.requests).toHaveLength(count);
  });
});

describe("callCompareHandoff", () => {
  it("passes before, after and layoutKey and never touches camera, selection or wings", async () => {
    const { store } = setup();
    store.actions.openInvestigation(fixture("two-wings"), null, { expandWing: "src/orders", demo: true });
    store.actions.applyLayout(makeLayoutResult("current"));
    store.actions.select({ kind: "module", id: "src/orders/a.ts" }, { from: "dom" });
    const snapshot = { camera: store.getState().camera, selection: store.getState().selection, wings: store.getState().expandedWings };
    const handoff = vi.fn(async () => undefined);
    const result = await callCompareHandoff(store, { getHandoff: (name) => (name === "compare" ? (handoff as never) : null) }, { sample: "manor/after" });
    expect(result).toBe("done");
    expect(handoff).toHaveBeenCalledWith({ before: store.getState().investigation, after: { sample: "manor/after" }, layoutKey: "current" });
    expect(store.getState().camera).toEqual(snapshot.camera);
    expect(store.getState().selection).toEqual(snapshot.selection);
    expect(store.getState().expandedWings).toEqual(snapshot.wings);
  });

  it("passes layoutKey null when there is no layout yet", async () => {
    const { store } = setup();
    store.actions.openInvestigation(fixture("triad"), null, { demo: false });
    const handoff = vi.fn(async () => undefined);
    await callCompareHandoff(store, { getHandoff: () => handoff as never }, fixture("triad"));
    expect(handoff.mock.calls[0]).toEqual([{ before: fixture("triad"), after: fixture("triad"), layoutKey: null }]);
  });

  it("returns no-compare and writes the status text when nothing is registered", async () => {
    const { store } = setup();
    store.actions.openInvestigation(fixture("triad"), null, { demo: false });
    const result = await callCompareHandoff(store, { getHandoff: () => null }, { sample: "manor/after" });
    expect(result).toBe("no-compare");
    expect(store.getState().status).toBe("Comparison is not available in this build.");
  });

  it("returns failed on rejection without writing a second status", async () => {
    const { store } = setup();
    store.actions.openInvestigation(fixture("triad"), null, { demo: false });
    store.actions.setStatus("written by the handoff");
    const result = await callCompareHandoff(
      store,
      { getHandoff: () => (async () => Promise.reject(new Error("nope"))) as never },
      { sample: "manor/after" },
    );
    expect(result).toBe("failed");
    expect(store.getState().status).toBe("written by the handoff");
  });
});

describe("restart (1.7, I8)", () => {
  it("resets every field except legendOpen and motion", () => {
    const { store, storage } = setup();
    const initial = store.getState();
    store.actions.setLegendOpen(false);
    store.actions.setMotion("reduce");
    store.actions.openInvestigation(fixture("cycle"), new Map([["src/x.ts", "text"]]), { expandWing: "src", demo: true });
    store.actions.select({ kind: "module", id: "src/x.ts" }, { from: "dom" });
    store.actions.openLoops();
    store.actions.chooseLoop(0);
    store.actions.setSearch("x");
    store.actions.setCamera({ x: 5, y: 5, zoom: 3 });
    store.actions.setStatus("something");
    store.actions.setPreset("type-inclusive");
    store.actions.restart();
    expect(store.getState()).toEqual({ ...initial, legendOpen: false, motion: "reduce" });
    expect(store.getState().screen).toBe("landing");
    expect([...storage.data.keys()]).toEqual([PREFS_KEY]);
  });

  it("an answer to a request made before restart is ignored", async () => {
    const { store, layoutClient } = setup();
    store.actions.openInvestigation(fixture("triad"), null, { demo: false });
    store.actions.restart();
    layoutClient.requests[0]!.resolve(makeLayoutResult("old"));
    await flush();
    expect(store.getState().layout).toBeNull();
    expect(store.getState().layoutStatus).toBe("idle");
  });
});

describe("selection, camera and route filters", () => {
  it("camera stays unchanged across 50 random select, focus, panel and status actions (4.6)", () => {
    const { store, layoutClient } = setup();
    store.actions.openInvestigation(fixture("cycle"), null, { demo: false });
    store.actions.setCamera({ x: 12, y: 34, zoom: 1.5 });
    const camera = store.getState().camera;
    const requests = layoutClient.requests.length;
    const random = mulberry32(7);
    const ids = ["src/x.ts", "src/y.ts", "src/z.ts"];
    const pick = <T,>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;
    for (let i = 0; i < 50; i++) {
      const roll = Math.floor(random() * 9);
      if (roll === 0) store.actions.select({ kind: "module", id: pick(ids) }, { from: pick(["scene", "dom"] as const) });
      else if (roll === 1) store.actions.focusModule(pick(ids));
      else if (roll === 2) store.actions.openLoops();
      else if (roll === 3) store.actions.chooseLoop(Math.floor(random() * 2));
      else if (roll === 4) store.actions.setStatus(`s${i}`);
      else if (roll === 5) store.actions.openWhoImports(pick(ids));
      else if (roll === 6) store.actions.closePanel();
      else if (roll === 7) store.actions.setView(pick(["map", "evidence"] as const));
      else store.actions.clearSelection();
      expect(store.getState().camera).toEqual(camera);
    }
    expect(layoutClient.requests).toHaveLength(requests);
  });

  it("setCamera clamps the zoom to [0.25, 4]", () => {
    const { store } = setup();
    store.actions.setCamera({ x: 0, y: 0, zoom: 100 });
    expect(store.getState().camera.zoom).toBe(4);
    store.actions.setCamera({ x: 0, y: 0, zoom: 0.01 });
    expect(store.getState().camera.zoom).toBe(0.25);
  });

  it("select records the origin and replaces the selection", () => {
    const { store } = setup();
    store.actions.openInvestigation(fixture("triad"), null, { demo: false });
    store.actions.select({ kind: "module", id: "src/a.ts" }, { from: "scene" });
    expect(store.getState().selection).toEqual({ kind: "module", id: "src/a.ts" });
    expect(store.getState().selectionOrigin).toBe("scene");
    store.actions.select({ kind: "wing", wing: "src" }, { from: "dom" });
    expect(store.getState().selectionOrigin).toBe("dom");
    store.actions.clearSelection();
    expect(store.getState().selection).toEqual({ kind: "none" });
  });

  it("chooseLoop builds the witness filter from cycle.json and selects the first relation (7.2)", () => {
    const { store } = setup();
    store.actions.openInvestigation(fixture("cycle"), null, { demo: false });
    store.actions.openLoops();
    const xy = relationIdFor("src/x.ts", "src/y.ts", "import", "value");
    const yx = relationIdFor("src/y.ts", "src/x.ts", "import", "value");
    store.actions.chooseLoop(0);
    const state = store.getState();
    expect(state.routeFilter).toMatchObject({
      kind: "witness",
      modules: ["src/x.ts", "src/y.ts"],
      relationIds: [xy, yx],
      label: "Loop: src/x.ts → src/y.ts → src/x.ts",
    });
    expect(state.selection).toMatchObject({ kind: "relation", relationId: xy });
    const panel = state.panel;
    expect(panel.kind === "loops" && panel.chosen).toBe(0);
    store.actions.chooseLoop(1);
    expect(store.getState().routeFilter).toMatchObject({ modules: ["src/z.ts"], relationIds: [relationIdFor("src/z.ts", "src/z.ts", "import", "value")] });
    store.actions.chooseLoop(9);
    expect(store.getState().routeFilter?.modules).toEqual(["src/z.ts"]);
  });

  it("chooseImporter('src/a.ts') on triad.json builds the 2-step route and prose (7.5)", () => {
    const { store } = setup();
    store.actions.openInvestigation(fixture("triad"), null, { demo: false });
    store.actions.openWhoImports("src/c.ts");
    const panel = store.getState().panel;
    expect(panel.kind === "whoImports" && panel.result?.direct).toEqual(["src/b.ts"]);
    store.actions.chooseImporter("src/a.ts");
    const state = store.getState();
    const ab = relationIdFor("src/a.ts", "src/b.ts", "import", "value");
    const bc = relationIdFor("src/b.ts", "src/c.ts", "import", "value");
    expect(state.routeFilter).toMatchObject({
      kind: "trace",
      modules: ["src/a.ts", "src/b.ts", "src/c.ts"],
      relationIds: [ab, bc],
      origin: "src/c.ts",
      direction: "imported-by",
      prose: "src/a.ts reaches src/c.ts in 2 steps: src/a.ts imports src/b.ts, src/b.ts imports src/c.ts.",
    });
    expect(state.selection).toMatchObject({ kind: "relation", relationId: ab });
    store.actions.chooseImporter("src/not-there.ts");
    expect(store.getState().routeFilter?.modules).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
  });

  it("focusModule('src/b.ts') on triad.json sets the focus filter and the status (4.4)", () => {
    const { store } = setup();
    store.actions.openInvestigation(fixture("triad"), null, { demo: false });
    store.actions.focusModule("src/b.ts");
    const ab = relationIdFor("src/a.ts", "src/b.ts", "import", "value");
    const bc = relationIdFor("src/b.ts", "src/c.ts", "import", "value");
    const db = relationIdFor("src/d.ts", "src/b.ts", "import", "value");
    expect(store.getState().routeFilter).toMatchObject({
      kind: "focus",
      modules: ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"],
      relationIds: [ab, bc, db],
      origin: "src/b.ts",
    });
    expect(store.getState().status).toBe("Focused on src/b.ts: 2 importers, 1 imports.");
    store.actions.clearSelection();
    expect(store.getState().routeFilter).toBeNull();
  });

  it("an open loops panel is recomputed with the same index when the preset changes (5.4)", () => {
    const { store } = setup();
    store.actions.openInvestigation(fixture("cycle"), null, { demo: false });
    store.actions.openLoops();
    store.actions.chooseLoop(1);
    store.actions.setPreset("type-inclusive");
    const panel = store.getState().panel;
    expect(panel.kind === "loops" && panel.report?.preset).toBe("type-inclusive");
    expect(panel.kind === "loops" && panel.chosen).toBe(1);
  });
});

describe("analysis failures (7.8)", () => {
  it("a throwing AnalysisApi leaves the previous filter and selection and shows the message in the panel", () => {
    const api = createSwitchableAnalysisApi();
    const { store } = setup({ api });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    store.actions.openInvestigation(fixture("cycle"), null, { demo: false });
    store.actions.openLoops();
    store.actions.chooseLoop(0);
    const filter = store.getState().routeFilter;
    const selection = store.getState().selection;
    api.failing = true;
    store.actions.openLoops();
    const panel = store.getState().panel;
    expect(panel).toMatchObject({ kind: "loops", report: null, error: "Could not compute loops for this preset: forced." });
    store.actions.openWhoImports("src/x.ts");
    expect(store.getState().panel).toMatchObject({ kind: "whoImports", result: null, error: "Could not compute importers for this preset: forced." });
    store.actions.focusModule("src/x.ts");
    expect(store.getState().routeFilter).toEqual(filter);
    expect(store.getState().selection).toEqual(selection);
    expect(error).toHaveBeenCalled();
    for (const call of error.mock.calls) expect(JSON.stringify(call)).not.toContain("src/");
  });

  it("a throwing fake from the start never breaks opening an investigation", () => {
    const { store } = setup({ api: createThrowingAnalysisApi() });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    store.actions.openInvestigation(fixture("triad"), null, { demo: false });
    expect(store.getState().screen).toBe("investigation");
  });
});

describe("demo steps", () => {
  it("a demo opening creates the steps state, with the compare step only when a handoff exists", () => {
    const without = setup();
    without.store.actions.openInvestigation(fixture("triad"), null, { demo: true });
    expect(without.store.getState().steps).toEqual({
      version: 1,
      steps: [
        { id: "follow", status: "todo" },
        { id: "loop", status: "todo" },
      ],
      dismissed: false,
    });
    const withCompare = setup({ compareAvailable: () => true });
    withCompare.store.actions.openInvestigation(fixture("triad"), null, { demo: true });
    expect(withCompare.store.getState().steps?.steps.map((s) => s.id)).toEqual(["follow", "loop", "compare"]);
    const none = setup();
    none.store.actions.openInvestigation(fixture("triad"), null, { demo: false });
    expect(none.store.getState().steps).toBeNull();
  });

  it("skip, done, close and open change the step state", () => {
    const { store } = setup();
    store.actions.openInvestigation(fixture("triad"), null, { demo: true });
    store.actions.stepAction("follow", "skip");
    store.actions.stepAction("loop", "done");
    store.actions.stepAction("loop", "skip");
    expect(store.getState().steps?.steps).toEqual([
      { id: "follow", status: "skipped" },
      { id: "loop", status: "done" },
    ]);
    store.actions.closeSteps();
    expect(store.getState().steps?.dismissed).toBe(true);
    store.actions.openSteps();
    expect(store.getState().steps?.dismissed).toBe(false);
  });
});

describe("misc", () => {
  it("subscribe notifies and unsubscribes", () => {
    const { store } = setup();
    const listener = vi.fn();
    const off = store.subscribe(listener);
    store.actions.setStatus("a");
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    store.actions.setStatus("b");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("boundary relations reach the layout request as sealed doorways", () => {
    const { store, layoutClient } = setup();
    store.actions.openInvestigation(fixture("boundary"), null, { demo: false });
    const payload = layoutClient.requests[0]!.payload;
    expect(payload.relations).toEqual([]);
    expect(payload.boundaries).toHaveLength(3);
    expect(payload.boundaries.every((b) => b.from === "src/app.ts")).toBe(true);
  });

  it("the request of a type-inclusive preset carries the type relation", () => {
    const { store, layoutClient } = setup();
    store.actions.openInvestigation(fixture("mixed-presets"), null, { demo: false });
    expect(layoutClient.requests[0]!.payload.relations).toHaveLength(1);
    store.actions.setPreset("type-inclusive");
    const request = layoutClient.requests[1]!.payload;
    expect(request.preset).toBe("type-inclusive");
    expect(request.relations).toHaveLength(2);
    const records: ImportRecord[] = fixture("mixed-presets").imports;
    expect(request.relations.map((r) => r.relationId).sort()).toEqual(
      [records[0]!.relationId, records[1]!.relationId].sort(),
    );
  });
});
