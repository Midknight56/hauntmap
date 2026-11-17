import type { LayoutResult, Rect } from "../scene/layout/types";

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