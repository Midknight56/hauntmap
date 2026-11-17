import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Inspector } from "../../src/components/Inspector";
import { Search } from "../../src/components/Search";
import { makeInvestigation } from "./generators";
import { openedStore } from "./storeHarness";

afterEach(cleanup);

function mount(name: Parameters<typeof openedStore>[0] = "triad") {
  const ctx = openedStore(name);
  render(
    <>
      <Search store={ctx.store} />
      <Inspector store={ctx.store} />
    </>,
  );
  const input = screen.getByRole("combobox", { name: "Search modules" }) as HTMLInputElement;
  return { ...ctx, input };
}

function type(input: HTMLInputElement, value: string): void {
  fireEvent.change(input, { target: { value } });
}

describe("search combobox (4.1)", () => {
  it("follows the combobox pattern: expanded only while a list is shown, controls a listbox of options", () => {
    const { input } = mount();
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("listbox")).toBeNull();
    type(input, "SRC/");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    const listbox = screen.getByRole("listbox");
    expect(input.getAttribute("aria-controls")).toBe(listbox.id);
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"]);
    expect(screen.getByText("4 matches")).toBeTruthy();
  });

  it("says `1 matches` for one match, as the spec words it", () => {
    const { input } = mount();
    type(input, "c.ts");
    expect(screen.getByText("1 matches")).toBeTruthy();
  });

  it("shows at most 20 options and `20 of <n> matches`", () => {
    const inv = makeInvestigation({ wings: { "src/big": 120 }, relationsPerModule: 0, seed: 1 });
    const { input } = mount(inv);
    type(input, "m0");
    expect(screen.getAllByRole("option")).toHaveLength(20);
    expect(screen.getByText("20 of 100 matches")).toBeTruthy();
  });

  it("moves the active option with ArrowDown and ArrowUp and names it in aria-activedescendant", () => {
    const { input } = mount();
    type(input, "src/");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const options = screen.getAllByRole("option");
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0]!.id);
    expect(options[0]!.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(options[1]!.id);
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0]!.id);
  });

  it("Escape closes the list and keeps the query", () => {
    const { input } = mount();
    type(input, "src/");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(input.value).toBe("src/");
  });
});

describe("choosing a result (4.2)", () => {
  it("Enter on the active option selects the module, expands its wing, focuses the inspector heading and keeps the query", () => {
    const { store, input } = mount();
    type(input, "c.ts");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(store.getState().selection).toEqual({ kind: "module", id: "src/c.ts" });
    expect(store.getState().selectionOrigin).toBe("dom");
    expect(store.getState().expandedWings).toEqual(["src"]);
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 2 }));
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("src/c.ts");
    expect(input.value).toBe("c.ts");
    expect(store.getState().searchQuery).toBe("c.ts");
  });

  it("a click on an option does the same", () => {
    const { store, input } = mount();
    type(input, "b.ts");
    fireEvent.click(screen.getByRole("option", { name: "src/b.ts" }));
    expect(store.getState().selection).toEqual({ kind: "module", id: "src/b.ts" });
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 2 }));
  });

  it("brings a module beyond the first 80 of its wing into view", () => {
    const inv = makeInvestigation({ wings: { "src/big": 120 }, relationsPerModule: 0, seed: 1 });
    const { store, layoutClient, input } = mount(inv);
    const before = layoutClient.requests.length;
    type(input, "m119");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(layoutClient.requests.length).toBe(before + 1);
    const wing = layoutClient.requests.at(-1)!.payload.expandedWings.find((w) => w.wing === "src/big")!;
    expect(wing.shownIds).toContain("src/big/m119.ts");
    expect(store.getState().selection).toEqual({ kind: "module", id: "src/big/m119.ts" });
  });
});

describe("no match (4.3)", () => {
  it("shows the exact message in the list area and the status region and leaves the selection alone", () => {
    const { store, input } = mount();
    act(() => store.actions.select({ kind: "module", id: "src/a.ts" }, { from: "dom" }));
    type(input, 'zz"<b>');
    expect(screen.getByText('No module matches "zz"<b>".')).toBeTruthy();
    expect(store.getState().status).toBe('No module matches "zz"<b>".');
    expect(store.getState().selection).toEqual({ kind: "module", id: "src/a.ts" });
    expect(document.querySelector("b")).toBeNull();
  });
});
