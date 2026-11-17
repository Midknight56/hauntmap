import { Container, Graphics, Sprite, Text } from "pixi.js";
import { stepMark, STEP_FONT } from "./doors";
import { FONT } from "./elements";
import { pinText, type DrawContext } from "./rooms";
import type { LayoutResult, Point } from "./layout/types";
import { TOKENS } from "./styles";
import { GHOST_PAUSE_MS, GHOST_SPEED_PX_S, ghostAtSpeed, lightProgress, pointOnPolyline, polylineLength, witnessLegs, type Leg } from "./walk";

/** The traveling light of a trace (`Who imports`) crosses one step in 1,200 ms and loops. */
export const LIGHT_STEP_MS = 1200;
export const MAX_PARTICLES = 40;
/** The glow of a looping corridor breathes between 60 and 100 percent of its opacity over 2.4 s. */
export const GLOW_PERIOD_MS = 2400;
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
  for (const corridor of layout.corridors) {
    const path = corridor.route ?? corridor.path;
    if (path.length < 2) continue;
    const faded = ctx.related !== null && !bright.has(JSON.stringify([corridor.fromWing, corridor.toWing]));
    const line = new Graphics();
    const first = path[0] as Point;
    line.moveTo(first.x, first.y);
    for (const p of path.slice(1)) line.lineTo(p.x, p.y);
    line.stroke({ width: 2, color: TOKENS.passage, alpha: faded ? 0.25 : 0.8, join: "round", cap: "round" });
    ctx.layers.corridors.addChild(line);
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
}

export interface RouteHandle {
  /** Advance the traveling light, the ghost and the glow; a no-op under reduced motion. */
  update(deltaMs: number): void;
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
}

function center(r: { x: number; y: number; w: number; h: number }): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/**
 * The ghost of the design, drawn in code at 1 unit = 1 px: a body of 28 by 30 with fully rounded top corners, three
 * round scallops along the hem, two dark eyes and an ecto glow.
 */
function makeGhost(): Container {
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
    update: (deltaMs) => parts.forEach((p) => p.update(deltaMs)),
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
  const budget = { left: MAX_PARTICLES };
  if (route !== null && route.kind === "witness") {
    const part = drawLoop(ctx, layout, route, true, budget);
    if (part !== null) parts.push(part);
  } else if (route !== null && route.kind === "trace") {
    const part = drawTrace(ctx, layout, route);
    if (part !== null) parts.push(part);
  } else if (route === null) {
    for (const loop of ctx.states.ambient) {
      const part = drawLoop(ctx, layout, loop, false, budget);
      if (part !== null) parts.push(part);
    }
  }
  const light = drawSelectedLight(ctx, layout);
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
  let clock = 0;
  const first = (legs[0] as Leg).points[0] as Point;
  let state = { leg: 0, x: first.x, y: first.y };
  // The speed is 60 px per second on screen at the zoom of this pass.
  const unitsPerSecond = GHOST_SPEED_PX_S / Math.max(ctx.zoom, 0.25);
  const place = (): void => {
    const at = ghostAtSpeed(legs, clock, unitsPerSecond, GHOST_PAUSE_MS);
    // Bobs 3 px every 800 ms.
    const bob = ctx.reduced ? 0 : Math.sin((clock / 800) * Math.PI * 2) * 1.5 * scale;
    state = { leg: at.leg, x: at.at.x, y: at.at.y };
    ghost.position.set(at.at.x, at.at.y + bob);
    ghost.scale.set(scale);
  };
  const setZoom = (zoom: number): void => {
    scale = size / Math.max(zoom, 0.0001);
    ghost.scale.set(scale);
  };
  setZoom(ctx.zoom);
  place();
  if (ctx.reduced) {
    return { update: () => undefined, setZoom, particleCount: 0, ghost: () => ({ ...state }), glow: true, glowAlpha: () => 1, light: EMPTY_LIGHT };
  }

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
    glow.alpha = 0.8 + 0.2 * Math.sin((clock / GLOW_PERIOD_MS) * Math.PI * 2);
  };
  breathe();
  return {
    update(deltaMs) {
      clock += deltaMs;
      place();
      placeDust();
      breathe();
    },
    setZoom,
    particleCount,
    ghost: () => ({ ...state }),
    glow: true,
    glowAlpha: () => glow.alpha,
    light: EMPTY_LIGHT,
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
function drawSelectedLight(ctx: DrawContext, layout: LayoutResult): RouteHandle | null {
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
  return {
    update(deltaMs) {
      if (ctx.reduced) return;
      clock += deltaMs;
      place();
    },
    setZoom(zoom) {
      scale = 1 / Math.max(zoom, 0.0001);
      light.scale.set(scale);
    },
    particleCount: 0,
    ghost: () => null,
    glow: false,
    glowAlpha: () => null,
    light: () => (at === null ? null : { ...at }),
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

  if (ctx.reduced) return { update: () => undefined, setZoom: () => undefined, particleCount: 0, ghost: () => null, glow: false, glowAlpha: () => null, light: EMPTY_LIGHT };

  const segments = points.length - 1;
  const light = new Graphics();
  light.circle(0, 0, 6).fill(TOKENS.light);
  ctx.layers.selected.addChild(light);

  const at = (t: number): Point => {
    const s = ((t % segments) + segments) % segments;
    const i = Math.min(segments - 1, Math.floor(s));
    const f = s - i;
    const a = points[i] as Point;
    const b = points[i + 1] as Point;
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  };
  let clock = 0;
  const place = (): void => {
    const lightPos = at(clock / LIGHT_STEP_MS);
    light.position.set(lightPos.x, lightPos.y);
  };
  place();
  return {
    update(deltaMs) {
      clock += deltaMs;
      place();
    },
    setZoom: () => undefined,
    particleCount: 0,
    ghost: () => null,
    glow: false,
    glowAlpha: () => null,
    light: EMPTY_LIGHT,
  };
}
