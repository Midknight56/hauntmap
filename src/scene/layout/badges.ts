import type { CorridorBox, DoorBox, GroupedRoomBox, Point, Rect, RoomBox, SealedBox, WingBox } from "./types";

// Where the import-count label of each corridor sits. The label is a 72 x 20 pill. Putting it at the
// middle of the corridor drew it over rooms and over other labels, so each label takes the position
// along its corridor (or just beside it) that overlaps the least. Pure and deterministic.

export const BADGE_W = 72;
export const BADGE_H = 20;
/** The wing name fills the top strip of an expanded wing and the whole box of a collapsed one. */
const NAME_STRIP = 28;
const MARGIN = 2;
const STEPS = 49;
const SHIFTS = [0, -(BADGE_H + 4), BADGE_H + 4, -2 * (BADGE_H + 4), 2 * (BADGE_H + 4)];

// Costs: an overlap with another label is the worst, then with something solid, then with a wing name.
const COST_BADGE = 1000;
const COST_SOLID = 100;
const COST_NAME = 10;

export interface BadgeObstacles {
  rooms: readonly RoomBox[];
  grouped: readonly GroupedRoomBox[];
  doors: readonly DoorBox[];
  sealed: readonly SealedBox[];
  wings: readonly WingBox[];
}

function hits(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w + MARGIN && b.x - MARGIN < a.x + a.w && a.y < b.y + b.h + MARGIN && b.y - MARGIN < a.y + a.h;
}

function pointAt(path: readonly Point[], t: number): Point {
  const first = path[0] as Point;
  const last = path[path.length - 1] as Point;
  return { x: first.x + (last.x - first.x) * t, y: first.y + (last.y - first.y) * t };
}

/** One position (the center of the pill) for each corridor, in the order given. */
export function placeBadges(corridors: readonly Pick<CorridorBox, "path">[], obstacles: BadgeObstacles): Point[] {
  const solid: Rect[] = [...obstacles.rooms, ...obstacles.grouped, ...obstacles.doors, ...obstacles.sealed];
  const names: Rect[] = obstacles.wings.map((w) => (w.expanded ? { x: w.x, y: w.y, w: w.w, h: NAME_STRIP } : w));
  const placed: Rect[] = [];
  return corridors.map((corridor) => {
    if (corridor.path.length < 2) return corridor.path[0] ?? { x: 0, y: 0 };
    let best: { at: Point; cost: number } | null = null;
    for (let i = 0; i < STEPS; i++) {
      const t = (i + 1) / (STEPS + 1);
      for (const shift of SHIFTS) {
        const base = pointAt(corridor.path, t);
        const at = { x: base.x, y: base.y + shift };
        const rect = { x: at.x - BADGE_W / 2, y: at.y - BADGE_H / 2, w: BADGE_W, h: BADGE_H };
        let cost = Math.abs(t - 0.5) + Math.abs(shift) / 100;
        for (const other of placed) if (hits(rect, other)) cost += COST_BADGE;
        for (const other of solid) if (hits(rect, other)) cost += COST_SOLID;
        for (const other of names) if (hits(rect, other)) cost += COST_NAME;
        if (best === null || cost < best.cost - 1e-9) best = { at, cost };
      }
    }
    const at = (best as { at: Point }).at;
    placed.push({ x: at.x - BADGE_W / 2, y: at.y - BADGE_H / 2, w: BADGE_W, h: BADGE_H });
    return at;
  });
}
