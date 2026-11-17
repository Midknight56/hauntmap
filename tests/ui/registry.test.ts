import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { callCompareHandoff } from "../../src/features/investigation/handoffs";
import { analysisApi } from "../../src/features/investigation/analysisApi";
import { createPrefsStore } from "../../src/features/investigation/prefs";
import { createRegistry, registry } from "../../src/features/investigation/registry";
import { createInvestigationStore } from "../../src/features/investigation/store";
import { createFakeLayoutClient, makeLayoutResult } from "./fakeLayoutClient";
import { fixture } from "./fixtureFiles";

function newStore() {
  return createInvestigationStore({ analysisApi, layoutClient: createFakeLayoutClient(), prefs: createPrefsStore(null) });
}

describe("registry slots (10.1)", () => {
  it("renders a registered control and nothing for an empty slot", () => {
    const reg = createRegistry();
    const store = newStore();
    for (const slot of ["export", "compare", "live-snapshot"] as const) expect(reg.getControl(slot)).toBeNull();
    reg.registerControl("export", ({ store: s }) => createElement("button", { type: "button" }, `Export ${s.getState().viewStateVersion}`));
    const Control = reg.getControl("export");
    expect(Control).not.toBeNull();
    expect(renderToStaticMarkup(createElement(Control!, { store }))).toBe('<button type="button">Export 1</button>');
    expect(reg.getControl("compare")).toBeNull();
    expect(reg.getControl("live-snapshot")).toBeNull();
  });

  it("the last control registered in a slot wins", () => {
    const reg = createRegistry();
    reg.registerControl("compare", () => createElement("span", null, "first"));
    reg.registerControl("compare", () => createElement("span", null, "second"));
    expect(renderToStaticMarkup(createElement(reg.getControl("compare")!, { store: newStore() }))).toBe("<span>second</span>");
  });
});

describe("registry handoffs (10.4, 10.6)", () => {
  it("the compare handoff receives before, after and layoutKey through callCompareHandoff", async () => {
    const reg = createRegistry();
    const store = newStore();
    store.actions.openInvestigation(fixture("triad"), null, { demo: false });
    store.actions.applyLayout(makeLayoutResult("key-1"));
    const fn = vi.fn(async () => undefined);
    reg.registerHandoff("compare", fn);
    expect(await callCompareHandoff(store, reg, { sample: "manor/after" })).toBe("done");
    expect(fn).toHaveBeenCalledWith({ before: fixture("triad"), after: { sample: "manor/after" }, layoutKey: "key-1" });
  });

  it("without a compare handoff the helper reports no-compare", async () => {
    const reg = createRegistry();
    const store = newStore();
    store.actions.openInvestigation(fixture("triad"), null, { demo: false });
    expect(await callCompareHandoff(store, reg, { sample: "manor/after" })).toBe("no-compare");
    expect(store.getState().status).toBe("Comparison is not available in this build.");
  });

  it("the export handoff is stored and called as a plain function", () => {
    const reg = createRegistry();
    const fn = vi.fn();
    reg.registerHandoff("export", fn);
    (reg.getHandoff("export") as () => void)();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("has exactly the documented API and no intake handoff", () => {
    const reg = createRegistry();
    expect(Object.keys(reg).sort()).toEqual([
      "getControl",
      "getHandoff",
      "legendEntries",
      "registerControl",
      "registerHandoff",
      "registerLegendEntries",
      "unregisterHandoff",
    ]);
    expect(reg.getHandoff("intake" as never)).toBeNull();
    expect(reg.getHandoff("compare")).toBeNull();
    expect(reg.getHandoff("export")).toBeNull();
  });

  it("unregisterHandoff removes a handoff", () => {
    const reg = createRegistry();
    reg.registerHandoff("compare", async () => undefined);
    reg.unregisterHandoff("compare");
    expect(reg.getHandoff("compare")).toBeNull();
  });

  it("exports one shared instance that tests do not touch", () => {
    expect(registry.getControl("export")).toBeNull();
    expect(registry.getHandoff("compare")).toBeNull();
    expect(registry.legendEntries()).toEqual([]);
  });
});

describe("legend entries (5.1)", () => {
  it("are empty until a provider returns some", () => {
    const reg = createRegistry();
    expect(reg.legendEntries()).toEqual([]);
    let entries: { concept: string; costume: string }[] = [];
    reg.registerLegendEntries(() => entries);
    expect(reg.legendEntries()).toEqual([]);
    entries = [{ concept: "Changed in the comparison", costume: "lamp glyph" }];
    expect(reg.legendEntries()).toEqual([{ concept: "Changed in the comparison", costume: "lamp glyph" }]);
  });

  it("appends the entries of every provider in registration order", () => {
    const reg = createRegistry();
    reg.registerLegendEntries(() => [{ concept: "A", costume: "a" }]);
    reg.registerLegendEntries(() => [{ concept: "B", costume: "b" }]);
    expect(reg.legendEntries().map((e) => e.concept)).toEqual(["A", "B"]);
  });
});
