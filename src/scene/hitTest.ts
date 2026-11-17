import type { LayoutResult, Point } from "./layout/types";
import type { HitKind, HitTarget } from "./types";

// Pure hit testing from the layout, independent of the drawn art. Priority: door, sealed doorway,
// grouped room, room, wing.

const RANK: Record<HitKind, number> = { door: 0, sealed: 1, grouped: 2, room: 3, wing: 4 };

export function buildHitTargets(layout: LayoutResult): HitTarget[] {
  const targets: HitTarget[] = [];
  for (const d of layout.doors) targets.push({ kind: "door", id: d.relationId, rect: { ...d.hit } });
  for (const s of layout.sealed) targets.push({ kind: "sealed", id: s.relationId, rect: { ...s.hit } });
  for (const g of layout.grouped) targets.push({ kind: "grouped", id: g.wing, rect: { x: g.x, y: g.y, w: g.w, h: g.h } });
  for (const r of layout.rooms) targets.push({ kind: "room", id: r.id, rect: { x: r.x, y: r.y, w: r.w, h: r.h } });
  for (const w of layout.wings) targets.push({ kind: "wing", id: w.wing, rect: { x: w.x, y: w.y, w: w.w, h: w.h } });
  return targets;
}

/** The target of the best priority that contains the point (rectangles are half-open), or null. */
export function hitTest(targets: readonly HitTarget[], point: Point): HitTarget | null {
  let best: HitTarget | null = null;
  for (const t of targets) {
    const r = t.rect;
    if (point.x < r.x || point.x >= r.x + r.w || point.y < r.y || point.y >= r.y + r.h) continue;
    if (best === null || RANK[t.kind] < RANK[best.kind]) best = t;
  }
  return best;
}