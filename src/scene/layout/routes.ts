import type { CorridorBox, DoorBox, GroupedRoomBox, Point, Rect, RoomBox, WingBox } from "./types";

// Routed passages (the theme pass, item 6b). A door arrow or a corridor between wings used to be one straight
// line, which ran across rooms and wings. Here each one follows the gaps: an orthogonal path found on a coarse
// grid in which rooms (and the title plates and collapsed wings) are blocked. Pure and deterministic, and linear
// in the number of grid cells for each path, so it runs in the layout worker.

const EPSILON = 0.05;

/** True when the segment passes through the inside of the rectangle; touching an edge or ending on it does not count. */
export function segmentHitsRect(a: Point, b: Point, rect: Rect): boolean {
  const x0 = rect.x + EPSILON;
  const y0 = rect.y + EPSILON;
  const x1 = rect.x + rect.w - EPSILON;
  const y1 = rect.y + rect.h - EPSILON;
  if (x1 <= x0 || y1 <= y0) return false;
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return clip(-dx, a.x - x0) && clip(dx, x1 - a.x) && clip(-dy, a.y - y0) && clip(dy, y1 - a.y) && t0 <= t1;
}

function outsideDistance(p: Point, r: Rect): { dx: number; dy: number } {
  return { dx: Math.max(r.x - p.x, 0, p.x - (r.x + r.w)), dy: Math.max(r.y - p.y, 0, p.y - (r.y + r.h)) };
}

function clampTo(p: Point, r: Rect): Point {
  return { x: Math.min(Math.max(p.x, r.x), r.x + r.w), y: Math.min(Math.max(p.y, r.y), r.y + r.h) };
}

export interface Router {
  /** An orthogonal path from `start` to the edge of `goal`, or null when none exists. The first point is `start`; the last lies on the edge of `goal`. */
  route(start: Point, goal: Rect): Point[] | null;
}

export interface RouterOptions {
  /** Grid cell size in scene units. */
  cell: number;
  /** How far the blocked rectangles are inflated before they block cells. */
  margin: number;
  /** The most cells the router may expand over all its routes; a route that would pass it gives up (null). Keeps a layout of hundreds of rooms fast, and the same on every run. */
  budget?: number;
}

const DC = [1, -1, 0, 0];
const DR = [0, 0, 1, -1];
const TURN_COST = 2.5;
const NEAR_COST = 0.6;

class Heap {
  private keys: number[] = [];
  private values: number[] = [];
  get size(): number {
    return this.keys.length;
  }
  push(key: number, value: number): void {
    const keys = this.keys;
    const values = this.values;
    let i = keys.length;
    keys.push(key);
    values.push(value);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if ((keys[parent] as number) <= key) break;
      keys[i] = keys[parent] as number;
      values[i] = values[parent] as number;
      i = parent;
    }
    keys[i] = key;
    values[i] = value;
  }
  pop(): number {
    const keys = this.keys;
    const values = this.values;
    const top = values[0] as number;
    const lastKey = keys.pop() as number;
    const lastValue = values.pop() as number;
    const n = keys.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= n) break;
        if (child + 1 < n && (keys[child + 1] as number) < (keys[child] as number)) child++;
        if ((keys[child] as number) >= lastKey) break;
        keys[i] = keys[child] as number;
        values[i] = values[child] as number;
        i = child;
      }
      keys[i] = lastKey;
      values[i] = lastValue;
    }
    return top;
  }
}

