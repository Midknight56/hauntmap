import { Application, Container, Graphics, type Texture } from "pixi.js";
import { createAnimator } from "./animation";
import { applyComparison, closingKey, shouldClose, type ComparisonDebug, type ComparisonStyle } from "./compare";
import { drawComparisonMarks } from "./compare/states";
import { closeCorridor } from "./compare/transition";
import { drawCorridors, drawRoute, type RouteHandle } from "./corridors";
import { drawDoors } from "./doors";
import { createElementTextures } from "./elements";
import { buildHitTargets, hitTest } from "./hitTest";
import { drawRooms, drawWings, haloRect, type DrawContext } from "./rooms";
import { deriveStates } from "./stateMap";
import { TOKENS } from "./styles";
import { fitBounds, clampZoom, toScene, toScreen, type Viewport } from "./camera";
import { visibleRoomIds } from "./culling";
import { watchContext } from "./fallback";
import { createLayers } from "./layers";
import type { Camera, LayoutResult } from "./layout/types";
import { rectOfTarget } from "./targets";
import { createTextureCache } from "./textures";
import { createTickerGate } from "./tickerGate";
import type { HitKind, HitTarget, SceneDebug, SceneHandle, SceneInit, SceneOptions, StyleState } from "./types";

export type { HitTarget, SceneDebug, SceneHandle, SceneInit, SceneOptions, StyleState } from "./types";

/** Duration of an animated camera move; the selection transition stays under 300 ms. */
const CAMERA_TWEEN_MS = 240;
/** A wing move is shown as a 300 ms cross-fade of the redrawn layers (no room position tween). */
const LAYOUT_FADE_MS = 300;
/** A pointer that moves farther than this between press and release is a drag, not a click. */
const CLICK_SLOP_PX = 5;

type Listener = (arg?: never) => void;

/**
 * Create the PixiJS scene inside `opts.container`. It prefers WebGL; a failure (no WebGL, an
 * initialization error or `forceFailure`) is a value, never a throw, so the caller can show the
 * Evidence view and the `Retry map` banner.
 */
