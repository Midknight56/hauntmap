import { Container, Graphics, Sprite, Text } from "pixi.js";
import { stepMark, STEP_FONT } from "./doors";
import { FONT } from "./elements";
import { pinText, type DrawContext } from "./rooms";
import type { LayoutResult, Point } from "./layout/types";
import { TOKENS } from "./styles";
import { ghostAt, pointOnPolyline, polylineLength, witnessLegs, type Leg } from "./walk";

/** The light travels one step in 1,200 ms and loops. The ghost of a dependency loop walks one leg in the same time. */
export const LIGHT_STEP_MS = 1200;
export const MAX_PARTICLES = 40;

export function importsLabel(count: number): string {
  return count === 1 ? "1 import" : `${count} imports`;
}

/** Aggregated corridors between wings: dim passages, each with a label of its import count. */
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
    line.stroke({ width: 8, color: TOKENS.passage, alpha: faded ? 0.08 : 0.26, join: "round", cap: "round" });
    line.moveTo(first.x, first.y);
    for (const p of path.slice(1)) line.lineTo(p.x, p.y);
    line.stroke({ width: 1.5, color: TOKENS.passage, alpha: faded ? 0.25 : 0.8, join: "round", cap: "round" });
    ctx.layers.corridors.addChild(line);
    const a = first;
    const b = path[path.length - 1] as Point;
    const mid = corridor.badge ?? pointOnPolyline(path, polylineLength(path) / 2) ?? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const badge = new Sprite(ctx.textures.get("corridor", "default"));
    badge.anchor.set(0.5);
    badge.position.set(mid.x, mid.y);
    if (faded) badge.alpha = 0.5;
    ctx.layers.corridors.addChild(badge);
    // The count is drawn only where its words are 11 CSS pixels or more; the badge and the Evidence view carry it otherwise.
    const text = new Text({ text: importsLabel(corridor.count), style: { fontFamily: FONT, fontSize: 11, fill: TOKENS.ink } });
    text.anchor.set(0.5);
    text.position.set(mid.x, mid.y);
    if (faded) text.alpha = 0.5;
    ctx.layers.corridors.addChild(pinText(ctx, "count", `${corridor.fromWing}\u2192${corridor.toWing}`, text, 11, "hide"));
  }
}

export interface RouteHandle {
  /** Advance the traveling light, the ghost and the particles; a no-op under reduced motion. */
  update(deltaMs: number): void;
  /** The camera zoom changed: keep the ghost at a size that can be seen. */
  setZoom(zoom: number): void;
  readonly particleCount: number;
  /** Where the ghost is and on which leg of the loop (scene units); null when the route is not a loop. */
  ghost(): { leg: number; x: number; y: number } | null;
  /** True while the glow of a looping corridor is drawn. */
  readonly glow: boolean;
}

function center(r: { x: number; y: number; w: number; h: number }): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/** A small ghost, drawn in code: a rounded head, a ragged hem, two dark eyes, and a soft halo. */
function makeGhost(): Container {
  const node = new Container();
  node.label = "ghost";
  const halo = new Graphics();
  halo.circle(0, 0, 16).fill({ color: TOKENS.corridor, alpha: 0.16 });
  halo.circle(0, 0, 10).fill({ color: TOKENS.corridor, alpha: 0.22 });
  node.addChild(halo);
  const body = new Graphics();
  body
    .moveTo(-7, 7)
    .lineTo(-7, -3)
    .arc(0, -3, 7, Math.PI, 0)
    .lineTo(7, 7)
    .quadraticCurveTo(5.25, 10.5, 3.5, 7)
    .quadraticCurveTo(1.75, 3.5, 0, 7)
    .quadraticCurveTo(-1.75, 10.5, -3.5, 7)
    .quadraticCurveTo(-5.25, 3.5, -7, 7)
    .closePath()
    .fill({ color: TOKENS.ghost, alpha: 0.96 })
    .stroke({ width: 1, color: TOKENS.floor, alpha: 0.85 });
  body.circle(-2.6, -3, 1.4).fill(TOKENS.floor);
  body.circle(2.6, -3, 1.4).fill(TOKENS.floor);
  node.addChild(body);
  return node;
}