export function createRouter(bounds: Rect, blockedRects: readonly Rect[], options: RouterOptions): Router {
  const { cell, margin } = options;
  let budget = options.budget ?? Number.POSITIVE_INFINITY;
  const cols = Math.max(1, Math.ceil(bounds.w / cell));
  const rows = Math.max(1, Math.ceil(bounds.h / cell));
  const blocked = new Uint8Array(cols * rows);
  const centerX = (c: number): number => bounds.x + (c + 0.5) * cell;
  const centerY = (r: number): number => bounds.y + (r + 0.5) * cell;
  for (const rect of blockedRects) {
    const left = rect.x - margin;
    const top = rect.y - margin;
    const right = rect.x + rect.w + margin;
    const bottom = rect.y + rect.h + margin;
    const c0 = Math.max(0, Math.floor((left - bounds.x) / cell));
    const c1 = Math.min(cols - 1, Math.ceil((right - bounds.x) / cell));
    const r0 = Math.max(0, Math.floor((top - bounds.y) / cell));
    const r1 = Math.min(rows - 1, Math.ceil((bottom - bounds.y) / cell));
    for (let r = r0; r <= r1; r++) {
      const y = centerY(r);
      if (y <= top || y >= bottom) continue;
      for (let c = c0; c <= c1; c++) {
        const x = centerX(c);
        if (x > left && x < right) blocked[r * cols + c] = 1;
      }
    }
  }

  // One set of search arrays for all routes of this router; a generation number stands in for clearing them.
  const states = cols * rows * 5;
  const g = new Float32Array(states);
  const parent = new Int32Array(states);
  const seen = new Uint32Array(states);
  const done = new Uint32Array(states);
  let generation = 0;

  return {
    route(start, goal) {
      const sc = Math.min(cols - 1, Math.max(0, Math.floor((start.x - bounds.x) / cell)));
      const sr = Math.min(rows - 1, Math.max(0, Math.floor((start.y - bounds.y) / cell)));
      const startIdx = sr * cols + sc;
      const reach = margin + cell * 1.01;
      const isGoal = (idx: number): boolean => {
        const c = idx % cols;
        const r = (idx - c) / cols;
        const d = outsideDistance({ x: centerX(c), y: centerY(r) }, goal);
        return Math.hypot(d.dx, d.dy) <= reach;
      };
      const heuristic = (idx: number): number => {
        const c = idx % cols;
        const r = (idx - c) / cols;
        const d = outsideDistance({ x: centerX(c), y: centerY(r) }, goal);
        return Math.max(0, (d.dx + d.dy - reach) / cell);
      };
      const free = (idx: number): boolean => blocked[idx] === 0 || idx === startIdx;

      const finish = (cells: number[]): Point[] => {
        const points: Point[] = cells.map((idx) => {
          const c = idx % cols;
          return { x: centerX(c), y: centerY((idx - c) / cols) };
        });
        const corners: Point[] = [];
        points.forEach((p, i) => {
          const a = points[i - 1];
          const b = points[i + 1];
          if (a !== undefined && b !== undefined && ((a.x === p.x && p.x === b.x) || (a.y === p.y && p.y === b.y))) return;
          corners.push(p);
        });
        const last = corners[corners.length - 1] as Point;
        return [start, ...corners, clampTo(last, goal)];
      };

      if (isGoal(startIdx)) return [start, clampTo(start, goal)];

      generation += 1;
      const heap = new Heap();
      const first = startIdx * 5 + 4;
      g[first] = 0;
      parent[first] = -1;
      seen[first] = generation;
      heap.push(heuristic(startIdx), first);
      while (heap.size > 0) {
        const state = heap.pop();
        if (done[state] === generation) continue;
        done[state] = generation;
        if (budget <= 0) return null;
        budget -= 1;
        const dir = state % 5;
        const idx = (state - dir) / 5;
        if (isGoal(idx)) {
          const cells: number[] = [];
          for (let s = state; s !== -1; s = parent[s] as number) cells.push(((s - (s % 5)) / 5) as number);
          cells.reverse();
          return finish(cells);
        }
        const c = idx % cols;
        const r = (idx - c) / cols;
        for (let d = 0; d < 4; d++) {
          const nc = c + (DC[d] as number);
          const nr = r + (DR[d] as number);
          if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
          const nIdx = nr * cols + nc;
          if (!free(nIdx)) continue;
          const next = nIdx * 5 + d;
          if (done[next] === generation) continue;
          let step = 1;
          if (dir !== 4 && dir !== d) step += TURN_COST;
          // Keep to the middle of a gap: a cell beside a blocked one costs a little more.
          for (let k = 0; k < 4; k++) {
            const kc = nc + (DC[k] as number);
            const kr = nr + (DR[k] as number);
            if (kc < 0 || kr < 0 || kc >= cols || kr >= rows || blocked[kr * cols + kc] === 1) {
              step += NEAR_COST;
              break;
            }
          }
          const cost = (g[state] as number) + step;
          if (seen[next] !== generation || cost < (g[next] as number)) {
            seen[next] = generation;
            g[next] = cost;
            parent[next] = state;
            heap.push(cost + heuristic(nIdx), next);
          }
        }
      }
      return null;
    },
  };
}

