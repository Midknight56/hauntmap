import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Toolbar } from "../../src/components/Toolbar";
import { analysisApi } from "../../src/features/investigation/analysisApi";
import { createPrefsStore } from "../../src/features/investigation/prefs";
import { createRegistry } from "../../src/features/investigation/registry";
import { createInvestigationStore } from "../../src/features/investigation/store";
import { createFakeLayoutClient, makeLayoutResult } from "./fakeLayoutClient";
import { fixture } from "./fixtureFiles";

afterEach(cleanup);

function setup() {
  const layoutClient = createFakeLayoutClient();
  const store = createInvestigationStore({ analysisApi, layoutClient, prefs: createPrefsStore(null) });
  store.actions.openInvestigation(fixture("triad"), null, { demo: true });
  const registry = createRegistry();
  return { store, registry, layoutClient };
}

const names = (container: HTMLElement): string[] =>
  [...container.querySelectorAll<HTMLElement>("button, select, input, [role=tab]")].map((el) => el.getAttribute("aria-label") ?? el.textContent ?? "");

describe("toolbar (10.1, 11.4)", () => {
  it("lists the controls in the Tab order of the spec (View, Snapshots, Help, Find, Zoom, Restart demo), with no empty slots", () => {
    const { store, registry } = setup();
    const { container } = render(<Toolbar store={store} registry={registry} />);
    expect(names(container)).toEqual([
      "Map",
      "Evidence",
      "Legend",
      "Show steps",
      "Motion",
      "Relation preset",
      "Dependency loops",
      "Fit to view",
      "Zoom in",
      "Zoom out",
      "Clear selection",
      "Restart demo",
    ]);
  });

  it("puts the controls in labelled groups: View, Find and Help, then the slot controls, then Restart demo alone", () => {
    const { store, registry } = setup();
    registry.registerControl("compare", () => createElement("button", { type: "button" }, "Compare revisions"));
    render(<Toolbar store={store} registry={registry} search={<input aria-label="Search modules" />} />);
    const groups = screen.getAllByRole("group").filter((g) => g.getAttribute("aria-label") !== "Toolbar");
    const inGroup = (label: string): string[] => {
      const group = groups.find((g) => (g.getAttribute("aria-label") ?? g.getAttribute("aria-labelledby") ?? "") !== "" && screen.getByRole("group", { name: label }) === g) as HTMLElement;
      return names(group);
    };
    expect(inGroup("View")).toEqual(["Map", "Evidence"]);
    expect(inGroup("Zoom")).toEqual(["Fit to view", "Zoom in", "Zoom out", "Clear selection"]);
    expect(inGroup("Find")).toEqual(["Search modules", "Relation preset", "Dependency loops"]);
    const order = [...document.querySelectorAll<HTMLElement>(".toolbar [role=group][aria-labelledby], .toolbar [role=group][aria-label]")].map((g) => g.getAttribute("aria-label") ?? document.getElementById(g.getAttribute("aria-labelledby") ?? "")?.textContent);
    expect(order).toEqual(["View", "Snapshots", "Help", "Find", "Zoom"]);
    expect(inGroup("Help")).toEqual(["Legend", "Show steps", "Motion"]);
    expect(inGroup("Snapshots")).toEqual(["Compare revisions"]);
    const all = [...document.querySelectorAll<HTMLElement>(".toolbar button, .toolbar select, .toolbar input")].map((el) => el.getAttribute("aria-label") ?? el.textContent ?? "");
    expect(all[all.length - 1]).toBe("Restart demo");
    const restart = screen.getByRole("button", { name: "Restart demo" });
    expect(restart.closest('[role="group"]')?.getAttribute("aria-label")).toBe("Toolbar");
  });

  it("makes Dependency loops the main action", () => {
    const { store, registry } = setup();
    render(<Toolbar store={store} registry={registry} />);
    const loops = screen.getByRole("button", { name: "Dependency loops" });
    expect(loops.classList.contains("primary")).toBe(true);
    expect(loops.classList.contains("toolbar-main")).toBe(true);
    for (const other of ["Legend", "Zoom in", "Fit to view", "Restart demo"]) {
      expect(screen.getByRole("button", { name: other }).classList.contains("primary")).toBe(false);
    }
  });

  it("renders registered slot controls in the order export, compare, live-snapshot, in the Snapshots group before Help", () => {
    const { store, registry } = setup();
    registry.registerControl("live-snapshot", () => createElement("button", { type: "button" }, "Open live snapshot"));
    registry.registerControl("export", () => createElement("button", { type: "button" }, "Export investigation"));
    registry.registerControl("compare", () => createElement("button", { type: "button" }, "Compare revisions"));
    const { container } = render(<Toolbar store={store} registry={registry} />);
    expect(names(container).slice(2, 5)).toEqual(["Export investigation", "Compare revisions", "Open live snapshot"]);
    expect(names(container).slice(-1)).toEqual(["Restart demo"]);
  });
  it("gives every control a name, Legend aria-expanded and Motion aria-pressed", () => {
    const { store, registry } = setup();
    const { container } = render(<Toolbar store={store} registry={registry} />);
    for (const el of container.querySelectorAll("button, select, input")) {
      expect((el.getAttribute("aria-label") ?? el.textContent ?? "").trim(), el.outerHTML).not.toBe("");
    }
    const legend = screen.getByRole("button", { name: "Legend" });
    expect(legend.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(legend);
    expect(legend.getAttribute("aria-expanded")).toBe("false");
    expect(store.getState().legendOpen).toBe(false);
    const motion = screen.getByRole("button", { name: "Motion" });
    expect(motion.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(motion);
    expect(motion.getAttribute("aria-pressed")).toBe("true");
    expect(store.getState().motion).toBe("reduce");
    fireEvent.click(motion);
    expect(store.getState().motion).toBe("system");
  });

  it("sends the preset, zoom and clear actions to the store", () => {
    const { store, registry, layoutClient } = setup();
    void layoutClient;
    render(<Toolbar store={store} registry={registry} />);
    fireEvent.change(screen.getByLabelText("Relation preset"), { target: { value: "type-inclusive" } });
    expect(store.getState().preset).toBe("type-inclusive");
    expect(store.getState().layoutRevision).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(store.getState().camera.zoom).toBeCloseTo(1.25, 9);
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(store.getState().camera.zoom).toBeCloseTo(1, 9);
    store.actions.select({ kind: "module", id: "src/a.ts" }, { from: "dom" });
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(store.getState().selection).toEqual({ kind: "none" });
  });

  it("fits the camera to the layout bounds", () => {
    const { store, registry, layoutClient } = setup();
    const layout = { ...makeLayoutResult("k"), bounds: { x: 0, y: 0, w: 936, h: 536 } };
    store.actions.layoutResult(layout, store.getState().layoutRevision);
    void layoutClient;
    render(<Toolbar store={store} registry={registry} />);
    fireEvent.click(screen.getByRole("button", { name: "Fit to view" }));
    expect(store.getState().camera).toMatchObject({ x: 468, y: 268, zoom: 1 });
  });

  it("switches the view with the tablist and moves with the arrow keys", () => {
    const { store, registry } = setup();
    render(<Toolbar store={store} registry={registry} />);
    const map = screen.getByRole("tab", { name: "Map" });
    const evidence = screen.getByRole("tab", { name: "Evidence" });
    expect(map.getAttribute("aria-selected")).toBe("true");
    expect(map.tabIndex).toBe(0);
    expect(evidence.tabIndex).toBe(-1);
    fireEvent.keyDown(map, { key: "ArrowRight" });
    expect(store.getState().activeView).toBe("evidence");
    fireEvent.click(map);
    expect(store.getState().activeView).toBe("map");
  });

  it("restart returns the store to the landing screen", () => {
    const { store, registry } = setup();
    render(<Toolbar store={store} registry={registry} />);
    fireEvent.click(screen.getByRole("button", { name: "Restart demo" }));
    expect(store.getState().screen).toBe("landing");
  });

  describe("on a phone (360 x 640)", () => {
    const original = window.matchMedia;
    afterEach(() => {
      window.matchMedia = original;
    });
    function phone(): void {
      window.matchMedia = ((query: string) => ({
        matches: /max-width:\s*720px/.test(query),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      })) as unknown as typeof window.matchMedia;
    }

    it("shows the brand, More and the search row, and keeps every other control behind More", () => {
      phone();
      const { store, registry } = setup();
      const { container } = render(<Toolbar store={store} registry={registry} search={<input aria-label="Search modules" />} />);
      expect(names(container)).toEqual(["More", "Search modules", "Dependency loops"]);
      const more = screen.getByRole("button", { name: "More" });
      expect(more.getAttribute("aria-expanded")).toBe("false");
      expect(container.textContent).toContain("HauntMap");
    });

    it("More opens View, Snapshots, Help, Restart demo and the zoom buttons, and closes again", () => {
      phone();
      const { store, registry } = setup();
      registry.registerControl("compare", () => createElement("button", { type: "button" }, "Compare revisions"));
      const { container } = render(<Toolbar store={store} registry={registry} search={<input aria-label="Search modules" />} />);
      const more = screen.getByRole("button", { name: "More" });
      fireEvent.click(more);
      expect(more.getAttribute("aria-expanded")).toBe("true");
      expect(names(container)).toEqual([
        "More",
        "Map",
        "Evidence",
        "Compare revisions",
        "Legend",
        "Show steps",
        "Motion",
        "Relation preset",
        "Fit to view",
        "Zoom in",
        "Zoom out",
        "Clear selection",
        "Restart demo",
        "Search modules",
        "Dependency loops",
      ]);
      fireEvent.keyDown(screen.getByRole("button", { name: "Legend" }), { key: "Escape" });
      expect(more.getAttribute("aria-expanded")).toBe("false");
      expect(screen.queryByRole("button", { name: "Legend" })).toBeNull();
    });
  });
});