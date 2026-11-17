import type { Camera, Rect } from "./layout/types";
import type { Viewport } from "./camera";

/** A room entirely outside the viewport plus this many screen pixels is not drawn. */
export const CULL_MARGIN = 100;

/** IDs (in input order) of the rooms that intersect the viewport extended by `margin` screen pixels. */
export function visibleRoomIds(rooms: readonly (Rect & { id: string })[], camera: Camera, viewport: Viewport, margin: number = CULL_MARGIN): string[] {
  const halfW = viewport.width / 2 / camera.zoom + margin / camera.zoom;
  const halfH = viewport.height / 2 / camera.zoom + margin / camera.zoom;
  const left = camera.x - halfW;
  const right = camera.x + halfW;
  const top = camera.y - halfH;
  const bottom = camera.y + halfH;
  const ids: string[] = [];
  for (const room of rooms) {
    if (room.x + room.w >= left && room.x <= right && room.y + room.h >= top && room.y <= bottom) ids.push(room.id);
  }
  return ids;
}