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
  it("lists the controls in the Tab order of the spec, with no empty slots", () => {
    const { store, registry } = setup();
    const { container } = render(<Toolbar store={store} registry={registry} />);
    expect(names(container)).toEqual([
      "Restart demo",
      "Relation preset",
      "Dependency loops",
      "Legend",
      "Motion",
      "Zoom in",
      "Zoom out",
      "Fit to view",
      "Clear selection",
      "Map",
      "Evidence",
      "Show steps",
    ]);
  });

  it("renders registered slot controls after the tablist, in the order export, compare, live-snapshot", () => {
    const { store, registry } = setup();
    registry.registerControl("live-snapshot", () => createElement("button", { type: "button" }, "Open live snapshot"));
    registry.registerControl("export", () => createElement("button", { type: "button" }, "Export investigation"));
    registry.registerControl("compare", () => createElement("button", { type: "button" }, "Compare revisions"));
    const { container } = render(<Toolbar store={store} registry={registry} />);
    expect(names(container).slice(-3)).toEqual(["Export investigation", "Compare revisions", "Open live snapshot"]);
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
});