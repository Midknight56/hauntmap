import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WhoImportsPanel } from "../../src/components/WhoImportsPanel";
import { analysisApi } from "../../src/features/investigation/analysisApi";
import { createPrefsStore } from "../../src/features/investigation/prefs";
import { createInvestigationStore } from "../../src/features/investigation/store";
import { createFakeLayoutClient } from "./fakeLayoutClient";
import { fixture } from "./fixtureFiles";

afterEach(cleanup);

function setup(api = analysisApi) {
  const store = createInvestigationStore({ analysisApi: api, layoutClient: createFakeLayoutClient(), prefs: createPrefsStore(null) });
  store.actions.openInvestigation(fixture("triad"), null, { demo: false });
  return store;
}

describe("who-imports panel (7.4, 7.5, 7.8)", () => {
  it("lists direct and indirect importers sorted, with distances, and the limits sentence", () => {
    const store = setup();
    act(() => store.actions.openWhoImports("src/c.ts"));
    render(<WhoImportsPanel store={store} />);
    expect(screen.getByRole("heading", { name: "Who imports src/c.ts (static-value)" })).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Direct importers (1)" })).getAllByRole("button").map((b) => b.textContent)).toEqual(["src/b.ts \u00B7 1 step"]);
    expect(within(screen.getByRole("list", { name: "Indirect (2)" })).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "src/a.ts \u00B7 2 steps",
      "src/d.ts \u00B7 2 steps",
    ]);
    expect(screen.getByText("These modules reach src/c.ts through imports under this preset. They are places to inspect, not modules that will fail.")).toBeTruthy();
  });

  it("choosing an importer builds the route, selects its first step and shows the prose", () => {
    const store = setup();
    act(() => store.actions.openWhoImports("src/c.ts"));
    render(<WhoImportsPanel store={store} />);
    const button = screen.getByRole("button", { name: "src/a.ts \u00B7 2 steps" });
    button.focus();
    fireEvent.click(button);
    expect(store.getState().routeFilter).toMatchObject({ kind: "trace", modules: ["src/a.ts", "src/b.ts", "src/c.ts"] });
    expect(store.getState().routeFilter?.relationIds).toHaveLength(2);
    expect(store.getState().selection.kind).toBe("relation");
    expect(screen.getByText("src/a.ts reaches src/c.ts in 2 steps: src/a.ts imports src/b.ts, src/b.ts imports src/c.ts.")).toBeTruthy();
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute("aria-current")).toBe("true");
  });

  it("moves focus to its heading when it opens", () => {
    const store = setup();
    act(() => store.actions.openWhoImports("src/c.ts"));
    render(<WhoImportsPanel store={store} />);
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Who imports src/c.ts (static-value)" }));
  });

  it("shows the error text and keeps the previous filter and selection when trace throws", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let fail = false;
    const api = { ...analysisApi, trace: (...args: Parameters<typeof analysisApi.trace>) => (fail ? (() => { throw new Error("forced"); })() : analysisApi.trace(...args)) };
    const store = setup(api);
    act(() => {
      store.actions.openWhoImports("src/c.ts");
      store.actions.chooseImporter("src/a.ts");
    });
    const before = { filter: store.getState().routeFilter, selection: store.getState().selection };
    fail = true;
    act(() => store.actions.openWhoImports("src/c.ts"));
    render(<WhoImportsPanel store={store} />);
    expect(screen.getByText("Could not compute importers for this preset: forced.")).toBeTruthy();
    expect(store.getState().routeFilter).toEqual(before.filter);
    expect(store.getState().selection).toEqual(before.selection);
    error.mockRestore();
  });
});