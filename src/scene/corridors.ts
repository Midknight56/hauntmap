import { Container, Graphics, Sprite, Text } from "pixi.js";
import { stepMark, STEP_FONT } from "./doors";
import { FONT } from "./elements";
import { pinText, type DrawContext } from "./rooms";
import type { LayoutResult, Point } from "./layout/types";
import { TOKENS } from "./styles";
import { glowAlphaAt } from "./effects";
import type { CostSink } from "./fx";
import { createDoorKeeper, type DoorKeeper, type DoorReading } from "./doorKeeper";
import { doorReachUnits } from "./doorLook";
import { createLoopLights, type RoomLightReading } from "./loopLights";
import { bobOffsetPx, createWalker, GHOST_PAUSE_MS, GHOST_SPEED_PX_S, lightProgress, pointOnPolyline, polylineLength, witnessLegs, type Leg } from "./walk";

export const MAX_PARTICLES = 40;
/** The size of the ghost in the design: 28 by 30 px on a desktop, 0.72 of that on a phone. */
const GHOST_SCALE_PHONE = 0.72;

export function importsLabel(count: number): string {
  return count === 1 ? "1 import" : `${count} imports`;
}

/** Aggregated corridors between wings: plain orthogonal lines of 2 units, each with a pill of its import count. */
export function drawCorridors(ctx: DrawContext, layout: LayoutResult): void {
  const wingOf = new Map(layout.rooms.map((r) => [r.id, r.wing] as const));
  // A passage between two wings stays bright when a bright door joins them.
  const bright = new Set<string>();
  if (ctx.related !== null) {
    for (const door of layout.doors) {
      if (!ctx.related.has(door.relationId)) continue;
      bright.add(JSON.stringify([wingOf.get(door.from), wingOf.get(door.to)]));
    }
  }
  // All the lines are drawn into two shared Graphics (bright and faded) under the badges: one draw call each, not one per corridor.
  const lines = new Graphics();
  const linesFaded = new Graphics();
  ctx.layers.corridors.addChild(lines, linesFaded);
  let anyLine = false;
  let anyFaded = false;
  for (const corridor of layout.corridors) {
    const path = corridor.route ?? corridor.path;
    if (path.length < 2) continue;
    const faded = ctx.related !== null && !bright.has(JSON.stringify([corridor.fromWing, corridor.toWing]));
    const line = faded ? linesFaded : lines;
    if (faded) anyFaded = true;
    else anyLine = true;
    const first = path[0] as Point;
    line.moveTo(first.x, first.y);
    for (const p of path.slice(1)) line.lineTo(p.x, p.y);
    const a = first;
    const b = path[path.length - 1] as Point;
    const mid = corridor.badge ?? pointOnPolyline(path, polylineLength(path) / 2) ?? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const badge = new Sprite(ctx.textures.get("corridor", "default"));
    badge.anchor.set(0.5);
    badge.position.set(mid.x, mid.y);
    if (faded) badge.alpha = 0.5;
    ctx.layers.corridors.addChild(badge);
    // The count is drawn with its pill only where its words are 12 CSS pixels or more; the Evidence view carries it otherwise.
    const text = new Text({ text: importsLabel(corridor.count), style: { fontFamily: FONT, fontSize: 12, fill: TOKENS.inkMuted, fontWeight: "500" } });
    text.anchor.set(0.5);
    text.position.set(mid.x, mid.y);
    if (faded) text.alpha = 0.5;
    ctx.layers.corridors.addChild(pinText(ctx, "count", `${corridor.fromWing}\u2192${corridor.toWing}`, text, 12, "hide", badge));
  }
  if (anyLine) lines.stroke({ width: 2, color: TOKENS.passage, alpha: 0.8, join: "round", cap: "round" });
  if (anyFaded) linesFaded.stroke({ width: 2, color: TOKENS.passage, alpha: 0.25, join: "round", cap: "round" });
}