/** The glow of a looping corridor: a wide soft band, a narrower one, and the corridor itself. Static: it never animates. */
function drawGlow(parent: Container, legs: readonly Leg[]): void {
  for (const [width, alpha] of [
    [18, 0.14],
    [9, 0.26],
    [3.5, 1],
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

/**
 * The route of a witness or trace filter. A witness (a dependency loop) is a looping corridor that glows, with a
 * small ghost that walks it door to door, one leg for each 1,200 ms step, in step order. A trace is a light-blue
 * corridor through the drawn rooms with a traveling light. Under reduced motion the ghost stands still at the first
 * door, the light is a static ring on every marker, the glow is the same, and there are no particles.
 */
export function drawRoute(ctx: DrawContext, layout: LayoutResult): RouteHandle | null {
  const route = ctx.states.route;
  if (route === null || route.kind === "focus") return null;
  if (route.kind === "witness") return drawLoop(ctx, layout, route);
  return drawTrace(ctx, layout, route);
}

function drawLoop(ctx: DrawContext, layout: LayoutResult, route: { modules: string[]; relationIds: string[] }): RouteHandle | null {
  const legs = witnessLegs(layout, route);
  if (legs.length === 0) return null;
  drawGlow(ctx.layers.selected, legs);
  // A step whose door is not drawn is numbered at the start of its leg.
  const drawnDoors = new Set(layout.doors.map((d) => d.relationId));
  route.relationIds.forEach((id, k) => {
    const start = legs[k]?.points[0];
    if (!drawnDoors.has(id) && start !== undefined) ctx.layers.selected.addChild(pinText(ctx, "step", String(k + 1), stepMark(k + 1, start.x, start.y), STEP_FONT));
  });
  const ghost = makeGhost();
  ctx.layers.selected.addChild(ghost);
  let scale = 1;
  let clock = 0;
  const first = (legs[0] as Leg).points[0] as Point;
  let state = { leg: 0, x: first.x, y: first.y };
  const place = (): void => {
    const at = ghostAt(legs, clock, LIGHT_STEP_MS);
    const bob = ctx.reduced ? 0 : Math.sin(clock / 260) * 1.6;
    state = { leg: at.leg, x: at.at.x, y: at.at.y };
    ghost.position.set(at.at.x, at.at.y + bob);
    ghost.scale.set(scale);
  };
  const setZoom = (zoom: number): void => {
    scale = Math.max(1.25, 17 / (18 * Math.max(zoom, 0.0001)));
    ghost.scale.set(scale);
  };
  setZoom(ctx.zoom);
  place();
  if (ctx.reduced) {
    return { update: () => undefined, setZoom, particleCount: 0, ghost: () => ({ ...state }), glow: true };
  }

  const loop: Point[] = legs.flatMap((leg) => leg.points);
  const total = polylineLength(loop);
  const particleCount = Math.min(MAX_PARTICLES, 6 * legs.length);
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
      const u = (((clock / (LIGHT_STEP_MS * legs.length * 2) + i / particleCount) % 1) + 1) % 1;
      const pos = pointOnPolyline(loop, u * total);
      p.position.set(pos.x, pos.y + Math.sin(clock / 400 + i) * 3);
    });
  };
  placeDust();
  return {
    update(deltaMs) {
      clock += deltaMs;
      place();
      placeDust();
    },
    setZoom,
    particleCount,
    ghost: () => ({ ...state }),
    glow: true,
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

  if (ctx.reduced) return { update: () => undefined, setZoom: () => undefined, particleCount: 0, ghost: () => null, glow: false };

  const segments = points.length - 1;
  const light = new Graphics();
  light.circle(0, 0, 6).fill(TOKENS.light);
  ctx.layers.selected.addChild(light);
  const particleCount = Math.min(MAX_PARTICLES, 6 * segments);
  const dust = new Container();
  const particles: Graphics[] = [];
  for (let i = 0; i < particleCount; i++) {
    const p = new Graphics();
    p.circle(0, 0, 1.5).fill({ color, alpha: 0.6 });
    dust.addChild(p);
    particles.push(p);
  }
  ctx.layers.particles.addChild(dust);

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
    particles.forEach((p, i) => {
      const pos = at(clock / (LIGHT_STEP_MS * 2) + (i * segments) / particleCount);
      p.position.set(pos.x, pos.y + Math.sin(clock / 400 + i) * 3);
    });
  };
  place();
  return {
    update(deltaMs) {
      clock += deltaMs;
      place();
    },
    setZoom: () => undefined,
    particleCount,
    ghost: () => null,
    glow: false,
  };
}
