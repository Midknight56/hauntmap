import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Breadcrumb } from "../../src/components/Breadcrumb";
import { MAP_HELP, MapView } from "../../src/components/MapView";
import { getViewportSize } from "../../src/components/viewport";
import { Minimap } from "../../src/components/Minimap";
import { analysisApi } from "../../src/features/investigation/analysisApi";
import { createPrefsStore } from "../../src/features/investigation/prefs";
import { createInvestigationStore } from "../../src/features/investigation/store";
import { toScreen } from "../../src/scene/camera";
import type { LayoutResult } from "../../src/scene/layout/types";
import type { SceneInit, SceneOptions } from "../../src/scene/types";
import { createFakeLayoutClient, flush, makeLayoutResult } from "./fakeLayoutClient";
import { createFakeScene, type FakeScene } from "./fakeScene";
import { fixture } from "./fixtureFiles";

afterEach(cleanup);

const layout: LayoutResult = {
  ...makeLayoutResult("k1"),
  wings: [
    { wing: "src", x: 0, y: 0, w: 400, h: 200, moduleCount: 4, expanded: true, rank: 0, shownIds: ["src/a.ts"], hiddenCount: 0 },
    { wing: "src/other", x: 600, y: 0, w: 144, h: 120, moduleCount: 1, expanded: false, rank: 1, shownIds: [], hiddenCount: 1 },
  ],
  rooms: [{ id: "src/a.ts", wing: "src", x: 24, y: 40, w: 96, h: 64, label: "a.ts" }],
  bounds: { x: -32, y: -32, w: 808, h: 264 },
};

function setup(inits: SceneInit[] | null = null) {
  const layoutClient = createFakeLayoutClient();
  const store = createInvestigationStore({ analysisApi, layoutClient, prefs: createPrefsStore(null) });
  store.actions.openInvestigation(fixture("triad"), null, { demo: false });
  const scenes: FakeScene[] = [];
  let calls = 0;
  const createScene = vi.fn<(options: SceneOptions) => Promise<SceneInit>>(async () => {
    const planned = inits?.[calls++];
    if (planned !== undefined) return planned;
    const fake = createFakeScene();
    scenes.push(fake);
    return { ok: true, scene: fake.handle };
  });
  return { store, createScene, scenes, layoutClient };
}

async function mount(ctx: ReturnType<typeof setup>) {
  const view = render(
    <>
      <MapView store={ctx.store} createScene={ctx.createScene} />
      <aside aria-label="Inspector">
        <h2 tabIndex={-1}>Inspector</h2>
      </aside>
    </>,
  );
  await act(async () => {
    await flush();
  });
  return view;
}

