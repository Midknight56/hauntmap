import type { LayoutResult, Point, Rect } from "../scene/layout/types";
import type { AmbientLoop } from "../scene/types";

/** A map narrower than this (a phone) first shows the open wings, not the whole manor. */
export const COMPACT_WIDTH = 520;

/**
 * The rectangle the first view of an investigation fits. On a wide map it is every wing. On a narrow one the whole layout
 * would need a zoom under the floor of the camera, so it is the box around the wings that are open (the wings of the loop on
 * the first screen), or every wing when none is open.
 */
export function firstFitBounds(layout: Pick<LayoutResult, "bounds" | "wings">, mapWidth: number): Rect {
  if (mapWidth >= COMPACT_WIDTH) return layout.bounds;
  const open = layout.wings.filter((w) => w.expanded);
  if (open.length === 0) return layout.bounds;
  const x0 = Math.min(...open.map((w) => w.x));
  const y0 = Math.min(...open.map((w) => w.y));
  const x1 = Math.max(...open.map((w) => w.x + w.w));
  const y1 = Math.max(...open.map((w) => w.y + w.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
export interface FirstViewPlan {
  /** What the first view frames, in scene units. */
  rects: Rect[];
  /** True when the rects are the loop's own path (a phone), not whole wings. */
  compact: boolean;
}

/** The thin rectangles that bound each segment of a polyline. */
function segmentRects(points: readonly Point[]): Rect[] {
  const out: Rect[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Point;
    const b = points[i] as Point;
    out.push({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
  }
  return out;
}

/**
 * What the first view of an investigation frames. With a dependency loop, a wide map frames the wings that hold the loop's
 * rooms, and a phone frames the loop's rooms, its doors and the corridors between its wings (the other wings may be cut at the
 * edges). Without a loop it is the old first fit.
 */
export function firstViewPlan(
  layout: Pick<LayoutResult, "bounds" | "wings" | "rooms" | "doors" | "corridors">,
  loops: readonly Pick<AmbientLoop, "modules" | "relationIds">[],
  mapWidth: number,
): FirstViewPlan {
  const modules = new Set(loops.flatMap((l) => [...l.modules]));
  const relations = new Set(loops.flatMap((l) => [...l.relationIds]));
  const rooms = layout.rooms.filter((r) => modules.has(r.id));
  if (rooms.length === 0) return { rects: [firstFitBounds(layout, mapWidth)], compact: false };
  const wingNames = new Set(rooms.map((r) => r.wing));
  if (mapWidth >= COMPACT_WIDTH) {
    return { rects: layout.wings.filter((w) => wingNames.has(w.wing)).map((w) => ({ x: w.x, y: w.y, w: w.w, h: w.h })), compact: false };
  }
  const rects: Rect[] = rooms.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h }));
  for (const door of layout.doors) {
    if (!relations.has(door.relationId)) continue;
    rects.push({ x: door.x, y: door.y, w: door.w, h: door.h }, ...segmentRects(door.arrow));
  }
  for (const corridor of layout.corridors) {
    if (wingNames.has(corridor.fromWing) && wingNames.has(corridor.toWing) && corridor.fromWing !== corridor.toWing) rects.push(...segmentRects(corridor.route ?? corridor.path));
  }
  return { rects, compact: true };
}