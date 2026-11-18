import { Application, Container, Graphics, type Texture } from "pixi.js";
import { createAnimator } from "./animation";
import { candleAlpha, playCameraEase, playCompareEntry, playDoorOpen, playIntro, playRemoved, playSelection, restingRoomAlpha } from "./effects";
import { createDecor } from "./decor";
import { createMotes, EFFECT_NAMES, MAX_MOTES, newFx, type CostSink, type EffectName, type Motes, type SceneFx } from "./fx";
import type { Box } from "./labels";
import { MAX_PARTICLES } from "./corridors";
import { applyComparison, closingKey, shouldClose, type ComparisonDebug, type ComparisonStyle } from "./compare";
import { collapsedWingMarks, type CollapsedMark } from "./compare/collapsed";
import { drawCollapsedMarks, drawComparisonMarks } from "./compare/states";
import { closeCorridor } from "./compare/transition";
import { drawCorridors, drawRoute, type RouteHandle } from "./corridors";
import { drawDoors } from "./doors";
import { presentDoors } from "./doorPlace";
import { createElementTextures, DISPLAY_FONT, FONT } from "./elements";
import { buildHitTargets, hitTest } from "./hitTest";
import { relatedRelations } from "./emphasis";
import { clearMeasureCache, drawRooms, drawWings, haloRect, settleLabels, type DrawContext, type SceneLabel } from "./rooms";
import { currentTheme, onThemeChange } from "../styles/theme";
import { deriveStates } from "./stateMap";
import { TOKENS } from "./styles";
import { clampZoom, FIRST_VIEW_MIN_ZOOM, fitBounds, MAX_ZOOM, toScene, toScreen, type Viewport } from "./camera";
import { visibleRoomIds } from "./culling";
import { watchContext } from "./fallback";
import { createLayers } from "./layers";
import type { Camera, LayoutResult } from "./layout/types";
import { rectOfTarget } from "./targets";
import { createTextureCache } from "./textures";
import { createTickerGate } from "./tickerGate";
import type { HitKind, HitTarget, SceneDebug, SceneHandle, SceneInit, SceneOptions, StyleState } from "./types";

export type { HitTarget, SceneDebug, SceneHandle, SceneInit, SceneOptions, StyleState } from "./types";

/** A wing move is shown as a 300 ms cross-fade of the redrawn layers (no room position tween). */
const LAYOUT_FADE_MS = 300;
/** A pointer that moves farther than this between press and release is a drag, not a click. */
const CLICK_SLOP_PX = 5;

type Listener = (arg?: never) => void;

/** An object whose `alpha` is the one of `node` while it lives, and nothing once a redraw has destroyed it (an effect may outlive the node it plays on). */
function live(node: { alpha: number; destroyed: boolean }): { alpha: number } {
  return {
    get alpha() {
      return node.alpha;
    },
    set alpha(value: number) {
      if (!node.destroyed) node.alpha = value;
    },
  };
}

const emptyFx = (): SceneDebug["fx"] => ({ clock: 0, camera: { x: 0, y: 0, zoom: 1 }, motes: [], lamps: [], roomAlphas: {}, layerAlpha: 1, addedScales: [], farewell: null, removed: [], door: null, doors: [], loop: null, decor: [], doorPx: [], doorways: 0, doorBoxes: [], doorDraws: 0, haunts: [], hauntSeed: null, cost: { fog: 0, bats: 0, spiders: 0, motes: 0, doors: 0, loopLights: 0, candles: 0, ghost: 0 } });

/** Wait for the committed Almendra SC and Spline Sans Mono files, for at most two seconds; the plaques and names then measure and draw with the real faces. */
async function ensureDisplayFont(): Promise<void> {
  if (typeof document === "undefined" || document.fonts === undefined) return;
  try {
    await Promise.race([
      Promise.all([document.fonts.load(`400 17px ${DISPLAY_FONT}`), document.fonts.load(`500 13px ${FONT}`)]),
      new Promise<void>((resolve) => setTimeout(resolve, 2000)),
    ]);
  } catch {
    // The fallback serif is used; nothing else depends on the face.
  }
  clearMeasureCache();
}