export interface RouteHandle {
  /** Advance the traveling light, the ghost and the glow; a no-op under reduced motion. */
  update(deltaMs: number, cost?: CostSink): void;
  /** The camera zoom changed: keep the ghost and the light at the size of the design on screen. */
  setZoom(zoom: number): void;
  readonly particleCount: number;
  /** Where the ghost is and on which leg of the loop (scene units); null when the route is not a loop. */
  ghost(): { leg: number; x: number; y: number } | null;
  /** True while the glow of a looping corridor is drawn. */
  readonly glow: boolean;
  /** The opacity of the glow now (it breathes between 0.6 and 1); 1 and constant under reduced motion; null without a loop. */
  glowAlpha(): number | null;
  /** The traveling light on the selected path (scene units); null while it rests between two runs or when nothing is selected. */
  light(): { x: number; y: number } | null;
  /** The doors that swing for the ghost or the light, with the phase of each swing (halloween detail pass). */
  doors(): DoorReading[];
  /** The rooms of the loop the ghost walks and the lap it is on; null when this part is not a loop. */
  loop(): { lap: number; rooms: RoomLightReading[] } | null;
}

const NO_LOOP = (): null => null;

/** Hand the swing of each kept door to its leaf (drawing only). */
function applyLeaves(ctx: DrawContext, keeper: DoorKeeper, ids: readonly string[]): void {
  const leaves = ctx.fx?.leaves;
  if (leaves === undefined) return;
  for (const id of ids) leaves.get(id)?.setOpen(keeper.swing(id));
}

/** The kept doors of a route: every distinct relation of it whose door is drawn, with its center and width. */
function keptDoors(layout: LayoutResult, relationIds: readonly string[], zoom: number): { id: string; x: number; y: number; w: number; stand: number }[] {
  const byId = new Map(layout.doors.map((d) => [d.relationId, d] as const));
  const out: { id: string; x: number; y: number; w: number; stand: number }[] = [];
  for (const id of new Set(relationIds)) {
    const d = byId.get(id);
    // The door opens within its reach (the ghost is wider than the door); under reduced motion only the door the actor stands on is open.
    if (d !== undefined) out.push({ id, x: d.x + d.w / 2, y: d.y + d.h / 2, w: doorReachUnits(zoom), stand: d.w });
  }
  return out;
}

function center(r: { x: number; y: number; w: number; h: number }): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/**
 * The ghost of the design, drawn in code at 1 unit = 1 px: a body of 28 by 30 with fully rounded top corners, three
 * round scallops along the hem, two dark eyes and an ecto glow.
 */
export function makeGhost(): Container {
  const node = new Container();
  node.label = "ghost";
  const halo = new Graphics();
  halo.circle(0, 0, 25).fill({ color: TOKENS.corridor, alpha: 0.1 });
  halo.circle(0, 0, 20).fill({ color: TOKENS.corridor, alpha: 0.16 });
  halo.circle(0, 0, 16).fill({ color: TOKENS.corridor, alpha: 0.24 });
  node.addChild(halo);
  const body = new Graphics();
  const scallop = 28 / 3 / 2;
  body.moveTo(-14, 11).lineTo(-14, -1).arc(0, -1, 14, Math.PI, 0).lineTo(14, 11);
  for (const cx of [14 - scallop, 0, -14 + scallop]) body.arc(cx, 11, scallop, 0, Math.PI, false);
  body.closePath().fill({ color: TOKENS.ghost, alpha: 1 });
  body.circle(-5, -2, 2.2).fill(TOKENS.floor);
  body.circle(5, -2, 2.2).fill(TOKENS.floor);
  node.addChild(body);
  return node;
}

/** The glow of a looping corridor: a wide soft band, a narrower one, and the 4 unit corridor itself. */
function drawGlow(parent: Container, legs: readonly Leg[]): void {
  for (const [width, alpha] of [
    [18, 0.14],
    [10, 0.26],
    [4, 1],
  ] as const) {
    const g = new Graphics();
    for (const leg of legs) {
      const first = leg.points[0] as Point;
      g.moveTo(first.x, first.y);
      for (const p of leg.points.slice(1)) g.lineTo(p.x, p.y);
    }
    g.stroke({ width, color: TOKENS.corridor, alpha, join: "round", cap: "round" });
    parent.addChild(g);
  }
}

