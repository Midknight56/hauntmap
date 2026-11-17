import type { LayoutResult, Point, Rect } from "./layout/types";

// The path the ghost walks along a dependency loop, and where it is at a given time. Pure, no PixiJS.

export interface Leg {
  points: Point[];
  length: number;
}

const centerOf = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

export function polylineLength(points: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot((points[i] as Point).x - (points[i - 1] as Point).x, (points[i] as Point).y - (points[i - 1] as Point).y);
  return total;
}

/** The point at `distance` along the polyline; before the start it is the start, past the end it is the end. */
export function pointOnPolyline(points: readonly Point[], distance: number): Point {
  const first = points[0];
  if (first === undefined) return { x: 0, y: 0 };
  let walk = Math.max(0, distance);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Point;
    const b = points[i] as Point;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (walk <= length) {
      const f = length === 0 ? 0 : walk / length;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
    walk -= length;
  }
  return { ...(points[points.length - 1] as Point) };
}

/**
 * One leg for each relation of a witness, in step order: from the door of step k, along the passage that door
 * opens, to the door of step k + 1 (the last leg returns to the door of step 1). A door that is not drawn is
 * replaced by the center of its room, and a room that is not drawn (its wing is closed) by the center of its wing.
 */
export function witnessLegs(layout: Pick<LayoutResult, "rooms" | "doors" | "wings">, route: { modules: readonly string[]; relationIds: readonly string[] }): Leg[] {
  const rooms = new Map(layout.rooms.map((r) => [r.id, r] as const));
  const doors = new Map(layout.doors.map((d) => [d.relationId, d] as const));
  const wings = new Map(layout.wings.map((w) => [w.wing, w] as const));
  const n = route.relationIds.length;
  const anchor = (k: number): Point | null => {
    const door = doors.get(route.relationIds[k] as string);
    if (door !== undefined) return centerOf(door);
    const module = route.modules[k] as string;
    const room = rooms.get(module);
    if (room !== undefined) return centerOf(room);
    const wing = wings.get(module.slice(0, Math.max(0, module.lastIndexOf("/"))) || "(root)");
    return wing === undefined ? null : centerOf(wing);
  };
  const legs: Leg[] = [];
  for (let k = 0; k < n; k++) {
    const from = anchor(k);
    const to = anchor((k + 1) % n);
    if (from === null || to === null) continue;
    const door = doors.get(route.relationIds[k] as string);
    const points: Point[] = [from, ...(door === undefined ? [] : door.arrow.slice(1)), to];
    legs.push({ points, length: polylineLength(points) });
  }
  return legs;
}

/** The ghost at time `clockMs`: one leg for each `stepMs`, looping. */
export function ghostAt(legs: readonly Leg[], clockMs: number, stepMs: number): { leg: number; at: Point } {
  if (legs.length === 0) return { leg: 0, at: { x: 0, y: 0 } };
  const steps = Math.max(0, clockMs) / stepMs;
  const leg = Math.floor(steps) % legs.length;
  const f = steps - Math.floor(steps);
  const current = legs[leg] as Leg;
  return { leg, at: pointOnPolyline(current.points, current.length * f) };
}