function union(rects: readonly Rect[], pad: number): Rect {
  const left = Math.min(...rects.map((r) => r.x)) - pad;
  const top = Math.min(...rects.map((r) => r.y)) - pad;
  const right = Math.max(...rects.map((r) => r.x + r.w)) + pad;
  const bottom = Math.max(...rects.map((r) => r.y + r.h)) + pad;
  return { x: left, y: top, w: right - left, h: bottom - top };
}

const OUTWARD: Record<DoorBox["side"], Point> = { n: { x: 0, y: -1 }, e: { x: 1, y: 0 }, s: { x: 0, y: 1 }, w: { x: -1, y: 0 } };
/** Cells one layout may expand in all its door routes (and, separately, all its corridor routes); the rest stay straight. */
const ROUTE_BUDGET = 400_000;
/** How far outside its wall a route leaves a door. */
const LEAVE = 12;

export interface RouteContext {
  rooms: readonly RoomBox[];
  grouped: readonly GroupedRoomBox[];
  wings: readonly WingBox[];
  /** Height of the title plate at the top of an expanded wing, from the wing's own top edge. */
  plate: number;
}

/**
 * Replace the arrow of every door that would cross a room or a plate, or that leaves its wing, by a routed path.
 * An arrow that already runs clear inside one wing stays the straight stub it was. A door whose route cannot be
 * found keeps its straight arrow.
 */
export function routeDoors(doors: readonly DoorBox[], ctx: RouteContext): DoorBox[] {
  if (doors.length === 0) return [...doors];
  const roomById = new Map(ctx.rooms.map((r) => [r.id, r] as const));
  const solid: Rect[] = [
    ...ctx.rooms,
    ...ctx.grouped,
    ...ctx.wings.filter((w) => !w.expanded),
    ...ctx.wings.filter((w) => w.expanded).map((w) => ({ x: w.x, y: w.y, w: w.w, h: ctx.plate })),
  ];
  const bounds = union([...ctx.wings, ...doors], 48);
  const router = createRouter(bounds, solid, { cell: 6, margin: 3, budget: ROUTE_BUDGET });
  return doors.map((door) => {
    if (door.from === door.to) return door;
    const from = roomById.get(door.from);
    const target = roomById.get(door.to);
    if (from === undefined || target === undefined) return door;
    const a = door.arrow[0] as Point;
    const b = door.arrow[door.arrow.length - 1] as Point;
    const crossing = solid.some((rect) => rect !== from && rect !== target && segmentHitsRect(a, b, rect));
    if (from.wing === target.wing && !crossing) return door;
    const out = OUTWARD[door.side];
    const leave: Point = { x: a.x + out.x * LEAVE, y: a.y + out.y * LEAVE };
    const path = router.route(leave, target);
    if (path === null) return door;
    return { ...door, arrow: [a, ...path] };
  });
}

/** Route the wing-to-wing corridors around every wing that is not one of their two ends; the passage is `route`, and `path` stays the straight line between the two wings. */
export function routeCorridors(corridors: readonly CorridorBox[], wings: readonly WingBox[]): CorridorBox[] {
  if (corridors.length === 0 || wings.length === 0) return [...corridors];
  const byName = new Map(wings.map((w) => [w.wing, w] as const));
  const bounds = union(wings, 64);
  const router = createRouter(bounds, wings, { cell: 8, margin: 8, budget: ROUTE_BUDGET });
  return corridors.map((corridor) => {
    const a = byName.get(corridor.fromWing);
    const b = byName.get(corridor.toWing);
    const start = corridor.path[0];
    if (a === undefined || b === undefined || start === undefined) return corridor;
    const out: Point =
      start.x <= a.x ? { x: -1, y: 0 } : start.x >= a.x + a.w ? { x: 1, y: 0 } : start.y <= a.y ? { x: 0, y: -1 } : { x: 0, y: 1 };
    const leave: Point = { x: start.x + out.x * LEAVE, y: start.y + out.y * LEAVE };
    const path = router.route(leave, b);
    return path === null ? corridor : { ...corridor, route: [start, ...path] };
  });
}
