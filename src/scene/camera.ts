import type { Camera, Point, Rect } from "./layout/types";

// Pure camera math. (x, y) is the scene-unit point at the viewport center; screen points are CSS pixels
// relative to the viewport's top-left corner.

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;
/**
 * The lowest zoom of the first view on a phone, and of nothing else. A 328 px map shows the whole loop of the manor (about 1,200
 * units with the name plates of its three rooms) only under the 0.25 floor. The zoom buttons, the wheel and the keys keep 0.25.
 */
export const FIRST_VIEW_MIN_ZOOM = 0.15;

export interface Viewport {
  width: number;
  height: number;
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function toScreen(camera: Camera, viewport: Viewport, point: Point): Point {
  return {
    x: (point.x - camera.x) * camera.zoom + viewport.width / 2,
    y: (point.y - camera.y) * camera.zoom + viewport.height / 2,
  };
}

export function toScene(camera: Camera, viewport: Viewport, point: Point): Point {
  return {
    x: (point.x - viewport.width / 2) / camera.zoom + camera.x,
    y: (point.y - viewport.height / 2) / camera.zoom + camera.y,
  };
}

/** Move the view by screen pixels: a positive `dx` shows what lies to the right. */
export function panBy(camera: Camera, dx: number, dy: number): Camera {
  return { x: camera.x + dx / camera.zoom, y: camera.y + dy / camera.zoom, zoom: camera.zoom };
}

/** Zoom by `factor` keeping the scene point under `pointer` where it is; unchanged when the zoom is clamped. */
export function zoomAround(camera: Camera, viewport: Viewport, factor: number, pointer: Point): Camera {
  const zoom = clampZoom(camera.zoom * factor);
  if (zoom === camera.zoom) return { ...camera };
  const anchor = toScene(camera, viewport, pointer);
  return {
    x: anchor.x - (pointer.x - viewport.width / 2) / zoom,
    y: anchor.y - (pointer.y - viewport.height / 2) / zoom,
    zoom,
  };
}

/** Center `bounds` and choose the largest zoom that leaves `padding` screen pixels on every side. */
export function fitBounds(bounds: Rect, viewport: Viewport, padding: number): Camera {
  const availableW = Math.max(1, viewport.width - 2 * padding);
  const availableH = Math.max(1, viewport.height - 2 * padding);
  const zoom = clampZoom(Math.min(availableW / Math.max(bounds.w, 1e-9), availableH / Math.max(bounds.h, 1e-9)));
  return { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2, zoom };
}