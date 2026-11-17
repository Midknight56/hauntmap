import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoopsPanel, countWords } from "../../src/components/LoopsPanel";
import { analysisApi } from "../../src/features/investigation/analysisApi";
import { createPrefsStore } from "../../src/features/investigation/prefs";
import { createInvestigationStore } from "../../src/features/investigation/store";
import { relationIdFor } from "./ids";
import { createFakeLayoutClient } from "./fakeLayoutClient";
import { fixture, type FixtureName } from "./fixtureFiles";

afterEach(cleanup);

function setup(name: FixtureName, api = analysisApi) {
  const store = createInvestigationStore({ analysisApi: api, layoutClient: createFakeLayoutClient(), prefs: createPrefsStore(null) });
  store.actions.openInvestigation(fixture(name), null, { demo: false });
  return store;
}

describe("loops panel (7.1 to 7.3, 7.8)", () => {
  it("shows the heading with the preset, the count and one button per component in report order", () => {
    const store = setup("cycle");
    act(() => store.actions.openLoops());
    render(<LoopsPanel store={store} />);
    expect(screen.getByRole("heading", { name: "Dependency loops (static-value)" })).toBeTruthy();
    expect(screen.getByText("2 loops")).toBeTruthy();
    const list = screen.getByRole("list", { name: "Loops" });
    expect(within(list).getAllByRole("button").map((b) => b.textContent)).toEqual(["2 modules: src/x.ts, src/y.ts", "Self-import: src/z.ts"]);
  });

  it("says `1 loop`, `0 loops` and `2 loops`: the plural is for 0 or 2 and more", () => {
    for (const [name, words] of [["triad", "0 loops"], ["boundary", "0 loops"]] as const) {
      const store = setup(name);
      act(() => store.actions.openLoops());
      const { unmount } = render(<LoopsPanel store={store} />);
      expect(screen.getByText(words)).toBeTruthy();
      unmount();
    }
    expect(countWords(1)).toBe("1 loop");
    expect(countWords(0)).toBe("0 loops");
    expect(countWords(2)).toBe("2 loops");
  });

  it("moves focus to its heading when it opens", () => {
    const store = setup("cycle");
    act(() => store.actions.openLoops());
    render(<LoopsPanel store={store} />);
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Dependency loops (static-value)" }));
  });

  it("an open panel does not take focus, and asking for it again (the Dependency loops button) moves focus to the heading", () => {
    const store = setup("cycle");
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    act(() => store.actions.openLoops());
    render(<LoopsPanel store={store} />);
    outside.focus();
    // Same panel, another request: a preset change or a chosen component must not do this, the button does.
    act(() => store.actions.openLoops());
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Dependency loops (static-value)" }));
    outside.remove();
  });

  it("choosing a component sets the witness filter, selects the first relation and keeps focus on the button", () => {
    const store = setup("cycle");
    act(() => store.actions.openLoops());
    render(<LoopsPanel store={store} />);
    const button = screen.getByRole("button", { name: "2 modules: src/x.ts, src/y.ts" });
    button.focus();
    fireEvent.click(button);
    const state = store.getState();
    expect(state.routeFilter).toMatchObject({ kind: "witness", modules: ["src/x.ts", "src/y.ts"] });
    expect(state.routeFilter?.relationIds).toEqual([
      relationIdFor("src/x.ts", "src/y.ts", "import", "value"),
      relationIdFor("src/y.ts", "src/x.ts", "import", "value"),
    ]);
    expect(state.selection).toMatchObject({ kind: "relation", relationId: relationIdFor("src/x.ts", "src/y.ts", "import", "value") });
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute("aria-current")).toBe("true");
  });

  it("says nothing about type-only relations under static-value and states the limits under the other presets", () => {
    const store = setup("cycle");
    act(() => store.actions.openLoops());
    const view = render(<LoopsPanel store={store} />);
    expect(screen.queryByText(/type-only/)).toBeNull();
    act(() => store.actions.setPreset("type-inclusive"));
    view.rerender(<LoopsPanel store={store} />);
    expect(screen.getByRole("heading", { name: "Dependency loops (type-inclusive)" })).toBeTruthy();
    expect(screen.getByText("This preset includes type-only relations, which the static-value preset leaves out; a loop that exists only here is not a runtime import cycle.")).toBeTruthy();
    act(() => store.actions.setPreset("dynamic-inclusive"));
    view.rerender(<LoopsPanel store={store} />);
    expect(screen.getByText("This preset also includes literal dynamic imports.")).toBeTruthy();
  });

  it("recomputes with the same index when the preset changes", () => {
    const store = setup("cycle");
    act(() => {
      store.actions.openLoops();
      store.actions.chooseLoop(1);
    });
    render(<LoopsPanel store={store} />);
    act(() => store.actions.setPreset("type-inclusive"));
    expect(store.getState().panel).toMatchObject({ kind: "loops", chosen: 1 });
    expect(screen.getByRole("button", { name: "Self-import: src/z.ts" }).getAttribute("aria-current")).toBe("true");
  });

  it("shows the error text, keeps the earlier filter and selection, and logs without a path", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let fail = false;
    const api = { ...analysisApi, cycles: (...args: Parameters<typeof analysisApi.cycles>) => (fail ? (() => { throw new Error("forced"); })() : analysisApi.cycles(...args)) };
    const store = setup("cycle", api);
    act(() => {
      store.actions.openLoops();
      store.actions.chooseLoop(0);
    });
    const before = { filter: store.getState().routeFilter, selection: store.getState().selection };
    fail = true;
    act(() => store.actions.openLoops());
    render(<LoopsPanel store={store} />);
    expect(screen.getByText("Could not compute loops for this preset: forced.")).toBeTruthy();
    expect(store.getState().routeFilter).toEqual(before.filter);
    expect(store.getState().selection).toEqual(before.selection);
    expect(error).toHaveBeenCalled();
    expect(String(error.mock.calls[0]?.[0])).not.toContain("src/");
    error.mockRestore();
  });
});