const EMPTY_LIGHT = (): null => null;

/** One handle for the parts of a route (a loop, a trace, the light on the selected path). */
function combine(parts: RouteHandle[]): RouteHandle | null {
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0] as RouteHandle;
  return {
    update: (deltaMs, cost) => parts.forEach((p) => p.update(deltaMs, cost)),
    setZoom: (zoom) => parts.forEach((p) => p.setZoom(zoom)),
    get particleCount() {
      return parts.reduce((sum, p) => sum + p.particleCount, 0);
    },
    ghost: () => parts.map((p) => p.ghost()).find((g) => g !== null) ?? null,
    get glow() {
      return parts.some((p) => p.glow);
    },
    glowAlpha: () => parts.map((p) => p.glowAlpha()).find((a) => a !== null) ?? null,
    light: () => parts.map((p) => p.light()).find((l) => l !== null) ?? null,
    doors: () => parts.flatMap((p) => p.doors()),
    loop: () => {
      const loops = parts.map((p) => p.loop()).filter((l): l is NonNullable<typeof l> => l !== null);
      if (loops.length === 0) return null;
      // A room on two loops is lit when either ghost has lit it.
      const rooms = new Map<string, RoomLightReading>();
      for (const r of loops.flatMap((l) => l.rooms)) {
        const known = rooms.get(r.id);
        if (known === undefined || r.glow > known.glow || (r.lit && !known.lit)) rooms.set(r.id, r);
      }
      return { lap: (loops[0] as NonNullable<(typeof loops)[number]>).lap, rooms: [...rooms.values()] };
    },
  };
}

/**
 * What moves on the map. A witness filter (a dependency loop the reader chose) or, with no filter, every loop of the
 * investigation: a looping corridor that glows and a ghost that walks it from door to door. A trace is a light-colored
 * corridor through the drawn rooms with a traveling light. A selected door carries a traveling light along its path.
 * Under reduced motion the ghost stands at its first door, the glow and the light stop, and no particle is drawn.
 */
export function drawRoute(ctx: DrawContext, layout: LayoutResult): RouteHandle | null {
  const parts: RouteHandle[] = [];
  const route = ctx.states.route;
  // The things the decor moves count inside the 40 particles first; the dust of the loops takes what is left.
  const budget = { left: Math.max(0, MAX_PARTICLES - (ctx.particlesTaken ?? 0)) };
  // The doors the ghost opens are the ghost's: the light of a selected relation leaves them alone.
  const claimed = new Set<string>();
  if (route !== null && route.kind === "witness") {
    const part = drawLoop(ctx, layout, route, true, budget);
    if (part !== null) parts.push(part);
    route.relationIds.forEach((id) => claimed.add(id));
  } else if (route !== null && route.kind === "trace") {
    const part = drawTrace(ctx, layout, route);
    if (part !== null) parts.push(part);
    route.relationIds.forEach((id) => claimed.add(id));
  } else if (route === null) {
    for (const loop of ctx.states.ambient) {
      const part = drawLoop(ctx, layout, loop, false, budget);
      if (part !== null) parts.push(part);
      loop.relationIds.forEach((id) => claimed.add(id));
    }
  }
  const light = drawSelectedLight(ctx, layout, claimed);
  if (light !== null) parts.push(light);
  return combine(parts);
}

