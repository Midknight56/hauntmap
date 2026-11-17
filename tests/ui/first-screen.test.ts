import { describe, expect, it } from "vitest";
import { analysisApi } from "../../src/features/investigation/analysisApi";
import { createPrefsStore } from "../../src/features/investigation/prefs";
import { createInvestigationStore } from "../../src/features/investigation/store";
import { createFakeLayoutClient } from "./fakeLayoutClient";
import { fixture } from "./fixtureFiles";

// Item 4 of the design pass: after `Explore the manor` the first screen already shows the guided steps, the loops
// list, the legend and the search field, and none of them changes the selection or the step state.

function open(demo: boolean) {
  const store = createInvestigationStore({ analysisApi, layoutClient: createFakeLayoutClient(), prefs: createPrefsStore(null) });
  store.actions.openInvestigation(fixture("cycle"), null, { demo });
  return store;
}

describe("the first screen of the manor", () => {
  it("opens the guided steps, the loops list and the legend", () => {
    const state = open(true).getState();
    expect(state.steps?.dismissed).toBe(false);
    expect(state.legendOpen).toBe(true);
    expect(state.panel.kind).toBe("loops");
    if (state.panel.kind !== "loops") return;
    expect(state.panel.report?.components.length).toBe(2);
    expect(state.panel.chosen).toBeNull();
  });

  it("changes neither the selection nor the route filter nor a step", () => {
    const state = open(true).getState();
    expect(state.selection).toEqual({ kind: "none" });
    expect(state.routeFilter).toBeNull();
    expect(state.steps?.steps.every((s) => s.status === "todo")).toBe(true);
  });

  it("does not take focus: the focus request counter stays at zero until a button asks", () => {
    const store = open(true);
    expect(store.getState().panelFocus).toBe(0);
    store.actions.openLoops();
    expect(store.getState().panelFocus).toBe(1);
    store.actions.openWhoImports("src/x.ts");
    expect(store.getState().panelFocus).toBe(2);
    // The `Do it` of the steps panel moves focus to the first loop itself, so it asks the panel not to take focus.
    store.actions.openLoops({ focus: false });
    expect(store.getState().panelFocus).toBe(2);
    expect(store.getState().panel.kind).toBe("loops");
  });

  it("the annex has no steps, and its loops list stays closed until it is asked for", () => {
    const state = open(false).getState();
    expect(state.steps).toBeNull();
    expect(state.panel.kind).toBe("none");
  });

  it("opens the wings of the loop as well as the wing asked for, so that the loop is drawn room to room", () => {
    const store = createInvestigationStore({ analysisApi, layoutClient: createFakeLayoutClient(), prefs: createPrefsStore(null) });
    store.actions.openInvestigation(fixture("two-wings"), null, { expandWing: "src/orders", expandWings: ["src/payments", "src/not-a-wing"], demo: true });
    const wings = store.getState().expandedWings;
    expect(wings).toEqual(["src/orders", "src/payments"]);
    expect(wings).not.toContain("src/not-a-wing");
    expect([...wings].sort()).toEqual(wings);
  });

  it("restart clears the panel again", () => {
    const store = open(true);
    store.actions.restart();
    expect(store.getState().panel.kind).toBe("none");
    expect(store.getState().panelFocus).toBe(0);
  });
});
