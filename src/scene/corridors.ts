import { Container, Graphics, Sprite, Text } from "pixi.js";
import { stepMark } from "./doors";
import { FONT } from "./elements";
import type { DrawContext } from "./rooms";
import type { LayoutResult, Point } from "./layout/types";
import { TOKENS } from "./styles";

/** The light travels one step in 1,200 ms and loops. */
export const LIGHT_STEP_MS = 1200;
export const MAX_PARTICLES = 40;

export function importsLabel(count: number): string {
  return count === 1 ? "1 import" : `${count} imports`;
}

/** Aggregated corridors between wings, each labelled with its import count. */
export function drawCorridors(ctx: DrawContext, layout: LayoutResult): void {
  for (const corridor of layout.corridors) {
    if (corridor.path.length < 2) continue;
    const line = new Graphics();
    const first = corridor.path[0] as Point;
    line.moveTo(first.x, first.y);
    for (const p of corridor.path.slice(1)) line.lineTo(p.x, p.y);
    line.stroke({ width: 2, color: TOKENS.inkMuted });
    ctx.layers.corridors.addChild(line);
    const a = first;
    const b = corridor.path[corridor.path.length - 1] as Point;
    const mid = corridor.badge ?? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const badge = new Sprite(ctx.textures.get("corridor", "default"));
    badge.anchor.set(0.5);
    badge.position.set(mid.x, mid.y);
    ctx.layers.corridors.addChild(badge);
    const text = new Text({ text: importsLabel(corridor.count), style: { fontFamily: FONT, fontSize: 10, fill: TOKENS.ink } });
    text.anchor.set(0.5);
    text.position.set(mid.x, mid.y);
    ctx.layers.corridors.addChild(text);
  }
}

export interface RouteHandle {
  /** Advance the traveling light and the particles; a no-op under reduced motion. */
  update(deltaMs: number): void;
  readonly particleCount: number;
}

function center(r: { x: number; y: number; w: number; h: number }): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/**
 * The route of a witness or trace filter: one violet (witness, closing on its first room) or light-blue
 * (trace) corridor through the drawn rooms, a numbered marker at every step, and the traveling light.
 * Under reduced motion the light is a static ring on every marker and there are no particles.
 */
export function drawRoute(ctx: DrawContext, layout: LayoutResult): RouteHandle | null {
  const route = ctx.states.route;
  if (route === null || route.kind === "focus") return null;
  const rooms = new Map(layout.rooms.map((r) => [r.id, r]));
  const points: Point[] = [];
  for (const id of route.modules) {
    const room = rooms.get(id);
    if (room !== undefined) points.push(center(room));
  }
  if (route.kind === "witness" && points.length > 0) points.push(points[0] as Point);
  const color = route.kind === "witness" ? TOKENS.corridor : TOKENS.light;
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
    if (door === undefined) ctx.layers.selected.addChild(stepMark(i + 1, at.x, at.y));
    if (ctx.reduced) {
      const ring = new Graphics();
      ring.circle(at.x, at.y, 11).stroke({ width: 2, color: TOKENS.light });
      ctx.layers.selected.addChild(ring);
    }
  });

  if (ctx.reduced) return { update: () => undefined, particleCount: 0 };

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
    particleCount,
  };
}