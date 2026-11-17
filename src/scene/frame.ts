import { MAX_ZOOM, MIN_ZOOM, type Viewport } from "./camera";
import type { Camera, Point, Rect } from "./layout/types";

// A camera that frames a set of rectangles inside the part of the map that nothing covers. Pure.

export interface FrameOptions {
  /** Screen pixels kept free on every side of the map. */
  padding: number;
  /** Defaults to the camera ceiling. */
  maxZoom?: number;
  /** Defaults to the camera floor; the first view on a phone passes a lower one (see `FIRST_VIEW_MIN_ZOOM`). */
  minZoom?: number;
  /** Screen rectangles (relative to the map's top left corner) that lie over the map: the zoom stack and the minimap. */
  obstacles?: readonly Rect[];
}

/** Screen pixels between framed content and an obstacle. */
const OBSTACLE_GAP = 8;

function union(rects: readonly Rect[]): Rect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function hits(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function intersect(a: Rect, b: Rect): Rect {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The four halves of `area` that lie clear of `obstacle` (grown by the gap). */
function cuts(area: Rect, obstacle: Rect): Rect[] {
  const o = { x: obstacle.x - OBSTACLE_GAP, y: obstacle.y - OBSTACLE_GAP, w: obstacle.w + 2 * OBSTACLE_GAP, h: obstacle.h + 2 * OBSTACLE_GAP };
  return [
    intersect(area, { x: area.x, y: area.y, w: area.w, h: o.y - area.y }),
    intersect(area, { x: area.x, y: o.y + o.h, w: area.w, h: area.y + area.h - (o.y + o.h) }),
    intersect(area, { x: area.x, y: area.y, w: o.x - area.x, h: area.h }),
    intersect(area, { x: o.x + o.w, y: area.y, w: area.x + area.w - (o.x + o.w), h: area.h }),
  ].filter((r) => r.w > 1 && r.h > 1);
}

/**
 * Center `rects` and choose the largest zoom that keeps them all inside the viewport, `padding` pixels from its edges and
 * clear of every obstacle. The candidate areas are the whole padded viewport and the parts of it that lie to one side of an
 * obstacle; a candidate is valid when the content, placed in it, touches no obstacle. The valid candidate with the largest
 * zoom wins, and with no obstacle in the way that is the whole viewport (the same camera as `fitBounds`).
 */
export function frameRects(rects: readonly Rect[], viewport: Viewport, opts: FrameOptions): Camera {
  const minZoom = opts.minZoom ?? MIN_ZOOM;
  const maxZoom = opts.maxZoom ?? MAX_ZOOM;
  const obstacles = opts.obstacles ?? [];
  const box = union(rects);
  const full: Rect = { x: opts.padding, y: opts.padding, w: Math.max(1, viewport.width - 2 * opts.padding), h: Math.max(1, viewport.height - 2 * opts.padding) };

  let areas: Rect[] = [full];
  const single = obstacles.flatMap((o) => cuts(full, o));
  areas.push(...single);
  // A cut for each of two obstacles at once (above the zoom stack and left of the minimap, for instance).
  for (let i = 0; i < obstacles.length; i++) {
    for (let j = i + 1; j < obstacles.length; j++) {
      for (const a of cuts(full, obstacles[i] as Rect)) {
        for (const b of cuts(a, obstacles[j] as Rect)) areas.push(b);
      }
    }
  }
  areas = areas.filter((a) => a.w > 1 && a.h > 1);

  let best: { camera: Camera; valid: boolean; area: number } | null = null;
  for (const area of areas) {
    const fit = Math.min(area.w / Math.max(box.w, 1e-9), area.h / Math.max(box.h, 1e-9));
    const zoom = Math.min(maxZoom, Math.max(minZoom, fit));
    const center = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
    // The content center lands on the area center.
    const camera: Camera = {
      x: center.x - (area.x + area.w / 2 - viewport.width / 2) / zoom,
      y: center.y - (area.y + area.h / 2 - viewport.height / 2) / zoom,
      zoom,
    };
    const placed = rects.map((r) => ({
      x: (r.x - camera.x) * zoom + viewport.width / 2,
      y: (r.y - camera.y) * zoom + viewport.height / 2,
      w: r.w * zoom,
      h: r.h * zoom,
    }));
    const inside = placed.every((p) => p.x >= opts.padding - 1e-6 && p.y >= opts.padding - 1e-6 && p.x + p.w <= viewport.width - opts.padding + 1e-6 && p.y + p.h <= viewport.height - opts.padding + 1e-6);
    const clear = placed.every((p) => obstacles.every((o) => !hits(p, o)));
    const valid = inside && clear;
    const better =
      best === null ||
      (valid && !best.valid) ||
      (valid === best.valid && (camera.zoom > best.camera.zoom + 1e-9 || (Math.abs(camera.zoom - best.camera.zoom) <= 1e-9 && area.w * area.h > best.area)));
    if (better) best = { camera, valid, area: area.w * area.h };
  }
  return (best as { camera: Camera }).camera;
}

/**
 * Keep `center` at the middle of the map and choose the largest zoom (at most `maxZoom`) at which every rectangle lies inside
 * the viewport, `padding` pixels from its edges, and clear of every obstacle. The rectangles close in on the center as the zoom
 * falls, so the test is monotone and a bisection finds the zoom. At `minZoom` the camera is returned even when a rule still fails.
 */
export function frameAround(center: Point, rects: readonly Rect[], viewport: Viewport, opts: FrameOptions): Camera {
  const minZoom = opts.minZoom ?? MIN_ZOOM;
  const maxZoom = opts.maxZoom ?? MAX_ZOOM;
  const obstacles = opts.obstacles ?? [];
  const ok = (zoom: number): boolean =>
    rects.every((r) => {
      const p = { x: (r.x - center.x) * zoom + viewport.width / 2, y: (r.y - center.y) * zoom + viewport.height / 2, w: r.w * zoom, h: r.h * zoom };
      const inside = p.x >= opts.padding - 1e-6 && p.y >= opts.padding - 1e-6 && p.x + p.w <= viewport.width - opts.padding + 1e-6 && p.y + p.h <= viewport.height - opts.padding + 1e-6;
      return inside && obstacles.every((o) => !hits(p, o));
    });
  if (ok(maxZoom)) return { x: center.x, y: center.y, zoom: maxZoom };
  let lo = minZoom;
  let hi = maxZoom;
  if (!ok(lo)) return { x: center.x, y: center.y, zoom: lo };
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return { x: center.x, y: center.y, zoom: lo };
}