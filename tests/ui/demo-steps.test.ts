import { describe, expect, it } from "vitest";
import type { Investigation } from "../../src/contracts/types";
import {
  CHECKOUT_ID,
  STEP_COPY,
  completedStepIds,
  statusLabel,
  stepsSummary,
  syncStepCompletion,
  visibleSteps,
  withCompareStep,
} from "../../src/features/demo/steps";
import type { DemoStepState } from "../../src/features/demo/types";
import { analysisApi } from "../../src/features/investigation/analysisApi";
import { createPrefsStore } from "../../src/features/investigation/prefs";
import { createInvestigationStore } from "../../src/features/investigation/store";
import { createFakeLayoutClient } from "./fakeLayoutClient";
import { manorInvestigation as manor } from "./manorFixture";

function openManor(inv: Investigation, compare: boolean) {
  const store = createInvestigationStore({
    analysisApi,
    layoutClient: createFakeLayoutClient(),
    prefs: createPrefsStore(null),
    compareAvailable: () => compare,
  });
  store.actions.openInvestigation(inv, null, { expandWing: "src/orders", demo: true });
  return store;
}

const state = (statuses: ("todo" | "done" | "skipped")[], ids = ["follow", "loop", "compare"] as const): DemoStepState => ({
  version: 1,
  dismissed: false,
  steps: statuses.map((status, i) => ({ id: ids[i] as "follow", status })),
});

describe("investigation steps (8.1 to 8.7)", () => {
  it("states the three titles and instructions of 8.1", () => {
    expect(STEP_COPY.follow).toEqual({ title: "Follow a dependency", instruction: "Select src/orders/checkout.ts and open one of its doors. A door is one import from that file to another file." });
    expect(STEP_COPY.loop).toEqual({ title: "Reveal a loop", instruction: "Open Dependency loops and choose the loop of 3 modules." });
    expect(STEP_COPY.compare).toEqual({ title: "Compare revisions", instruction: "Load the revised manor and watch which door disappears." });
  });

  it("summarizes as <done> of <n> steps and labels each status as text", () => {
    expect(stepsSummary(state(["todo", "todo"]))).toBe("0 of 2 steps");
    expect(stepsSummary(state(["done", "skipped", "todo"]))).toBe("1 of 3 steps");
    expect(statusLabel("done")).toBe("Done");
    expect(statusLabel("skipped")).toBe("Skipped");
    expect(statusLabel("todo")).toBe("To do");
  });

  it("shows the compare step only when the handoff is registered", () => {
    const three = state(["todo", "todo", "todo"]);
    expect(visibleSteps(three, false).map((s) => s.id)).toEqual(["follow", "loop"]);
    expect(visibleSteps(three, true).map((s) => s.id)).toEqual(["follow", "loop", "compare"]);
    expect(stepsSummary(three, false)).toBe("0 of 2 steps");
    expect(stepsSummary(three, true)).toBe("0 of 3 steps");
  });

  it("adds a To do compare step when a handoff is registered after the manor opened, and lets the store complete it", async () => {
    const store = openManor(await manor(), false);
    const open = store.getState().steps as DemoStepState;
    expect(withCompareStep(open).steps.map((s) => `${s.id}:${s.status}`)).toEqual(["follow:todo", "loop:todo", "compare:todo"]);
    expect(withCompareStep(withCompareStep(open)).steps).toHaveLength(3);
    store.actions.stepAction("compare", "done");
    expect(store.getState().steps?.steps.map((s) => `${s.id}:${s.status}`)).toEqual(["follow:todo", "loop:todo", "compare:done"]);
  });

  it("opens the manor with two steps without a handoff and three with one", async () => {
    const inv = await manor();
    expect(openManor(inv, false).getState().steps?.steps.map((s) => s.id)).toEqual(["follow", "loop"]);
    expect(openManor(inv, true).getState().steps?.steps.map((s) => s.id)).toEqual(["follow", "loop", "compare"]);
  });

  it("completes step 1 when any relation that leaves src/orders/checkout.ts is selected, and not for another importer", async () => {
    const inv = await manor();
    const store = openManor(inv, false);
    expect(completedStepIds(store.getState())).toEqual([]);
    const other = inv.imports.find((r) => r.from !== CHECKOUT_ID && r.to !== null);
    const own = inv.imports.find((r) => r.from === CHECKOUT_ID && r.to !== null);
    if (other === undefined || own === undefined) throw new Error("the manor lacks the expected relations");
    store.actions.select({ kind: "relation", relationId: other.relationId }, { from: "dom" });
    expect(completedStepIds(store.getState())).toEqual([]);
    store.actions.select({ kind: "module", id: CHECKOUT_ID }, { from: "dom" });
    expect(completedStepIds(store.getState())).toEqual([]);
    store.actions.select({ kind: "relation", relationId: own.relationId }, { from: "scene" });
    expect(completedStepIds(store.getState())).toEqual(["follow"]);
    syncStepCompletion(store);
    expect(store.getState().steps?.steps.map((s) => s.status)).toEqual(["done", "todo"]);
  });

  it("completes step 2 when a witness filter is active, and not for a trace", async () => {
    const inv = await manor();
    const store = openManor(inv, false);
    store.actions.openWhoImports(CHECKOUT_ID);
    expect(completedStepIds(store.getState())).not.toContain("loop");
    store.actions.openLoops();
    store.actions.chooseLoop(0);
    expect(store.getState().routeFilter?.kind).toBe("witness");
    expect(completedStepIds(store.getState())).toEqual(["loop"]);
  });

  it("lets Skip mark a step Skipped unless it is Done, and lets a skipped step still become Done", async () => {
    const inv = await manor();
    const store = openManor(inv, false);
    store.actions.stepAction("follow", "skip");
    expect(store.getState().steps?.steps[0]?.status).toBe("skipped");
    store.actions.openLoops();
    store.actions.chooseLoop(0);
    syncStepCompletion(store);
    store.actions.stepAction("loop", "skip");
    expect(store.getState().steps?.steps.map((s) => s.status)).toEqual(["skipped", "done"]);
    store.actions.select({ kind: "relation", relationId: inv.imports.find((r) => r.from === CHECKOUT_ID && r.to !== null)?.relationId ?? "" }, { from: "dom" });
    syncStepCompletion(store);
    expect(store.getState().steps?.steps[0]?.status).toBe("done");
  });

  it("keeps the steps when the panel is closed and reopened, and resets them on restart", async () => {
    const inv = await manor();
    const store = openManor(inv, false);
    store.actions.stepAction("follow", "skip");
    store.actions.closeSteps();
    expect(store.getState().steps?.dismissed).toBe(true);
    store.actions.openSteps();
    expect(store.getState().steps).toMatchObject({ dismissed: false, steps: [{ id: "follow", status: "skipped" }, { id: "loop", status: "todo" }] });
    store.actions.restart();
    expect(store.getState().steps).toBeNull();
  });

  it("gives the annex and a live snapshot no steps", async () => {
    const store = createInvestigationStore({ analysisApi, layoutClient: createFakeLayoutClient(), prefs: createPrefsStore(null) });
    store.actions.openInvestigation(await manor(), null, { demo: false });
    expect(store.getState().steps).toBeNull();
  });
});
