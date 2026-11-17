import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Legend, LEGEND_ENTRIES, LEGEND_FOOTER } from "../../src/components/Legend";
import { Toolbar } from "../../src/components/Toolbar";
import { createRegistry } from "../../src/features/investigation/registry";
import { newStore } from "./storeHarness";

afterEach(cleanup);

const WORDING = [
  "Module: room",
  "Folder: wing",
  "Import or re-export: door and arrow",
  "Dependency cycle: looping corridor",
  "Unresolved or external import: sealed doorway with ?",
  "Not in this traversal: subdued room",
  "Dependency path: traveling light",
];

describe("legend (5.1, 5.5, 5.6)", () => {
  it("lists the seven entries in the order and wording of the requirement", () => {
    expect(LEGEND_ENTRIES.map((e) => `${e.concept}: ${e.costume}`)).toEqual(WORDING);
    const { store } = newStore();
    render(<Legend store={store} registry={createRegistry()} />);
    const list = screen.getByRole("list", { name: "Legend entries" });
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual(WORDING);
  });

  it("ends with the footer sentence", () => {
    const { store } = newStore();
    render(<Legend store={store} registry={createRegistry()} />);
    expect(LEGEND_FOOTER).toBe("Rooms show files and doors show imports found in the source. The map does not show runtime behaviour, test coverage or risk.");
    expect(screen.getByText(LEGEND_FOOTER)).toBeTruthy();
  });

  it("appends the entries of a registered provider only while it returns some", () => {
    const { store } = newStore();
    const registry = createRegistry();
    let active = false;
    registry.registerLegendEntries(() => (active ? [{ concept: "Changed source", costume: "amber lamp" }] : []));
    const view = render(<Legend store={store} registry={registry} />);
    expect(screen.queryByText("Changed source: amber lamp")).toBeNull();
    active = true;
    view.rerender(<Legend store={store} registry={registry} />);
    const items = within(screen.getByRole("list", { name: "Legend entries" })).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([...WORDING, "Changed source: amber lamp"]);
  });

  it("renders nothing while it is closed, and the toolbar toggle opens it and carries aria-expanded", () => {
    const { store } = newStore();
    const registry = createRegistry();
    render(
      <>
        <Toolbar store={store} registry={registry} />
        <Legend store={store} registry={registry} />
      </>,
    );
    const toggle = screen.getByRole("button", { name: "Legend" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("region", { name: "Legend" })).toBeTruthy();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("region", { name: "Legend" })).toBeNull();
    act(() => store.actions.setLegendOpen(true));
    expect(screen.getByRole("region", { name: "Legend" })).toBeTruthy();
  });
});