export async function createScene(opts: SceneOptions): Promise<SceneInit> {
  if (opts.forceFailure === true) {
    return { ok: false, reason: "forced", message: "The renderer was switched off for this session." };
  }

  const app = new Application();
  const container = opts.container;
  try {
    await app.init({
      preference: "webgl",
      width: Math.max(1, container.clientWidth),
      height: Math.max(1, container.clientHeight),
      background: TOKENS.floor,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(2, window.devicePixelRatio || 1),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      app.destroy();
    } catch {
      // Nothing was created.
    }
    return { ok: false, reason: /webgl/i.test(message) ? "no-webgl" : "init-failed", message };
  }

  const canvas = app.canvas;
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  container.appendChild(canvas);

  const world = new Container();
  app.stage.addChild(world);
  const layers = createLayers((name) => {
    const layer = new Container();
    layer.label = name;
    return layer;
  }, world);

  const animator = createAnimator({ reduced: opts.reducedMotion });
  const textures = createTextureCache<Texture>(createElementTextures(app.renderer));
  const listeners = new Map<string, Set<Listener>>();
  const emit = (event: string, arg?: unknown): void => {
    for (const cb of [...(listeners.get(event) ?? [])]) (cb as (a?: unknown) => void)(arg);
  };

  let destroyed = false;
  let layout: LayoutResult | null = null;
  let styleState: StyleState | null = null;
  let visibleRooms = 0;
  let frames = 0;
  let reduced = opts.reducedMotion;
  let targets: HitTarget[] = [];
  let roomNodes = new Map<string, Container>();
  let route: RouteHandle | null = null;
  let particles = 0;
  let displayed: Camera = { x: 0, y: 0, zoom: 1 };
  let target: Camera = displayed;
  let cameraToken = 0;
  // Comparison (snapshot-comparison, gate G3): the last style received, the last closing set applied, and the
  // layout actually drawn (hidden rooms and doors removed).
  let comparison: ComparisonStyle | null = null;
  let lastClosing = "";
  let comparisonStates: ComparisonDebug["states"] = {};
  let drawnLayout: LayoutResult | null = null;

  const gate = createTickerGate({ start: () => app.ticker.start(), stop: () => app.ticker.stop() });

  function viewport(): Viewport {
    return { width: Math.max(1, container.clientWidth), height: Math.max(1, container.clientHeight) };
  }

  function applyCulling(): void {
    if (layout === null) {
      visibleRooms = 0;
      return;
    }
    const visible = new Set(visibleRoomIds((drawnLayout ?? layout).rooms, displayed, viewport()));
    visibleRooms = visible.size;
    for (const [id, node] of roomNodes) node.visible = visible.has(id);
  }

  /** Rebuild every layer from the layout and the style state. Cheap at the 80-room cap. */
  function redraw(fade: boolean): void {
    for (const layer of Object.values(layers)) for (const child of layer.removeChildren()) child.destroy({ children: true });
    roomNodes = new Map();
    route = null;
    particles = 0;
    drawnLayout = null;
    if (layout === null) return;
    const view = applyComparison(layout, deriveStates(layout, styleState ?? { selection: { kind: "none" }, routeFilter: null }), comparison);
    const drawn = view.drawn;
    const states = view.states;
    drawnLayout = drawn;
    comparisonStates = view.debug;
    // Hidden comparison elements are neither drawn nor hit-tested.
    targets = buildHitTargets(drawn);
    const ctx: DrawContext = { layers, textures, states, reduced };
    drawWings(ctx, drawn);
    drawCorridors(ctx, drawn);
    roomNodes = drawRooms(ctx, drawn);
    drawDoors(ctx, drawn);
    drawComparisonMarks(layers.selected, view);
    route = drawRoute(ctx, drawn);
    particles = route?.particleCount ?? 0;
    if (states.haloRoom !== null) {
      const rect = haloRect(drawn, states.haloRoom);
      if (rect !== null) {
        const halo = new Graphics();
        halo.roundRect(rect.x - 6, rect.y - 6, rect.w + 12, rect.h + 12, 12).stroke({ width: 4, color: TOKENS.focus });
        layers.overlay.addChild(halo);
      }
    }
    applyCulling();
    if (fade) {
      world.alpha = 0;
      animator.tween({ duration: LAYOUT_FADE_MS, update: (p) => void (world.alpha = p), onDone: () => void (world.alpha = 1) });
    }
  }

  function applyCamera(camera: Camera): void {
    displayed = camera;
    const vp = viewport();
    world.scale.set(camera.zoom);
    world.position.set(vp.width / 2 - camera.x * camera.zoom, vp.height / 2 - camera.y * camera.zoom);
    applyCulling();
  }

  function moveCamera(camera: Camera, transition: "animate" | "jump"): void {
    const next: Camera = { x: camera.x, y: camera.y, zoom: clampZoom(camera.zoom) };
    const from = displayed;
    target = next;
    const token = ++cameraToken;
    if (transition === "jump") {
      applyCamera(next);
      emit("camera", next);
      return;
    }
    animator.tween({
      duration: CAMERA_TWEEN_MS,
      update: (p) => {
        if (token !== cameraToken) return;
        applyCamera({ x: from.x + (next.x - from.x) * p, y: from.y + (next.y - from.y) * p, zoom: from.zoom + (next.zoom - from.zoom) * p });
      },
      onDone: () => {
        if (token === cameraToken) emit("camera", next);
      },
    });
  }

  app.ticker.add(() => {
    frames += 1;
    animator.tick(app.ticker.deltaMS);
    route?.update(app.ticker.deltaMS);
  });

  const onVisibility = (): void => gate.setDocumentHidden(document.visibilityState === "hidden");
  document.addEventListener("visibilitychange", onVisibility);
  onVisibility();

  let intersection: IntersectionObserver | null = null;
  if (typeof IntersectionObserver !== "undefined") {
    intersection = new IntersectionObserver((entries) => {
      const last = entries[entries.length - 1];
      if (last !== undefined) gate.setIntersecting(last.isIntersecting);
    });
    intersection.observe(container);
  }

  let resizer: ResizeObserver | null = null;
  const resize = (): void => {
    const vp = viewport();
    app.renderer.resize(vp.width, vp.height);
    applyCamera(displayed);
  };
  if (typeof ResizeObserver !== "undefined") {
    resizer = new ResizeObserver(() => {
      if (!destroyed) resize();
    });
    resizer.observe(container);
  }

  let pressed: { x: number; y: number } | null = null;
  const onDown = (event: PointerEvent): void => {
    pressed = { x: event.clientX, y: event.clientY };
  };
  const onUp = (event: PointerEvent): void => {
    const start = pressed;
    pressed = null;
    if (start === null || Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_SLOP_PX) return;
    emit("select", handle.hitTest(event.clientX, event.clientY));
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerup", onUp);

  const stopWatching = watchContext(canvas, {
    onLost() {
      gate.setSuspended(true);
      emit("contextlost");
    },
    onRestored() {
      textures.rebuild();
      redraw(false);
      gate.setSuspended(false);
      applyCamera(displayed);
      emit("contextrestored");
    },
    onFallback() {
      emit("contextfailed");
    },
  });

  function guard(): void {
    if (destroyed) throw new Error("Scene destroyed");
  }

  const base: Omit<SceneHandle, "on"> = {
    setLayout(next, transition) {
      guard();
      const moved = layout !== null && transition === "animate";
      layout = next;
      targets = buildHitTargets(next);
      redraw(moved);
    },
    setStyleState(state) {
      guard();
      // An absent `comparison` keeps the last style; `null` clears it.
      if (state.comparison !== undefined) {
        const next = (state.comparison ?? null) as ComparisonStyle | null;
        const previous = styleState?.routeFilter ?? null;
        if (shouldClose(next, lastClosing) && previous !== null && previous.kind === "witness" && layout !== null) {
          closeCorridor({ parent: world, layout, route: previous, animator, reduced });
        }
        lastClosing = next === null ? "" : closingKey(next.closingRelationIds);
        comparison = next;
      }
      styleState = state;
      redraw(false);
    },
    setCamera(camera, transition) {
      guard();
      moveCamera(camera, transition);
    },
    getCamera() {
      return { ...target };
    },
    fit(padding) {
      guard();
      const camera = layout === null ? { ...target } : fitBounds(layout.bounds, viewport(), padding);
      moveCamera(camera, "animate");
      return camera;
    },
    focusOn(on, zoomFloor) {
      guard();
      const rect = layout === null ? null : rectOfTarget(layout, on);
      if (rect === null) return { ...target };
      const camera: Camera = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2, zoom: clampZoom(Math.max(target.zoom, zoomFloor)) };
      moveCamera(camera, "animate");
      return camera;
    },
    screenRectOf(on: { kind: HitKind; id: string }) {
      guard();
      const rect = layout === null ? null : rectOfTarget(layout, on);
      if (rect === null) return null;
      const vp = viewport();
      const a = toScreen(displayed, vp, { x: rect.x, y: rect.y });
      const b = toScreen(displayed, vp, { x: rect.x + rect.w, y: rect.y + rect.h });
      const box = container.getBoundingClientRect();
      return new DOMRect(box.left + a.x, box.top + a.y, b.x - a.x, b.y - a.y);
    },
    hitTest(clientX, clientY): HitTarget | null {
      guard();
      const box = canvas.getBoundingClientRect();
      return hitTest(targets, toScene(displayed, viewport(), { x: clientX - box.left, y: clientY - box.top }));
    },
    setReducedMotion(value) {
      guard();
      reduced = value;
      animator.setReduced(value);
      redraw(false);
    },
    resize() {
      guard();
      resize();
    },
    debug(): SceneDebug {
      guard();
      if (!opts.debug) {
        return { textureCount: 0, visibleRooms: 0, tickerRunning: false, activeTweens: 0, drawnDoors: 0, particleCount: 0, frames: 0 };
      }
      const counters: SceneDebug & ComparisonDebug = {
        textureCount: textures.size,
        visibleRooms,
        tickerRunning: app.ticker.started,
        activeTweens: animator.activeTweens,
        drawnDoors: (drawnLayout ?? layout)?.doors.length ?? 0,
        particleCount: particles,
        frames,
        states: { ...comparisonStates },
      };
      return counters;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stopWatching();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      document.removeEventListener("visibilitychange", onVisibility);
      intersection?.disconnect();
      resizer?.disconnect();
      app.ticker.stop();
      animator.finishAll();
      textures.destroy();
      listeners.clear();
      app.destroy({ removeView: true }, { children: true });
    },
  };
  const on = (event: string, cb: Listener): (() => void) => {
    guard();
    const set = listeners.get(event) ?? new Set<Listener>();
    set.add(cb);
    listeners.set(event, set);
    return () => {
      set.delete(cb);
    };
  };
  const handle: SceneHandle = { ...base, on: on as SceneHandle["on"] };
  return { ok: true, scene: handle };
}
