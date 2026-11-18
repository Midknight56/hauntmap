import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ambientLoops } from "../features/investigation/ambientLoops";
import type { InvestigationStore, ViewState } from "../features/investigation/store";
import { FIRST_VIEW_MIN_ZOOM, zoomAround } from "../scene/camera";
import { frameAround, frameRects } from "../scene/frame";
import type { Rect } from "../scene/layout/types";
import { focusTargetOf, stepRectsOf } from "./focusTarget";
import type { createScene as CreateScene } from "../scene/adapter";
import type { HitTarget, SceneHandle } from "../scene/types";
import { fitView, pan, PAN_STEP, PAN_STEP_SHIFT, zoomBy, ZOOM_STEP } from "./cameraControls";
import { DEVHOOK_ENABLED, devState } from "./devHook";
import { COMPACT_WIDTH, firstViewPlan } from "./firstFit";
import { Minimap } from "./Minimap";
import { Tooltip } from "./Tooltip";
import { easeNextCamera, takeCameraEase } from "./cameraEase";
import { useReducedMotion } from "./useReducedMotion";
import { useViewState } from "./useStore";
import { getViewportSize, setViewportSize } from "./viewport";

export const MAP_HELP =
  "Arrow keys pan, plus and minus zoom, 0 fits the map, F focuses the selected room, I moves to the inspector, Escape clears the selection, Tab leaves the map.";
export const BANNER_TEXT = "The illustrated map could not start in this browser. The Evidence view has every room, door and corridor as lists.";
export const CONTEXT_LOST_TEXT = "The map lost its graphics context. Retrying\u2026";

interface Props {
  store: InvestigationStore;
  createScene: typeof CreateScene;
  /** Overrides the development hook and the `?renderer=off` query (tests). */
  forceFailure?: boolean;
  /**
   * The comparison style (snapshot-comparison, gate G2). When given, every `setStyleState` call carries
   * `comparison: get()`, and `get()` is read again on every notification.
   */
  comparison?: { get(): unknown; subscribe(listener: () => void): () => void };
}

/** A pointer drag shorter than this is a click. */
const DRAG_SLOP = 5;

/** A development build can fix the seed of the random of the haunts (drawing only) with `?hauntSeed=11`; a release build never reads it. */
function developmentHauntSeed(): number | undefined {
  if (!DEVHOOK_ENABLED) return undefined;
  const raw = new URLSearchParams(window.location.search).get("hauntSeed");
  if (raw === null || !/^\d{1,9}$/.test(raw)) return undefined;
  return Number(raw);
}

/** A development build can turn the haunts off for one page with `?hauntSeed=off` (a test of the plain pause at a door); a release build never reads it. */
function developmentHauntsOff(): boolean {
  return DEVHOOK_ENABLED && new URLSearchParams(window.location.search).get("hauntSeed") === "off";
}

function developmentRendererOff(): boolean {
  if (!DEVHOOK_ENABLED) return false;
  return devState.forceFailure || new URLSearchParams(window.location.search).get("renderer") === "off";
}

/** What a click on the scene selects. A click on empty floor changes nothing. */
function selectHit(store: InvestigationStore, hit: HitTarget): void {
  switch (hit.kind) {
    case "room":
      store.actions.select({ kind: "module", id: hit.id }, { from: "scene" });
      break;
    case "door":
    case "sealed":
      store.actions.select({ kind: "relation", relationId: hit.id }, { from: "scene" });
      break;
    case "wing":
      store.actions.select({ kind: "wing", wing: hit.id }, { from: "scene" });
      if (!store.getState().expandedWings.includes(hit.id)) store.actions.expandWing(hit.id);
      break;
    case "grouped":
      store.actions.setView("evidence", hit.id);
      break;
  }
}

/** Screen pixels kept free around what the first view and a selected step frame. */
const FRAME_PADDING = 16;
/** A step is framed at most at this zoom. */
const STEP_MAX_ZOOM = 1;

