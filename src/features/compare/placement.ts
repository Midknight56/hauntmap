import { placeDoors } from "../../scene/layout/doorsPlacement";
import type { DoorPlacement } from "./unionLayout";

/**
 * The door and sealed-doorway placement of the fleet's layout (`placeDoors` of
 * `src/scene/layout/doorsPlacement.ts`) behind the signature `extendLayout` takes. Only room
 * rectangles enter, so the placement stays the one rule of the map.
 */
export const place: DoorPlacement = (rooms, relations, boundaries) =>
  placeDoors({
    rooms: new Map(rooms.map((r) => [r.id, { x: r.x, y: r.y, w: r.w, h: r.h }] as const)),
    relations,
    boundaries,
  });