function drawLoop(ctx: DrawContext, layout: LayoutResult, route: { modules: string[]; relationIds: string[] }, steps: boolean, budget: { left: number }): RouteHandle | null {
  const legs = witnessLegs(layout, route);
  if (legs.length === 0) return null;
  const glow = new Container();
  drawGlow(glow, legs);
  ctx.layers.selected.addChild(glow);
  if (steps) {
    // A step whose door is not drawn is numbered at the start of its leg.
    const drawnDoors = new Set(layout.doors.map((d) => d.relationId));
    route.relationIds.forEach((id, k) => {
      const start = legs[k]?.points[0];
      if (!drawnDoors.has(id) && start !== undefined) ctx.layers.selected.addChild(pinText(ctx, "step", String(k + 1), stepMark(k + 1, start.x, start.y), STEP_FONT));
    });
  }
  const ghost = makeGhost();
  ctx.layers.selected.addChild(ghost);
  const size = ctx.compact === true ? GHOST_SCALE_PHONE : 1;
  let scale = size / Math.max(ctx.zoom, 0.0001);
  let zoomNow = Math.max(ctx.zoom, 0.0001);
  let clock = 0;
  const first = (legs[0] as Leg).points[0] as Point;
  let state = { leg: 0, x: first.x, y: first.y };
  // The ghost walks door to door at 60 px per second on screen at the zoom of every frame, and bobs 3 px every 800 ms.
  const walker = createWalker(legs, GHOST_PAUSE_MS);
  const place = (): void => {
    const at = walker.at;
    const bob = ctx.reduced ? 0 : bobOffsetPx(clock) * scale;
    state = { leg: walker.leg, x: at.x, y: at.y };
    ghost.position.set(at.x, at.y + bob);
    ghost.scale.set(scale);
  };
  let keeperOf: DoorKeeper | null = null;
  const setZoom = (zoom: number): void => {
    zoomNow = Math.max(zoom, 0.0001);
    scale = size / zoomNow;
    ghost.scale.set(scale);
    keeperOf?.setReach(doorReachUnits(zoomNow));
  };
  setZoom(ctx.zoom);
  place();
  // The rooms of the loop light as the ghost reaches their door, and the doors it passes swing open and shut. Both read the walker only.
  const legModules = legs.map((leg, k) => route.modules[leg.from ?? k] as string);
  const lights = createLoopLights(legModules);
  const kept = keptDoors(layout, route.relationIds, ctx.zoom);
  const keeper = createDoorKeeper(kept);
  keeperOf = keeper;
  const keptIds = kept.map((d) => d.id);
  const roomHandles = ctx.fx?.loopRooms;
  const applyLights = (): void => {
    if (roomHandles === undefined) return;
    for (const r of lights.rooms()) roomHandles.get(r.id)?.setGlow(r.glow);
  };
  const readLoop = (): { lap: number; rooms: RoomLightReading[] } => ({ lap: lights.lap, rooms: lights.rooms().filter((r) => roomHandles === undefined || roomHandles.has(r.id)) });
  if (ctx.reduced) {
    // Still: every room of the loop is lit, the ghost stands at its first door and that door is open, the others are shut.
    lights.still();
    applyLights();
    keeper.settle(walker.at);
    applyLeaves(ctx, keeper, keptIds);
    return { update: () => undefined, setZoom, particleCount: 0, ghost: () => ({ ...state }), glow: true, glowAlpha: () => 1, light: EMPTY_LIGHT, doors: () => keeper.list(), loop: readLoop };
  }
  lights.sync(walker.leg, walker.lap);
  applyLights();
  keeper.update(0, walker.at);
  applyLeaves(ctx, keeper, keptIds);

  const loop: Point[] = legs.flatMap((leg) => leg.points);
  const total = polylineLength(loop);
  const particleCount = Math.max(0, Math.min(budget.left, 4 * legs.length));
  budget.left -= particleCount;
  const dust = new Container();
  const particles: Graphics[] = [];
  for (let i = 0; i < particleCount; i++) {
    const p = new Graphics();
    p.circle(0, 0, 1.6).fill({ color: TOKENS.corridor, alpha: 0.65 });
    dust.addChild(p);
    particles.push(p);
  }
  ctx.layers.particles.addChild(dust);
  const placeDust = (): void => {
    particles.forEach((p, i) => {
      const u = (((clock / (3000 * legs.length) + i / particleCount) % 1) + 1) % 1;
      const pos = pointOnPolyline(loop, u * total);
      p.position.set(pos.x, pos.y + Math.sin(clock / 400 + i) * 3);
    });
  };
  placeDust();
  const breathe = (): void => {
    glow.alpha = glowAlphaAt(clock);
  };
  breathe();
  return {
    update(deltaMs, cost) {
      const t0 = cost === undefined ? 0 : performance.now();
      clock += deltaMs;
      walker.advance(deltaMs, GHOST_SPEED_PX_S / zoomNow);
      place();
      placeDust();
      breathe();
      const t1 = cost === undefined ? 0 : performance.now();
      lights.sync(walker.leg, walker.lap);
      lights.advance(deltaMs);
      applyLights();
      const t2 = cost === undefined ? 0 : performance.now();
      keeper.update(deltaMs, walker.at);
      applyLeaves(ctx, keeper, keptIds);
      if (cost !== undefined) {
        cost("ghost", t1 - t0);
        cost("loopLights", t2 - t1);
        cost("doors", performance.now() - t2);
      }
    },
    setZoom,
    particleCount,
    ghost: () => ({ ...state }),
    glow: true,
    glowAlpha: () => glow.alpha,
    light: EMPTY_LIGHT,
    doors: () => keeper.list(),
    loop: readLoop,
  };
}