/**
 * The zoom stack and the minimap lie over the map: their rectangles, relative to the map's top left corner, so that framed
 * content stays clear of them. A control that is hidden or does not overlap the map (the zoom buttons sit behind `More` on a
 * phone) gives nothing.
 */
function overlayRects(wrapper: HTMLElement | null): Rect[] {
  if (wrapper === null) return [];
  const map = wrapper.getBoundingClientRect();
  const out: Rect[] = [];
  for (const selector of [".toolbar-zoom", ".minimap"]) {
    const el = document.querySelector(selector);
    if (el === null) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.right <= map.left || r.left >= map.right || r.bottom <= map.top || r.top >= map.bottom) continue;
    out.push({ x: r.left - map.left, y: r.top - map.top, w: r.width, h: r.height });
  }
  return out;
}

/** A room name on its plate, in screen pixels: mono 500 at 12.5 px is about 7.5 px a letter, plus the plate's padding and its gap under the room. */
const plateSize = (label: string): { w: number; h: number } => ({ w: label.length * 7.6 + 10, h: 12.5 * 1.25 + 14 });

/** The first layout of an investigation frames its dependency loop (every wing when there is none) clear of the controls over the map. */
function firstFit(state: ViewState, viewport: { width: number; height: number }, wrapper: HTMLElement | null) {
  const layout = state.layout;
  if (layout === null) return null;
  const loops = ambientLoops(state.investigation, state.preset);
  const plan = firstViewPlan(layout, loops, viewport.width);
  const obstacles = overlayRects(wrapper);
  if (!plan.compact) return frameRects(plan.rects, viewport, { padding: FRAME_PADDING, obstacles });
  // A phone: the loop's rooms carry their names on plates under them, whose size is fixed in screen pixels, so the frame is found
  // in a few rounds (the plates grow in scene units as the zoom falls). The zoom may go under 0.25 here (FIRST_VIEW_MIN_ZOOM).
  const members = new Set(loops.flatMap((l) => [...l.modules]));
  const rooms = layout.rooms.filter((r) => members.has(r.id));
  let camera = frameRects(plan.rects, viewport, { padding: 8, obstacles, maxZoom: 1, minZoom: FIRST_VIEW_MIN_ZOOM });
  for (let round = 0; round < 4; round++) {
    const z = camera.zoom;
    const plates = rooms.map((r) => {
      const size = plateSize(r.label);
      const w = Math.max(r.w, size.w / z);
      return { x: r.x + r.w / 2 - w / 2, y: r.y, w, h: r.h + size.h / z };
    });
    camera = frameRects([...plan.rects, ...plates], viewport, { padding: 8, obstacles, maxZoom: 1, minZoom: FIRST_VIEW_MIN_ZOOM });
  }
  return camera;
}
export function MapView({ store, createScene, forceFailure, comparison }: Props) {
  const state = useViewState(store);
  const [comparisonValue, setComparisonValue] = useState<unknown>(() => comparison?.get());
  useEffect(() => {
    if (comparison === undefined) return;
    setComparisonValue(comparison.get());
    return comparison.subscribe(() => setComparisonValue(comparison.get()));
  }, [comparison]);
  const reduced = useReducedMotion(state.motion);
  const helpId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const [scene, setScene] = useState<SceneHandle | null>(null);
  const [attempt, setAttempt] = useState(0);
  const fittedFor = useRef<unknown>(null);
  const usableFor = useRef<unknown>(null);
  const centeredFor = useRef<unknown>(null);
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  // Start the scene; on failure show the banner and the Evidence view. A retry runs this again.
  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    let cancelled = false;
    let created: SceneHandle | null = null;
    const off: (() => void)[] = [];
    void createScene({
      container: host,
      reducedMotion: reducedRef.current,
      debug: DEVHOOK_ENABLED,
      ...(developmentHauntSeed() === undefined ? {} : { hauntSeed: developmentHauntSeed() as number }),
      ...(developmentHauntsOff() ? { hauntsOff: true } : {}),
      forceFailure: forceFailure ?? developmentRendererOff(),
    }).then((init) => {
      if (!init.ok) {
        if (cancelled) return;
        store.actions.rendererStatus({ status: "unavailable", reason: init.reason, message: init.message });
        store.actions.setView("evidence");
        retryRef.current?.focus();
        return;
      }
      if (cancelled) {
        init.scene.destroy();
        return;
      }
      created = init.scene;
      off.push(
        created.on("select", (hit) => {
          if (hit !== null) selectHit(store, hit);
          wrapperRef.current?.focus();
        }),
        created.on("contextlost", () => store.actions.rendererStatus({ status: "context-lost", reason: "context-lost" })),
        created.on("contextrestored", () => store.actions.rendererStatus({ status: "ready" })),
        created.on("contextfailed", () => {
          store.actions.rendererStatus({ status: "unavailable", reason: "context-lost" });
          store.actions.setView("evidence");
        }),
      );
      if (DEVHOOK_ENABLED) devState.scene = created;
      store.actions.rendererStatus({ status: "ready" });
      setScene(created);
    });
    return () => {
      cancelled = true;
      for (const stop of off) stop();
      if (created !== null) {
        if (devState.scene === created) devState.scene = null;
        created.destroy();
      }
      setScene(null);
    };
  }, [store, createScene, forceFailure, attempt]);

  // Keep the Retry map button focused whenever the banner appears.
  useEffect(() => {
    if (state.renderer.status === "unavailable") retryRef.current?.focus();
  }, [state.renderer.status, attempt]);

  // Measure the map area; the toolbar's zoom and fit buttons read the size.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (wrapper === null) return;
    const measure = (): void => {
      setViewportSize({ width: wrapper.clientWidth, height: wrapper.clientHeight });
      scene?.resize();
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [scene]);

  useEffect(() => {
    if (scene !== null && state.layout !== null) scene.setLayout(state.layout, "animate");
  }, [scene, state.layout]);

  // Every loop of the investigation is drawn from the start, apart from a comparison, which has its own marks.
  const comparing = comparisonValue !== undefined && comparisonValue !== null;
  const loops = useMemo(() => (comparing ? [] : ambientLoops(state.investigation, state.preset)), [comparing, state.investigation, state.preset]);

  useEffect(() => {
    scene?.setStyleState(
      comparison === undefined
        ? { selection: state.selection, routeFilter: state.routeFilter, loops }
        : { selection: state.selection, routeFilter: state.routeFilter, loops, comparison: comparisonValue ?? null },
    );
  }, [scene, state.selection, state.routeFilter, state.layout, comparison, comparisonValue, loops]);

  useEffect(() => {
    scene?.setReducedMotion(reduced);
  }, [scene, reduced]);

  useEffect(() => {
    if (scene === null) return;
    const now = scene.getCamera();
    const next = state.camera;
    if (now.x !== next.x || now.y !== next.y || now.zoom !== next.zoom) scene.setCamera(next, takeCameraEase() ? "animate" : "jump");
  }, [scene, state.camera]);

  // A scene that starts (or restarts after `Retry map`) draws the camera the store holds. A selection made before it
  // existed was not made for it, so it must not move the camera (12.2).
  useEffect(() => {
    if (scene !== null) centeredFor.current = store.getState().selection;
  }, [store, scene]);

  // A selection made in the DOM centers the camera on its room, door or wing, at zoom 1 or more
  // (4.2, 6.7). It waits for a layout that is still being computed; a scene click never moves it.
  useEffect(() => {
    if (scene === null || state.layout === null || state.layoutStatus === "pending") return;
    const selection = state.selection;
    if (selection.kind === "none" || state.selectionOrigin !== "dom" || centeredFor.current === selection) return;
    centeredFor.current = selection;
    // The camera centers on the target. A chosen import whose rooms are drawn is framed whole: the zoom is the largest (at most 1)
    // at which both rooms, the door and the corridor lie in the part of the map the zoom stack and the minimap leave free.
    const target = focusTargetOf(selection, state.layout, state.investigation);
    const step = stepRectsOf(selection, state.layout);
    if (target !== null && target.kind === "door" && step !== null) {
      const door = state.layout.doors.find((d) => d.relationId === target.id);
      if (door !== undefined) {
        const framed = frameAround({ x: door.x + door.w / 2, y: door.y + door.h / 2 }, step, getViewportSize(), { padding: FRAME_PADDING, maxZoom: STEP_MAX_ZOOM, obstacles: overlayRects(wrapperRef.current) });
        store.actions.setCamera(scene.focusOn(target, 1, framed.zoom));
        return;
      }
    }    if (target !== null) store.actions.setCamera(scene.focusOn(target, 1));
  }, [store, scene, state.layout, state.layoutStatus, state.selection, state.selectionOrigin, state.investigation]);
  // The first layout of an investigation fits the camera; later layouts keep the camera center (3.6). An
  // investigation opened with `openInvestigation` starts with no layout; one swapped in with `replaceInvestigation`
  // (the comparison toggle, gate G2) keeps its layout and therefore keeps the camera (snapshot-comparison 6.1, 6.2).
  useEffect(() => {
    if (state.layout === null) {
      fittedFor.current = null;
      return;
    }
    if (state.investigation === null || fittedFor.current !== null) return;
    fittedFor.current = state.investigation;
    const wrapper = wrapperRef.current;
    if (wrapper !== null) setViewportSize({ width: wrapper.clientWidth, height: wrapper.clientHeight });
    const camera = firstFit(state, getViewportSize(), wrapper);
    if (camera !== null) store.actions.setFirstViewCamera(camera);
  }, [store, state, state.layout, state.investigation]);

  // On a phone a comparison that starts frames its removed and added doors with their rooms (design 4f, design pass 2 item 10).
  // On a larger map the camera stays where it is (snapshot-comparison 6.1): the whole manor is already in view there.
  const framedComparison = useRef<string>("");
  useEffect(() => {
    const style = comparisonValue as { removedRelationIds?: string[]; addedRelationIds?: string[] } | null | undefined;
    if (style === null || style === undefined) {
      framedComparison.current = "";
      return;
    }
    if (scene === null || state.layout === null || state.layoutStatus === "pending") return;
    const viewport = getViewportSize();
    if (viewport.width >= COMPACT_WIDTH) return;
    const ids = [...(style.removedRelationIds ?? []), ...(style.addedRelationIds ?? [])];
    const key = JSON.stringify(ids);
    if (ids.length === 0 || framedComparison.current === key) return;
    const layout = state.layout;
    const rects: Rect[] = [];
    for (const id of ids) {
      const door = layout.doors.find((d) => d.relationId === id);
      if (door === undefined) continue;
      rects.push({ x: door.x, y: door.y, w: door.w, h: door.h });
      for (const end of [door.from, door.to]) {
        const room = layout.rooms.find((r) => r.id === end);
        if (room !== undefined) rects.push({ x: room.x, y: room.y, w: room.w, h: room.h });
      }
    }
    if (rects.length === 0) return;
    framedComparison.current = key;
    const camera = frameRects(rects, viewport, { padding: 12, maxZoom: 1, obstacles: overlayRects(wrapperRef.current) });
    store.actions.setCamera(camera);
  }, [store, scene, comparisonValue, state.layout, state.layoutStatus]);
  // `hauntmap:usable`: the first room is drawn. No time is asserted anywhere.
  useEffect(() => {
    if (scene === null || state.layout === null || state.layout.rooms.length === 0) return;
    if (usableFor.current === state.investigation) return;
    usableFor.current = state.investigation;
    if (typeof performance.mark === "function") performance.mark("hauntmap:usable");
  }, [scene, state.layout, state.investigation]);

  // The wheel needs a non-passive listener to stop the page from scrolling.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (wrapper === null) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const box = wrapper.getBoundingClientRect();
      const factor = Math.pow(1.0015, -event.deltaY);
      easeNextCamera();
    store.actions.setCamera(zoomAround(store.getState().camera, getViewportSize(), factor, { x: event.clientX - box.left, y: event.clientY - box.top }));
    };
    wrapper.addEventListener("wheel", onWheel, { passive: false });
    return () => wrapper.removeEventListener("wheel", onWheel);
  }, [store]);

  // Drag to pan. A press that moves less than the slop stays a click for the scene.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (wrapper === null) return;
    let last: { x: number; y: number; id: number } | null = null;
    let travelled = 0;
    const down = (event: PointerEvent): void => {
      if (event.button !== 0) return;
      last = { x: event.clientX, y: event.clientY, id: event.pointerId };
      travelled = 0;
    };
    const move = (event: PointerEvent): void => {
      if (last === null || event.pointerId !== last.id) return;
      const dx = event.clientX - last.x;
      const dy = event.clientY - last.y;
      travelled += Math.abs(dx) + Math.abs(dy);
      if (travelled <= DRAG_SLOP) return;
      last = { x: event.clientX, y: event.clientY, id: event.pointerId };
      pan(store, -dx, -dy);
    };
    const up = (): void => {
      last = null;
    };
    wrapper.addEventListener("pointerdown", down);
    wrapper.addEventListener("pointermove", move);
    wrapper.addEventListener("pointerup", up);
    wrapper.addEventListener("pointercancel", up);
    return () => {
      wrapper.removeEventListener("pointerdown", down);
      wrapper.removeEventListener("pointermove", move);
      wrapper.removeEventListener("pointerup", up);
      wrapper.removeEventListener("pointercancel", up);
    };
  }, [store]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>): void => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const step = event.shiftKey ? PAN_STEP_SHIFT : PAN_STEP;
      const current = store.getState();
      switch (event.key) {
        case "ArrowLeft":
          pan(store, -step, 0);
          break;
        case "ArrowRight":
          pan(store, step, 0);
          break;
        case "ArrowUp":
          pan(store, 0, -step);
          break;
        case "ArrowDown":
          pan(store, 0, step);
          break;
        case "+":
        case "=":
          zoomBy(store, ZOOM_STEP);
          break;
        case "-":
          zoomBy(store, 1 / ZOOM_STEP);
          break;
        case "0":
          fitView(store);
          break;
        case "f":
        case "F":
          if (current.selection.kind === "module") store.actions.focusModule(current.selection.id);
          break;
        case "i":
        case "I":
          document.querySelector<HTMLElement>('[aria-label="Inspector"] h1, [aria-label="Inspector"] h2')?.focus();
          break;
        case "Escape":
          store.actions.clearSelection();
          break;
        default:
          return;
      }
      event.preventDefault();
    },
    [store],
  );

  const showBanner = state.renderer.status === "unavailable";
  const contextLost = state.renderer.status === "context-lost";

  return (
    <>
      {showBanner ? (
        <div className="renderer-banner">
          <p>{BANNER_TEXT}</p>
          <button type="button" ref={retryRef} onClick={() => setAttempt((n) => n + 1)}>
            Retry map
          </button>
          <button type="button" onClick={() => store.actions.setView("evidence")}>
            Open Evidence view
          </button>
        </div>
      ) : null}
      {contextLost ? <p className="renderer-banner">{CONTEXT_LOST_TEXT}</p> : null}
      {state.layoutStatus === "failed" ? (
        <div className="renderer-banner">
          <button type="button" onClick={() => store.actions.retryLayout()}>
            Retry layout
          </button>
        </div>
      ) : null}
      <div className="map-view" hidden={state.activeView !== "map"}>
        <div
          ref={wrapperRef}
          className="map-wrapper"
          tabIndex={0}
          role="application"
          aria-label="Haunted map"
          aria-describedby={helpId}
          onKeyDown={onKeyDown}
        >
          <div ref={hostRef} className="map-host" />
        </div>
        <span id={helpId} className="visually-hidden">
          {MAP_HELP}
        </span>
        <Minimap store={store} />
      </div>
      <Tooltip store={store} scene={scene} wrapper={wrapperRef} />
    </>
  );
}