/**
 * Create the PixiJS scene inside `opts.container`. It prefers WebGL; a failure (no WebGL, an
 * initialization error or `forceFailure`) is a value, never a throw, so the caller can show the
 * Evidence view and the `Retry map` banner.
 */
export async function createScene(opts: SceneOptions): Promise<SceneInit> {
  if (opts.forceFailure === true) {
    return { ok: false, reason: "forced", message: "The renderer was switched off for this session." };
  }

  // The display face of the wing plates is a committed font file; draw nothing before it is ready (or has failed to load).
  await ensureDisplayFont();
  const app = new Application();
  const container = opts.container;
  try {
    await app.init({
      preference: "webgl",
      width: Math.max(1, container.clientWidth),
      height: Math.max(1, container.clientHeight),
      // Transparent: the map area paints the radial gradient of the design behind the canvas (app.css).
      backgroundAlpha: 0,
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
  // The random of the haunts is drawing only: a fixed seed in a development build (`?hauntSeed=`), a new one for each map otherwise.
  const hauntSeed = opts.hauntSeed ?? (Math.floor(Math.random() * 4294967296) >>> 0);
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
  let labels: SceneLabel[] = [];
  let displayed: Camera = { x: 0, y: 0, zoom: 1 };
  let target: Camera = displayed;
  let cameraToken = 0;
  // Comparison (snapshot-comparison, gate G3): the last style received, the last closing set applied, and the
  // layout actually drawn (hidden rooms and doors removed).
  let comparison: ComparisonStyle | null = null;
  let lastClosing = "";
  let comparisonStates: ComparisonDebug["states"] = {};
  let drawnLayout: LayoutResult | null = null;
  let wingMarks: CollapsedMark[] = [];
  // The effects of the motion pass: what is drawn for them now, and what the last draw showed (so that an effect plays once, when
  // the thing it shows changes, and not at every redraw).
  let fx: SceneFx = newFx();
  let motes: Motes | null = null;
  let fxClock = 0;
  /** The time the scene has animated, in milliseconds: the sum of the frame times it used (a slow frame counts at most 100 ms). Development builds report it, so that a test measures a duration in the scene's own time. */
  let sceneClock = 0;
  let lastSelectedRoom: string | null = null;
  let lastOpenedDoor: string | null = null;
  let lastMarkKey = "";
  let introNext = false;
  let farewell: { corridor: number; ghost: number } | null = null;
  /** True while the ticker callback runs. */
  let inTick = false;

  // Dev build only: the time each effect took in this frame, and its running mean (an exponential mean over about 60 frames).
  const frameCost = Object.fromEntries(EFFECT_NAMES.map((n) => [n, 0])) as Record<EffectName, number>;
  const meanCost = Object.fromEntries(EFFECT_NAMES.map((n) => [n, 0])) as Record<EffectName, number>;
  const costSink: CostSink = (name, ms) => void (frameCost[name] += ms);
  const foldCost = (): void => {
    for (const name of EFFECT_NAMES) meanCost[name] += (frameCost[name] - meanCost[name]) / 60;
  };

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
    labels = [];
    drawnLayout = null;
    fx = newFx();
    motes = null;
    if (layout === null) return;
    const view = applyComparison(layout, deriveStates(layout, styleState ?? { selection: { kind: "none" }, routeFilter: null }), comparison);
    // A door on the wall of its room is drawn just outside it, so that the bigger door never covers a name; the ghost, the hit targets and the labels follow it.
    const drawn = presentDoors(view.drawn);
    const states = view.states;
    drawnLayout = drawn;
    comparisonStates = view.debug;
    // Hidden comparison elements are neither drawn nor hit-tested.
    targets = buildHitTargets(drawn);
    const related = relatedRelations(drawn, {
      selection: styleState?.selection ?? { kind: "none" },
      routeFilter: styleState?.routeFilter ?? null,
      marks: view.marks,
    });
    const ctx: DrawContext = { layers, textures, states, reduced, labels, zoom: displayed.zoom, related, compact: container.clientWidth < 520, fx, selectedRoom: states.haloRoom, ...(opts.hauntsOff === true ? {} : { hauntSeed }) };
    // The halloween details: cobwebs, candles and cracks come with the wings and rooms; the fog, the bats and the spiders after the wings.
    // What moves in them counts inside the 40 particles, before the dust of the loops and the motes.
    const decor = createDecor({ reduced, zoom: displayed.zoom, bounds: drawn.bounds, clockMs: fxClock, fog: textures.get("fog", "default") });
    fx.decor = decor;
    drawWings(ctx, drawn);
    decor.sky(layers, drawn.wings);
    ctx.particlesTaken = decor.movers;
    drawCorridors(ctx, drawn);
    roomNodes = drawRooms(ctx, drawn);
    decor.finish(layers);
    drawDoors(ctx, drawn);
    drawComparisonMarks(layers.selected, view, ctx);
    wingMarks = collapsedWingMarks(drawn, comparison);
    drawCollapsedMarks(layers.selected, wingMarks, ctx);
    route = drawRoute(ctx, drawn);
    particles = decor.movers + (route?.particleCount ?? 0);
    // A few faint dust motes drift in the light of the map; they count inside the particle limit, and there are none under reduced motion.
    const moteCount = reduced ? 0 : Math.max(0, Math.min(MAX_MOTES, MAX_PARTICLES - particles));
    if (moteCount > 0) {
      motes = createMotes(layers.particles, drawn.bounds, moteCount, displayed.zoom);
      particles += moteCount;
    }
    relayoutLabels();
    if (states.haloRoom !== null) {
      const rect = haloRect(drawn, states.haloRoom);
      if (rect !== null) {
        const halo = new Graphics();
        halo.roundRect(rect.x - 7, rect.y - 7, rect.w + 14, rect.h + 14, 8).stroke({ width: 2, color: TOKENS.focus, alpha: 0.7 });
        layers.overlay.addChild(halo);
      }
    }
    applyCulling();
    settleDecor();
    playEffects(view, drawn, states.haloRoom);
    if (fade) {
      world.alpha = 0;
      animator.tween({ duration: LAYOUT_FADE_MS, update: (p) => void (world.alpha = p), onDone: () => void (world.alpha = 1) });
    }
  }

  /** Start the effects that the change since the last draw calls for. Drawing only: nothing here reads or writes the graph, the selection or the steps. */
  function playEffects(view: ReturnType<typeof applyComparison>, drawn: LayoutResult, selectedRoom: string | null): void {
    if (introNext) {
      introNext = false;
      if (drawn.rooms.length > 0) playIntro(animator, layers.rooms);
    }
    // Selecting a room: its window lights and the other rooms dim to 60 percent.
    if (selectedRoom !== lastSelectedRoom) {
      const others: { node: { alpha: number }; from: number; to: number }[] = [];
      for (const [id, node] of roomNodes) {
        const subdued = view.states.rooms.get(id) === "subdued";
        const from = restingRoomAlpha({ roomSelected: lastSelectedRoom !== null, isSelected: id === lastSelectedRoom, subdued });
        const to = restingRoomAlpha({ roomSelected: selectedRoom !== null, isSelected: id === selectedRoom, subdued });
        if (from !== to) others.push({ node: live(node), from, to });
      }
      const glow = selectedRoom === null ? null : (fx.glows.get(selectedRoom) ?? null);
      playSelection(animator, { lit: glow === null ? null : live(glow), others });
      lastSelectedRoom = selectedRoom;
    }
    // Selecting a door: it swings open, and its corridor draws to its target.
    const open = fx.openDoor;
    const opened = open?.relationId ?? null;
    if (opened !== lastOpenedDoor) {
      lastOpenedDoor = opened;
      if (open !== null) {
        open.setDraw(0);
        playDoorOpen(animator, { swing: (f) => open.setSwing(f), draw: (p) => open.setDraw(p) });
      }
    }
    // Comparing: removed corridors fade to their ghost outline, added doorways grow with one pulse, the lamps flicker on.
    const markKey = comparison === null ? "" : JSON.stringify([comparison.shown, comparison.changedModules, comparison.removedRelationIds, comparison.addedRelationIds]);
    if (markKey !== lastMarkKey) {
      lastMarkKey = markKey;
      if (markKey !== "") {
        if (fx.removedOutlines.length > 0) {
          const solid = new Container();
          solid.label = "removed-solid";
          const line = new Graphics();
          for (const [id, mark] of view.marks.doors) {
            if (mark !== "comparison-removed") continue;
            const door = drawn.doors.find((d) => d.relationId === id);
            if (door === undefined || door.arrow.length < 2) continue;
            line.moveTo((door.arrow[0] as { x: number }).x, (door.arrow[0] as { y: number }).y);
            for (const p of door.arrow.slice(1)) line.lineTo(p.x, p.y);
          }
          line.stroke({ width: 2, color: TOKENS.passage, alpha: 0.85, join: "round", cap: "round" });
          solid.addChild(line);
          layers.selected.addChild(solid);
          fx.removedSolid = solid;
          playRemoved(animator, { outline: fx.removedOutlines.map(live), solid: live(solid) });
          animator.tween({ duration: 650, update: () => undefined, onDone: () => void (!solid.destroyed && solid.destroy({ children: true })) });
        }
        playCompareEntry(animator, {
          added: fx.added.map((a) => {
            const sprite = a.relationId === null ? undefined : fx.doorSprites.get(a.relationId);
            const base = sprite === undefined ? null : { x: sprite.x, y: sprite.y, w: sprite.width, h: sprite.height };
            return {
              grow: (s: number) => {
                a.scale = s;
                if (!a.container.destroyed) a.container.scale.set(s);
                if (sprite !== undefined && base !== null && !sprite.destroyed) {
                  sprite.width = base.w * s;
                  sprite.height = base.h * s;
                  sprite.position.set(base.x + (base.w * (1 - s)) / 2, base.y + (base.h * (1 - s)) / 2);
                }
              },
              pulse: (p: number) => {
                if (a.pulse.destroyed) return;
                a.pulse.visible = p < 1;
                a.pulse.alpha = 0.7 * (1 - p);
                a.pulse.scale.set(1 + p);
              },
            };
          }),
          lamps: fx.lamps.map((lamp) => (on: number) => {
            lamp.entrance = on;
            if (!lamp.node.destroyed) lamp.node.alpha = on;
          }),
        });
      }
    }
  }

  /** Every drawn door as the debug data reports it: its box on the screen, its width, and how far its panel is open. */
  function doorBoxes(): SceneDebug["fx"]["doorBoxes"] {
    const vp = viewport();
    const origin = container.getBoundingClientRect();
    const byId = new Map((drawnLayout ?? layout)?.doors.map((d) => [d.relationId, d] as const) ?? []);
    const out: SceneDebug["fx"]["doorBoxes"] = [];
    for (const [id, sprite] of fx.doorSprites) {
      const door = byId.get(id);
      if (sprite.destroyed || door === undefined) continue;
      const a = toScreen(displayed, vp, { x: sprite.x, y: sprite.y });
      const b = toScreen(displayed, vp, { x: sprite.x + sprite.width, y: sprite.y + sprite.height });
      const leaf = fx.leaves.get(id);
      out.push({
        relationId: id,
        x: door.x + door.w / 2,
        y: door.y + door.h / 2,
        w: door.w,
        rect: { x: origin.left + a.x, y: origin.top + a.y, width: b.x - a.x, height: b.y - a.y },
        widthPx: sprite.width * displayed.zoom,
        open: leaf?.open ?? 0,
        openingPx: (leaf?.openingUnits ?? 0) * displayed.zoom,
      });
    }
    return out;
  }

  /** Where every drawn name, title, plate and number lies now, in scene units, a little grown: the places the details must keep clear. */
  function labelBoxes(padPx = 2): Box[] {
    const pad = padPx / Math.max(displayed.zoom, 0.0001);
    const out: Box[] = [];
    const add = (b: Box | null | undefined): void => {
      if (b !== null && b !== undefined) out.push({ x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad });
    };
    for (const label of labels) {
      if (!label.visible()) continue;
      if (label.box !== undefined) add(label.box());
      else {
        const g = label.node.getBounds();
        add({ x: (g.x - world.position.x) / displayed.zoom, y: (g.y - world.position.y) / displayed.zoom, w: g.width / displayed.zoom, h: g.height / displayed.zoom });
      }
      add(label.plate?.());
    }
    return out;
  }

  /** True when the names moved since the details last checked them; the ticker checks again at most every 60 ms of scene time. */
  let decorDirty = false;
  let decorSettledAt = 0;
  function settleDecor(): void {
    decorDirty = false;
    decorSettledAt = sceneClock;
    const boxes = labelBoxes();
    fx.decor?.settle(boxes);
    // The haunt keeps clear of the names by half a pixel only: its door stands close to the wall of a room, and the shake is a few pixels.
    route?.setLabels(labelBoxes(0.5));
  }

  /** Every haunt as the debug data reports it: the boxes of the critters and the puffs in client pixels. */
  function hauntReadings(): SceneDebug["fx"]["haunts"] {
    const vp = viewport();
    const origin = container.getBoundingClientRect();
    const rectOf = (b: Box): { x: number; y: number; width: number; height: number } => {
      const a = toScreen(displayed, vp, { x: b.x, y: b.y });
      const e = toScreen(displayed, vp, { x: b.x + b.w, y: b.y + b.h });
      return { x: origin.left + a.x, y: origin.top + a.y, width: e.x - a.x, height: e.y - a.y };
    };
    return (route?.haunts() ?? []).map((h) => ({
      phase: h.phase,
      door: h.door,
      ghostAlpha: h.ghostAlpha,
      shake: { ...h.shake },
      critters: h.critters.map((c) => ({ id: c.id, kind: c.kind, x: c.x, y: c.y, alpha: c.alpha, visible: c.visible, rect: rectOf(c.box) })),
      puffs: h.puffs.map((p) => ({ x: p.x, y: p.y, r: p.r, alpha: p.alpha, visible: p.visible, rect: rectOf(p.box) })),
    }));
  }

  /** Re-choose the words and the scale of every name and title for the camera zoom (never under 12 CSS pixels). */
  function relayoutLabels(): void {
    for (const label of labels) if ((label.active ?? label.visible)()) label.layout(displayed.zoom);
    settleLabels(labels);
    route?.setZoom(displayed.zoom);
    motes?.setZoom(displayed.zoom);
    fx.decor?.setZoom(displayed.zoom);
    fx.setDoorZoom?.(displayed.zoom);
    // A camera move lays the names out at every frame; the details follow them a few times a second, not at every frame.
    decorDirty = true;
  }

  function applyCamera(camera: Camera): void {
    displayed = camera;
    const vp = viewport();
    world.scale.set(camera.zoom);
    world.position.set(vp.width / 2 - camera.x * camera.zoom, vp.height / 2 - camera.y * camera.zoom);
    applyCulling();
    relayoutLabels();
    // A jump (or a resize) happens outside the ticker: check the details against the names now, so that no frame or reading in between
    // shows a cobweb over a plaque that has just grown. Inside an animation the ticker checks them a few times a second.
    if (!inTick) settleDecor();
  }

  function moveCamera(camera: Camera, transition: "animate" | "jump"): void {
    // The store has clamped the zoom already; the first view on a phone may be under the 0.25 floor (FIRST_VIEW_MIN_ZOOM).
    const next: Camera = { x: camera.x, y: camera.y, zoom: Number.isFinite(camera.zoom) ? Math.min(MAX_ZOOM, Math.max(FIRST_VIEW_MIN_ZOOM, camera.zoom)) : 1 };
    const from = displayed;
    target = next;
    const token = ++cameraToken;
    if (transition === "jump") {
      applyCamera(next);
      emit("camera", next);
      return;
    }
    // Zoom, Fit to view and every other animated move: 300 ms, eased out.
    playCameraEase(
      animator,
      (p) => {
        if (token !== cameraToken) return;
        applyCamera({ x: from.x + (next.x - from.x) * p, y: from.y + (next.y - from.y) * p, zoom: from.zoom + (next.zoom - from.zoom) * p });
      },
      () => {
        if (token === cameraToken) emit("camera", next);
      },
    );
  }

  app.ticker.add(() => {
    inTick = true;
    frames += 1;
    sceneClock += app.ticker.deltaMS;
    animator.tick(app.ticker.deltaMS);
    if (decorDirty && (sceneClock - decorSettledAt >= 60 || animator.activeTweens === 0)) settleDecor();
    const sink = opts.debug ? costSink : undefined;
    if (sink !== undefined) for (const name of EFFECT_NAMES) frameCost[name] = 0;
    route?.update(app.ticker.deltaMS, sink);
    if (!reduced) {
      fxClock += app.ticker.deltaMS;
      const began = sink === undefined ? 0 : performance.now();
      motes?.update(fxClock);
      sink?.("motes", performance.now() - began);
      fx.decor?.update(fxClock, sink);
      // The candle flicker of the lamps, multiplied with their flicker-on.
      for (const lamp of fx.lamps) if (!lamp.node.destroyed) lamp.node.alpha = lamp.entrance * candleAlpha(fxClock, lamp.seed, false);
    }
    if (sink !== undefined) foldCost();
    inTick = false;
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

  // A palette change redraws every texture and layer with the new colors.
  const stopTheme = onThemeChange(() => {
    if (destroyed) return;
    app.renderer.background.color = TOKENS.floor;
    textures.rebuild();
    redraw(false);
  });

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
      // The first load of a manor (or of another one that shares no room with the one shown) fades its rooms in.
      const known = new Set(next.rooms.map((r) => r.id));
      if (layout === null || !layout.rooms.some((r) => known.has(r.id))) introNext = true;
      layout = next;
      targets = buildHitTargets(next);
      redraw(moved);
    },
    setStyleState(state) {
      guard();
      // An absent `comparison` keeps the last style; `null` clears it.
      if (state.comparison !== undefined) {
        const next = (state.comparison ?? null) as ComparisonStyle | null;
        const previousFilter = styleState?.routeFilter ?? null;
        // The loop that closes: the one the reader chose, or a loop shown from the start that holds a closing relation.
        const closing = next?.closingRelationIds ?? [];
        const previous = previousFilter !== null && previousFilter.kind === "witness" ? previousFilter : ((styleState?.loops ?? []).find((l) => l.relationIds.some((id) => closing.includes(id))) ?? null);
        if (shouldClose(next, lastClosing) && previous !== null && layout !== null) {
          const ghost = route?.ghost() ?? null;
          closeCorridor({
            parent: world,
            layout,
            route: previous,
            animator,
            reduced,
            zoom: displayed.zoom,
            ghost: ghost === null ? null : { at: { x: ghost.x, y: ghost.y }, scale: (container.clientWidth < 520 ? 0.72 : 1) / Math.max(displayed.zoom, 0.0001) },
            onFade: (state) => void (farewell = state),
          });
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
    focusOn(on, zoomFloor, zoom) {
      guard();
      const shown = drawnLayout ?? layout;
      const rect = shown === null ? null : rectOfTarget(shown, on);
      if (rect === null) return { ...target };
      const camera: Camera = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2, zoom: clampZoom(zoom ?? Math.max(target.zoom, zoomFloor)) };
      moveCamera(camera, "animate");
      return camera;
    },
    screenRectOf(on: { kind: HitKind; id: string }) {
      guard();
      const shown = drawnLayout ?? layout;
      const rect = shown === null ? null : rectOfTarget(shown, on);
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
        return { textureCount: 0, visibleRooms: 0, tickerRunning: false, activeTweens: 0, drawnDoors: 0, particleCount: 0, frames: 0, labels: [], ghost: null, glow: false, glowAlpha: null, light: null, wingMarks: [], theme: "", fx: emptyFx() };
      }
      const counters: SceneDebug & ComparisonDebug = {
        textureCount: textures.size,
        visibleRooms,
        tickerRunning: app.ticker.started,
        activeTweens: animator.activeTweens,
        drawnDoors: (drawnLayout ?? layout)?.doors.length ?? 0,
        particleCount: particles,
        frames,
        labels: labels
          .filter((label) => label.visible())
          .map((label) => {
            const b = label.node.getBounds();
            const box = container.getBoundingClientRect();
            const plate = label.plate?.() ?? null;
            const vp = viewport();
            const shown = plate === null ? null : { a: toScreen(displayed, vp, { x: plate.x, y: plate.y }), b: toScreen(displayed, vp, { x: plate.x + plate.w, y: plate.y + plate.h }) };
            return {
              kind: label.kind,
              id: label.id,
              text: label.node.text,
              px: label.fontUnits * label.node.scale.y * displayed.zoom,
              rect: { x: box.left + b.x, y: box.top + b.y, width: b.width, height: b.height },
              ...(shown === null ? {} : { plate: { x: box.left + shown.a.x, y: box.top + shown.a.y, width: shown.b.x - shown.a.x, height: shown.b.y - shown.a.y } }),
            };
          }),
        ghost: route?.ghost() ?? null,
        glow: route?.glow ?? false,
        glowAlpha: route?.glowAlpha() ?? null,
        light: route?.light() ?? null,
        wingMarks: wingMarks.map((m) => ({ wing: m.wing, kind: m.kind })),
        theme: currentTheme(),
        fx: {
          clock: sceneClock,
          camera: { ...displayed },
          motes: motes?.positions() ?? [],
          lamps: fx.lamps.map((l) => l.node.alpha),
          roomAlphas: Object.fromEntries([...roomNodes].map(([id, node]) => [id, node.alpha])),
          layerAlpha: layers.rooms.alpha,
          addedScales: fx.added.map((a) => a.scale),
          farewell: farewell === null ? null : { ...farewell },
          removed:
            fx.removedOutlines.length === 0
              ? []
              : [{ outline: (fx.removedOutlines[0] as { alpha: number }).alpha, solid: fx.removedSolid === null || fx.removedSolid.destroyed ? 0 : fx.removedSolid.alpha }],
          door: fx.openDoor === null ? null : { swing: fx.openDoor.swing, draw: fx.openDoor.draw },
          doors: route?.doors() ?? [],
          loop: route?.loop() ?? null,
          doorPx: [...fx.leaves.values()].map((l) => l.widthUnits * displayed.zoom),
          doorways: fx.doorways,
          doorDraws: fx.doorDraws,
          doorBoxes: doorBoxes(),
          haunts: hauntReadings(),
          hauntSeed: opts.hauntsOff === true ? null : hauntSeed,
          cost: { ...meanCost },
          decor: (fx.decor?.readings() ?? []).map((r) => {
            const vp = viewport();
            const a = toScreen(displayed, vp, { x: r.box.x, y: r.box.y });
            const b = toScreen(displayed, vp, { x: r.box.x + r.box.w, y: r.box.y + r.box.h });
            const origin = container.getBoundingClientRect();
            return { kind: r.kind, moving: r.moving, visible: r.visible, rect: { x: origin.left + a.x, y: origin.top + a.y, width: b.x - a.x, height: b.y - a.y } };
          }),
        },
        states: { ...comparisonStates },
      };
      return counters;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stopWatching();
      stopTheme();
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