describe("map wrapper (11.2)", () => {
  it("is one Tab stop with the application role, the name and the help text", async () => {
    const ctx = setup();
    await mount(ctx);
    const wrapper = screen.getByRole("application", { name: "Haunted map" });
    expect(wrapper.getAttribute("tabindex")).toBe("0");
    const help = document.getElementById(wrapper.getAttribute("aria-describedby") ?? "");
    expect(help?.textContent).toBe(MAP_HELP);
    expect(MAP_HELP).toBe(
      "Arrow keys pan, plus and minus zoom, 0 fits the map, F focuses the selected room, I moves to the inspector, Escape clears the selection, Tab leaves the map.",
    );
  });

  it("pans 80 px per arrow press and 320 with Shift, zooms by 1.25, fits with 0, and ignores keys with a modifier", async () => {
    const ctx = setup();
    await mount(ctx);
    const wrapper = screen.getByRole("application");
    act(() => ctx.store.actions.layoutResult({ ...layout, bounds: { x: 0, y: 0, w: 936, h: 536 } }, ctx.store.getState().layoutRevision));
    act(() => ctx.store.actions.setCamera({ x: 0, y: 0, zoom: 1 }));
    wrapper.focus();
    fireEvent.keyDown(wrapper, { key: "ArrowRight" });
    expect(ctx.store.getState().camera).toMatchObject({ x: 80, y: 0, zoom: 1 });
    fireEvent.keyDown(wrapper, { key: "ArrowDown", shiftKey: true });
    expect(ctx.store.getState().camera).toMatchObject({ x: 80, y: 320 });
    fireEvent.keyDown(wrapper, { key: "ArrowLeft" });
    fireEvent.keyDown(wrapper, { key: "ArrowUp", shiftKey: true });
    expect(ctx.store.getState().camera).toMatchObject({ x: 0, y: 0 });
    fireEvent.keyDown(wrapper, { key: "+" });
    expect(ctx.store.getState().camera.zoom).toBeCloseTo(1.25, 9);
    fireEvent.keyDown(wrapper, { key: "=" });
    expect(ctx.store.getState().camera.zoom).toBeCloseTo(1.5625, 9);
    fireEvent.keyDown(wrapper, { key: "-" });
    expect(ctx.store.getState().camera.zoom).toBeCloseTo(1.25, 9);
    fireEvent.keyDown(wrapper, { key: "0" });
    expect(ctx.store.getState().camera).toMatchObject({ x: 468, y: 268, zoom: 1 });
    const before = ctx.store.getState().camera;
    fireEvent.keyDown(wrapper, { key: "ArrowRight", ctrlKey: true });
    expect(ctx.store.getState().camera).toEqual(before);
  });

  it("F focuses the selected module, I moves to the inspector heading, Escape clears the selection", async () => {
    const ctx = setup();
    await mount(ctx);
    const wrapper = screen.getByRole("application");
    wrapper.focus();
    fireEvent.keyDown(wrapper, { key: "f" });
    expect(ctx.store.getState().routeFilter).toBeNull();
    act(() => ctx.store.actions.select({ kind: "module", id: "src/b.ts" }, { from: "dom" }));
    fireEvent.keyDown(wrapper, { key: "F" });
    expect(ctx.store.getState().routeFilter?.kind).toBe("focus");
    expect(ctx.store.getState().status).toBe("Focused on src/b.ts: 2 importers, 1 imports.");
    fireEvent.keyDown(wrapper, { key: "i" });
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Inspector" }));
    wrapper.focus();
    fireEvent.keyDown(wrapper, { key: "Escape" });
    expect(ctx.store.getState().selection).toEqual({ kind: "none" });
    expect(ctx.store.getState().routeFilter).toBeNull();
  });
});

describe("scene wiring (6.7, 9.2)", () => {
  it("mounts the scene once, draws the layout, style state and camera, and destroys it on unmount", async () => {
    const ctx = setup();
    const view = await mount(ctx);
    const fake = ctx.scenes[0]!;
    expect(ctx.createScene).toHaveBeenCalledTimes(1);
    expect(ctx.createScene.mock.calls[0]?.[0]).toMatchObject({ forceFailure: false });
    act(() => ctx.store.actions.layoutResult(layout, ctx.store.getState().layoutRevision));
    expect(fake.lastLayout?.layoutKey).toBe("k1");
    act(() => ctx.store.actions.select({ kind: "module", id: "src/a.ts" }, { from: "dom" }));
    expect(fake.lastStyleState?.selection).toEqual({ kind: "module", id: "src/a.ts" });
    act(() => ctx.store.actions.setCamera({ x: 5, y: 6, zoom: 2 }));
    expect(fake.handle.getCamera()).toEqual({ x: 5, y: 6, zoom: 2 });
    view.unmount();
    expect(fake.destroyed).toBe(true);
  });

  it("turns scene clicks into selections and keeps focus on the wrapper", async () => {
    const ctx = setup();
    await mount(ctx);
    const fake = ctx.scenes[0]!;
    const wrapper = screen.getByRole("application");
    act(() => ctx.store.actions.layoutResult(layout, ctx.store.getState().layoutRevision));
    act(() => fake.emit("select", { kind: "room", id: "src/a.ts", rect: { x: 0, y: 0, w: 1, h: 1 } }));
    expect(ctx.store.getState().selection).toEqual({ kind: "module", id: "src/a.ts" });
    expect(ctx.store.getState().selectionOrigin).toBe("scene");
    expect(document.activeElement).toBe(wrapper);
    act(() => fake.emit("select", { kind: "door", id: "rel-1", rect: { x: 0, y: 0, w: 1, h: 1 } }));
    expect(ctx.store.getState().selection).toMatchObject({ kind: "relation", relationId: "rel-1" });
    act(() => fake.emit("select", { kind: "sealed", id: "rel-2", rect: { x: 0, y: 0, w: 1, h: 1 } }));
    expect(ctx.store.getState().selection).toMatchObject({ kind: "relation", relationId: "rel-2" });
    act(() => fake.emit("select", { kind: "wing", id: "src", rect: { x: 0, y: 0, w: 1, h: 1 } }));
    expect(ctx.store.getState().selection).toEqual({ kind: "wing", wing: "src" });
    expect(ctx.store.getState().expandedWings).toContain("src");
    const before = ctx.store.getState().selection;
    act(() => fake.emit("select", null));
    expect(ctx.store.getState().selection).toEqual(before);
    act(() => fake.emit("select", { kind: "grouped", id: "src", rect: { x: 0, y: 0, w: 1, h: 1 } }));
    expect(ctx.store.getState().activeView).toBe("evidence");
    expect(ctx.store.getState().evidenceWingFilter).toBe("src");
  });
});

