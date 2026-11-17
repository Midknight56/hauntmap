import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EvidenceTrail, EMPTY_TRAIL_TEXT } from "../../src/components/EvidenceTrail";
import { EvidenceView } from "../../src/components/EvidenceView";
import { relationIdFor } from "./ids";
import { openedStore } from "./storeHarness";

afterEach(cleanup);

describe("Evidence view (6.5)", () => {
  it("has the heading with the preset and the four counted lists", () => {
    const { store } = openedStore("triad");
    render(<EvidenceView store={store} />);
    expect(screen.getByRole("heading", { name: "Evidence (static-value)" })).toBeTruthy();
    for (const name of ["Wings (1)", "Modules (4)", "Relations (3)", "Diagnostics (0)"]) {
      expect(screen.getByRole("list", { name })).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: "src \u00B7 4 modules" })).toBeTruthy();
  });

  it("lists the boundary relations with their kinds, resolution and membership", () => {
    const { store } = openedStore("boundary");
    render(<EvidenceView store={store} />);
    const list = screen.getByRole("list", { name: "Relations (3)" });
    expect(within(list).getAllByRole("button").map((b) => b.textContent).sort()).toEqual(
      [
        'src/app.ts imports "./ghosts/missing" \u00B7 import \u00B7 value \u00B7 unresolved \u00B7 in preset',
        'src/app.ts imports "@/lib/format" \u00B7 import \u00B7 value \u00B7 unresolved \u00B7 in preset',
        'src/app.ts imports "zod" \u00B7 import \u00B7 value \u00B7 external \u00B7 in preset',
      ].sort(),
    );
    expect(screen.getByRole("list", { name: "Diagnostics (2)" })).toBeTruthy();
  });

  it("says in preset or not in preset for every relation of mixed-presets.json, under each preset", () => {
    const { store } = openedStore("mixed-presets");
    const view = render(<EvidenceView store={store} />);
    const texts = () => within(screen.getByRole("list", { name: "Relations (3)" })).getAllByRole("button").map((b) => b.textContent ?? "");
    expect(texts().filter((t) => t.endsWith(" \u00B7 in preset"))).toHaveLength(1);
    expect(texts().filter((t) => t.endsWith("not in preset"))).toHaveLength(2);
    act(() => store.actions.setPreset("type-inclusive"));
    view.rerender(<EvidenceView store={store} />);
    expect(screen.getByRole("heading", { name: "Evidence (type-inclusive)" })).toBeTruthy();
    expect(texts().filter((t) => t.endsWith(" \u00B7 in preset"))).toHaveLength(2);
  });

  it("every item is a selecting button that sets the shared selection and carries aria-current", () => {
    const { store } = openedStore("triad");
    render(<EvidenceView store={store} />);
    fireEvent.click(screen.getByRole("button", { name: /^src\/b\.ts \u00B7 ok$/ }));
    expect(store.getState().selection).toEqual({ kind: "module", id: "src/b.ts" });
    expect(store.getState().selectionOrigin).toBe("dom");
    expect(store.getState().expandedWings).toEqual(["src"]);
    expect(screen.getByRole("button", { name: /^src\/b\.ts \u00B7 ok$/ }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("button", { name: /^src\/a\.ts \u00B7 ok$/ }).getAttribute("aria-current")).toBeNull();
    const relation = relationIdFor("src/a.ts", "src/b.ts", "import", "value");
    fireEvent.click(screen.getByRole("button", { name: "src/a.ts imports src/b.ts \u00B7 import \u00B7 value \u00B7 local \u00B7 in preset" }));
    expect(store.getState().selection).toMatchObject({ kind: "relation", relationId: relation });
    expect(screen.getByRole("button", { name: /^src\/a\.ts imports src\/b\.ts/ }).getAttribute("aria-current")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "src \u00B7 4 modules" }));
    expect(store.getState().selection).toEqual({ kind: "wing", wing: "src" });
  });

  it("selects the module of a diagnostic", () => {
    const { store } = openedStore("boundary");
    render(<EvidenceView store={store} />);
    const list = screen.getByRole("list", { name: "Diagnostics (2)" });
    fireEvent.click(within(list).getAllByRole("button")[0]!);
    expect(store.getState().selection).toEqual({ kind: "module", id: "src/app.ts" });
  });

  it("filters to one wing when the grouped room asks for it, and shows every wing again on request", () => {
    const { store } = openedStore("two-wings");
    act(() => store.actions.setView("evidence", "src/orders"));
    render(<EvidenceView store={store} />);
    expect(screen.getByRole("list", { name: "Modules (3)" })).toBeTruthy();
    expect(screen.getByText("Showing the wing src/orders only.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show every wing" }));
    expect(store.getState().evidenceWingFilter).toBeNull();
    expect(screen.getByRole("list", { name: "Modules (5)" })).toBeTruthy();
  });

  it("shows ids and specifiers with markup characters as text", () => {
    const { store } = openedStore("escaped");
    const view = render(<EvidenceView store={store} />);
    expect(view.container.textContent).toContain("src/a&b.ts");
    expect(view.container.textContent).toContain('"./<img src=x onerror=alert(1)>"');
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("Evidence trail (6.4, 11.2)", () => {
  it("shows the empty-state sentence without a route filter", () => {
    const { store } = openedStore("cycle");
    render(<EvidenceTrail store={store} />);
    expect(screen.getByText(EMPTY_TRAIL_TEXT)).toBeTruthy();
    expect(EMPTY_TRAIL_TEXT).toBe("Select a loop or a module to build an evidence trail.");
  });

  it("lists the witness relations as steps, marks the current one and uses a roving tabindex", () => {
    const { store } = openedStore("cycle");
    act(() => {
      store.actions.openLoops();
      store.actions.chooseLoop(0);
    });
    render(<EvidenceTrail store={store} />);
    const region = screen.getByRole("region", { name: "Evidence trail" });
    const buttons = within(region).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Step 1: src/x.ts imports src/y.ts (line 1)", "Step 2: src/y.ts imports src/x.ts (line 1)"]);
    expect(buttons[0]!.getAttribute("aria-current")).toBe("step");
    expect(buttons[1]!.getAttribute("aria-current")).toBeNull();
    expect(buttons.map((b) => b.getAttribute("tabindex"))).toEqual(["0", "-1"]);
    buttons[0]!.focus();
    fireEvent.keyDown(buttons[0]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(buttons[1]);
    expect(buttons.map((b) => b.getAttribute("tabindex"))).toEqual(["-1", "0"]);
    fireEvent.keyDown(buttons[1]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(buttons[1]);
    fireEvent.keyDown(buttons[1]!, { key: "Home" });
    expect(document.activeElement).toBe(buttons[0]);
    fireEvent.keyDown(buttons[0]!, { key: "End" });
    expect(document.activeElement).toBe(buttons[1]);
    fireEvent.keyDown(buttons[1]!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(buttons[0]);
  });

  it("selecting a step selects its relation and moves aria-current", () => {
    const { store } = openedStore("cycle");
    act(() => {
      store.actions.openLoops();
      store.actions.chooseLoop(0);
    });
    render(<EvidenceTrail store={store} />);
    fireEvent.click(screen.getByRole("button", { name: "Step 2: src/y.ts imports src/x.ts (line 1)" }));
    expect(store.getState().selection).toMatchObject({ kind: "relation", relationId: relationIdFor("src/y.ts", "src/x.ts", "import", "value") });
    expect(screen.getByRole("button", { name: /^Step 2/ }).getAttribute("aria-current")).toBe("step");
    expect(screen.getByRole("button", { name: /^Step 1/ }).getAttribute("aria-current")).toBeNull();
  });
});
