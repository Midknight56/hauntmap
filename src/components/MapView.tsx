import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { InvestigationStore, ViewState } from "../features/investigation/store";
import { fitBounds, zoomAround } from "../scene/camera";
import type { createScene as CreateScene } from "../scene/adapter";
import type { HitTarget, SceneHandle } from "../scene/types";
import { Breadcrumb } from "./Breadcrumb";
import { fitView, FIT_PADDING, pan, PAN_STEP, PAN_STEP_SHIFT, zoomBy, ZOOM_STEP } from "./cameraControls";
import { DEVHOOK_ENABLED, devState } from "./devHook";
import { Minimap } from "./Minimap";
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
}

/** A pointer drag shorter than this is a click. */
const DRAG_SLOP = 5;

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

/** Where to fit on the first layout of an investigation: the one expanded wing, or everything. */
function firstFit(state: ViewState, viewport: { width: number; height: number }) {
  const layout = state.layout;
  if (layout === null) return null;
  const expanded = layout.wings.filter((w) => w.expanded);
  const rect = expanded.length === 1 && expanded[0] !== undefined ? { x: expanded[0].x, y: expanded[0].y, w: expanded[0].w, h: expanded[0].h } : layout.bounds;
  return fitBounds(rect, viewport, FIT_PADDING);
}

export function MapView({ store, createScene, forceFailure }: Props) {
  const state = useViewState(store);
  const reduced = useReducedMotion(state.motion);
  const helpId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const [scene, setScene] = useState<SceneHandle | null>(null);
  const [attempt, setAttempt] = useState(0);
  const fittedFor = useRef<unknown>(null);
  const usableFor = useRef<unknown>(null);
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

  useEffect(() => {
    scene?.setStyleState({ selection: state.selection, routeFilter: state.routeFilter });
  }, [scene, state.selection, state.routeFilter, state.layout]);

  useEffect(() => {
    scene?.setReducedMotion(reduced);
  }, [scene, reduced]);

  useEffect(() => {
    if (scene === null) return;
    const now = scene.getCamera();
    const next = state.camera;
    if (now.x !== next.x || now.y !== next.y || now.zoom !== next.zoom) scene.setCamera(next, "jump");
  }, [scene, state.camera]);

  // The first layout of an investigation fits the camera; later layouts keep the camera center (3.6).
  useEffect(() => {
    if (state.layout === null || state.investigation === null || fittedFor.current === state.investigation) return;
    fittedFor.current = state.investigation;
    const wrapper = wrapperRef.current;
    if (wrapper !== null) setViewportSize({ width: wrapper.clientWidth, height: wrapper.clientHeight });
    const camera = firstFit(state, getViewportSize());
    if (camera !== null) store.actions.setCamera(camera);
  }, [store, state, state.layout, state.investigation]);

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
        <Breadcrumb store={store} />
        <Minimap store={store} />
      </div>
    </>
  );
}