describe("renderer fallback (12.1 to 12.3)", () => {
  const fail: SceneInit = { ok: false, reason: "no-webgl", message: "WebGL unsupported" };
  const BANNER = "The illustrated map could not start in this browser. The Evidence view has every room, door and corridor as lists.";

  it("shows the banner, opens the Evidence view, keeps the state and focuses Retry map", async () => {
    const ctx = setup([fail]);
    act(() => ctx.store.actions.select({ kind: "module", id: "src/a.ts" }, { from: "dom" }));
    await mount(ctx);
    expect(screen.getByText(BANNER)).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Retry map" }));
    expect(screen.getByRole("button", { name: "Open Evidence view" })).toBeTruthy();
    expect(ctx.store.getState().activeView).toBe("evidence");
    expect(ctx.store.getState().renderer).toMatchObject({ status: "unavailable", reason: "no-webgl" });
    expect(ctx.store.getState().selection).toEqual({ kind: "module", id: "src/a.ts" });
  });

  it("Retry map that fails again keeps the banner and the focus; one that succeeds draws the current state", async () => {
    const ctx = setup([fail, fail]);
    await mount(ctx);
    const retry = screen.getByRole("button", { name: "Retry map" });
    await act(async () => {
      fireEvent.click(retry);
      await flush();
    });
    expect(ctx.createScene).toHaveBeenCalledTimes(2);
    expect(screen.getByText(BANNER)).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Retry map" }));
    act(() => ctx.store.actions.layoutResult(layout, ctx.store.getState().layoutRevision));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry map" }));
      await flush();
    });
    expect(ctx.createScene).toHaveBeenCalledTimes(3);
    expect(screen.queryByText(BANNER)).toBeNull();
    expect(ctx.scenes[0]?.lastLayout?.layoutKey).toBe("k1");
    expect(ctx.store.getState().renderer.status).toBe("ready");
  });

  it("Open Evidence view switches the view", async () => {
    const ctx = setup([fail]);
    await mount(ctx);
    act(() => ctx.store.actions.setView("map"));
    fireEvent.click(screen.getByRole("button", { name: "Open Evidence view" }));
    expect(ctx.store.getState().activeView).toBe("evidence");
  });

  it("forceFailure in the options is passed to createScene", async () => {
    const ctx = setup();
    const view = render(<MapView store={ctx.store} createScene={ctx.createScene} forceFailure />);
    await act(async () => {
      await flush();
    });
    expect(ctx.createScene.mock.calls[0]?.[0]).toMatchObject({ forceFailure: true });
    view.unmount();
  });

  it("context loss shows the retrying text; a restore clears it; no restore shows the banner", async () => {
    const ctx = setup();
    await mount(ctx);
    const fake = ctx.scenes[0]!;
    act(() => fake.emit("contextlost"));
    expect(screen.getByText("The map lost its graphics context. Retrying\u2026")).toBeTruthy();
    expect(ctx.store.getState().renderer.status).toBe("context-lost");
    act(() => fake.emit("contextrestored"));
    expect(screen.queryByText("The map lost its graphics context. Retrying\u2026")).toBeNull();
    expect(ctx.store.getState().renderer.status).toBe("ready");
    act(() => fake.emit("contextlost"));
    act(() => fake.emit("contextfailed"));
    expect(screen.getByText(BANNER)).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Retry map" }));
  });
});