/** The warm dot of the design: 12 px, a candle glow around it. At 1 unit = 1 px; the caller scales it by 1 / zoom. */
function makeLight(): Container {
  const node = new Container();
  node.label = "light";
  const g = new Graphics();
  g.circle(0, 0, 14).fill({ color: TOKENS.focus, alpha: 0.14 });
  g.circle(0, 0, 10).fill({ color: TOKENS.focus, alpha: 0.28 });
  g.circle(0, 0, 6).fill(TOKENS.light);
  node.addChild(g);
  return node;
}

/**
 * The traveling light on the selected door: it runs the path of the door in 900 ms, ease in and out, every 2.5 s.
 * Under reduced motion it is a static dot in the middle of the path.
 */
function drawSelectedLight(ctx: DrawContext, layout: LayoutResult, claimed: ReadonlySet<string>): RouteHandle | null {
  let selected: string | null = null;
  for (const [id, info] of ctx.states.doors) {
    if (info.state === "selected") {
      selected = id;
      break;
    }
  }
  if (selected === null) return null;
  const door = layout.doors.find((d) => d.relationId === selected);
  const points = door?.arrow;
  if (points === undefined || points.length < 2) return null;
  const length = polylineLength(points);
  if (length <= 0) return null;
  const light = makeLight();
  ctx.layers.selected.addChild(light);
  let scale = 1 / Math.max(ctx.zoom, 0.0001);
  let clock = 0;
  let at: Point | null = null;
  const place = (): void => {
    const progress = ctx.reduced ? 0.5 : lightProgress(clock);
    light.visible = progress !== null;
    at = progress === null ? null : pointOnPolyline(points, progress * length);
    if (at !== null) light.position.set(at.x, at.y);
    light.scale.set(scale);
  };
  place();
  // The door of the selected relation swings open as the light reaches it and shuts after the light has gone; a door that the ghost of a
  // loop already walks through is the ghost's. Under reduced motion the light is a static marker and the door stays open.
  const kept = claimed.has(selected) ? [] : keptDoors(layout, [selected], ctx.zoom);
  const keeper = createDoorKeeper(kept);
  const keptIds = kept.map((d) => d.id);
  if (ctx.reduced) keeper.setAll(true);
  else keeper.update(0, at);
  applyLeaves(ctx, keeper, keptIds);
  return {
    update(deltaMs, cost) {
      if (ctx.reduced) return;
      const t0 = cost === undefined ? 0 : performance.now();
      clock += deltaMs;
      place();
      keeper.update(deltaMs, at);
      applyLeaves(ctx, keeper, keptIds);
      cost?.("doors", performance.now() - t0);
    },
    setZoom(zoom) {
      scale = 1 / Math.max(zoom, 0.0001);
      light.scale.set(scale);
      keeper.setReach(doorReachUnits(zoom));
    },
    particleCount: 0,
    ghost: () => null,
    glow: false,
    glowAlpha: () => null,
    light: () => (at === null ? null : { ...at }),
    doors: () => keeper.list(),
    loop: NO_LOOP,
  };
}