describe("layout failure and the usable mark (3.7, 1.9)", () => {
  it("shows Retry layout beside the map when the layout failed, and sends one request", async () => {
    const ctx = setup();
    await mount(ctx);
    act(() => ctx.store.actions.layoutFailed("boom", ctx.store.getState().layoutRevision));
    const before = ctx.layoutClient.requests.length;
    fireEvent.click(screen.getByRole("button", { name: "Retry layout" }));
    expect(ctx.layoutClient.requests.length).toBe(before + 1);
  });

  it.runIf(typeof performance.mark === "function")("marks hauntmap:usable once, when the first room is drawn", async () => {
    performance.clearMarks("hauntmap:usable");
    const ctx = setup();
    await mount(ctx);
    expect(performance.getEntriesByName("hauntmap:usable")).toHaveLength(0);
    act(() => ctx.store.actions.layoutResult(layout, ctx.store.getState().layoutRevision));
    expect(performance.getEntriesByName("hauntmap:usable")).toHaveLength(1);
    act(() => ctx.store.actions.layoutResult({ ...layout, layoutKey: "k2" }, ctx.store.getState().layoutRevision));
    expect(performance.getEntriesByName("hauntmap:usable")).toHaveLength(1);
  });

  it("fits the camera to every wing on the first layout, whatever is expanded, and not again", async () => {
    const ctx = setup();
    act(() => ctx.store.actions.expandWing("src"));
    await mount(ctx);
    act(() => ctx.store.actions.layoutResult(layout, ctx.store.getState().layoutRevision));
    const fitted = ctx.store.getState().camera;
    expect(fitted).toMatchObject({ x: layout.bounds.x + layout.bounds.w / 2, y: layout.bounds.y + layout.bounds.h / 2 });
    const view = getViewportSize();
    for (const wing of layout.wings) {
      const topLeft = toScreen(fitted, view, { x: wing.x, y: wing.y });
      const bottomRight = toScreen(fitted, view, { x: wing.x + wing.w, y: wing.y + wing.h });
      expect(topLeft.x).toBeGreaterThanOrEqual(0);
      expect(topLeft.y).toBeGreaterThanOrEqual(0);
      expect(bottomRight.x).toBeLessThanOrEqual(view.width);
      expect(bottomRight.y).toBeLessThanOrEqual(view.height);
    }
    act(() => ctx.store.actions.setCamera({ x: 1, y: 2, zoom: 3 }));
    act(() => ctx.store.actions.layoutResult({ ...layout, layoutKey: "k2" }, ctx.store.getState().layoutRevision));
    expect(ctx.store.getState().camera).toEqual({ x: 1, y: 2, zoom: 3 });
  });
});

describe("minimap and breadcrumb (4.6, 4.7)", () => {
  it("draws the wing regions and the viewport in a 180 x 110 aria-hidden box, and a click moves the camera center", async () => {
    const ctx = setup();
    act(() => ctx.store.actions.layoutResult(layout, ctx.store.getState().layoutRevision));
    const { container } = render(<Minimap store={ctx.store} />);
    const box = container.querySelector("svg")!;
    expect(box.getAttribute("aria-hidden")).toBe("true");
    expect(box.getAttribute("width")).toBe("180");
    expect(box.getAttribute("height")).toBe("110");
    expect(container.querySelectorAll("rect[data-wing]")).toHaveLength(2);
    expect(container.querySelectorAll("rect[data-viewport]")).toHaveLength(1);
    vi.spyOn(box, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 180, height: 110, right: 180, bottom: 110, x: 0, y: 0, toJSON: () => ({}) });
    const before = ctx.store.getState().camera;
    fireEvent.click(box, { clientX: 90, clientY: 55 });
    const after = ctx.store.getState().camera;
    expect(after.zoom).toBe(before.zoom);
    expect(after.x).toBeCloseTo(layout.bounds.x + layout.bounds.w / 2, 5);
    expect(after.y).toBeCloseTo(layout.bounds.y + layout.bounds.h / 2, 5);
  });

  it("shows <sourceLabel> › <wing> for the wing under the camera center and does not change with the selection", async () => {
    const ctx = setup();
    act(() => ctx.store.actions.layoutResult(layout, ctx.store.getState().layoutRevision));
    act(() => ctx.store.actions.setCamera({ x: 100, y: 100, zoom: 1 }));
    render(<Breadcrumb store={ctx.store} />);
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(nav.textContent).toBe("triad \u203A src");
    act(() => ctx.store.actions.select({ kind: "wing", wing: "src/other" }, { from: "dom" }));
    expect(nav.textContent).toBe("triad \u203A src");
    act(() => ctx.store.actions.setCamera({ x: 5000, y: 5000, zoom: 1 }));
    expect(nav.textContent).toBe("triad");
  });
});