function drawTrace(ctx: DrawContext, layout: LayoutResult, route: { kind: string; modules: string[]; relationIds: string[] }): RouteHandle | null {
  const rooms = new Map(layout.rooms.map((r) => [r.id, r]));
  const points: Point[] = [];
  for (const id of route.modules) {
    const room = rooms.get(id);
    if (room !== undefined) points.push(center(room));
  }
  const color = TOKENS.light;
  if (points.length < 2) return null;

  const line = new Graphics();
  line.moveTo((points[0] as Point).x, (points[0] as Point).y);
  for (const p of points.slice(1)) line.lineTo(p.x, p.y);
  line.stroke({ width: 4, color });
  ctx.layers.selected.addChild(line);

  const doors = new Map(layout.doors.map((d) => [d.relationId, d]));
  route.relationIds.forEach((id, i) => {
    const door = doors.get(id);
    const a = points[i];
    const b = points[i + 1];
    const at: Point | null = door !== undefined ? center(door) : a !== undefined && b !== undefined ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null;
    if (at === null) return;
    if (door === undefined) ctx.layers.selected.addChild(pinText(ctx, "step", String(i + 1), stepMark(i + 1, at.x, at.y), STEP_FONT));
    if (ctx.reduced) {
      const ring = new Graphics();
      ring.circle(at.x, at.y, 11).stroke({ width: 2, color: TOKENS.light });
      ctx.layers.selected.addChild(ring);
    }
  });

  // The doors of the route swing open as the light passes them and shut after it has gone. The light runs through each door on its way
  // from room to room (the drawn line stays from room to room). Under reduced motion every door of the route stays open.
  const kept = keptDoors(layout, route.relationIds, ctx.zoom);
  const keeper = createDoorKeeper(kept);
  const keptIds = kept.map((d) => d.id);
  if (ctx.reduced) {
    keeper.setAll(true);
    applyLeaves(ctx, keeper, keptIds);
    return { update: () => undefined, setZoom: () => undefined, particleCount: 0, ghost: () => null, glow: false, glowAlpha: () => null, light: EMPTY_LIGHT, doors: () => keeper.list(), loop: NO_LOOP };
  }

  // The light runs the whole dependency path in 900 ms, ease in and out, and starts again every 2.5 s.
  const path: Point[] = [points[0] as Point];
  route.relationIds.forEach((id, i) => {
    const door = doors.get(id);
    const b = points[i + 1];
    if (door !== undefined) path.push(center(door));
    if (b !== undefined) path.push(b);
  });
  const total = polylineLength(path);
  const light = new Graphics();
  light.circle(0, 0, 6).fill(TOKENS.light);
  ctx.layers.selected.addChild(light);
  let clock = 0;
  let at: Point | null = null;
  const place = (): void => {
    const progress = lightProgress(clock);
    light.visible = progress !== null;
    at = progress === null ? null : pointOnPolyline(path, progress * total);
    if (at !== null) light.position.set(at.x, at.y);
  };
  place();
  keeper.update(0, at);
  applyLeaves(ctx, keeper, keptIds);
  return {
    update(deltaMs, cost) {
      const t0 = cost === undefined ? 0 : performance.now();
      clock += deltaMs;
      place();
      keeper.update(deltaMs, at);
      applyLeaves(ctx, keeper, keptIds);
      cost?.("doors", performance.now() - t0);
    },
    setZoom: (zoom) => keeper.setReach(doorReachUnits(zoom)),
    particleCount: 0,
    ghost: () => null,
    glow: false,
    glowAlpha: () => null,
    light: () => (at === null ? null : { ...at }),
    doors: () => keeper.list(),
    loop: NO_LOOP,
  };
}