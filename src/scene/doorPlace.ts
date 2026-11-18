import type { DoorBox, LayoutResult, Rect } from "./layout/types";

// Where the scene draws a door. The layout puts a door on the wall of its room (the port of ring 0), so that half of a door that is now
// 16 to 20 px wide would sit inside the room, on its name. The scene draws such a door just outside the wall instead. The ghost, the hit
// target and every label read the drawn layout, so they follow the door. Pure; the layout it is given is never changed.

/**
 * How far, in scene units, a door on the wall is moved: out of its room by a little more than half of a door at the first view (11 units),
 * and, on the east and west sides, down by 9 units, below the name and its plate at the top of the room. The plate of a loop room reaches 12
 * units past each side wall, and its bottom is 28 units under the top of the room, so a door at the middle of a side would touch it. The north
 * door moves a little farther up, because the plate also reaches above the room.
 */
export const DOOR_SHIFT = {
  n: { x: 0, y: -14 },
  e: { x: 12, y: 9 },
  s: { x: 0, y: 12 },
  w: { x: -12, y: 9 },
} as const;

/** How far outside the wall of `room` the center of a door on `side` lies (negative inside the room). */
function outside(room: Rect, side: DoorBox["side"], cx: number, cy: number): number {
  switch (side) {
    case "n":
      return room.y - cy;
    case "s":
      return cy - (room.y + room.h);
    case "e":
      return cx - (room.x + room.w);
    default:
      return room.x - cx;
  }
}

/** The layout with every door that stands on the wall of its room moved by `DOOR_SHIFT`, together with its hit target. */
export function presentDoors(layout: LayoutResult): LayoutResult {
  const rooms = new Map(layout.rooms.map((r) => [r.id, r] as const));
  let changed = false;
  const doors = layout.doors.map((door) => {
    const room = rooms.get(door.from);
    if (room === undefined) return door;
    // Only a door on the wall moves; a door on a farther ring already stands outside it.
    if (Math.abs(outside(room, door.side, door.x + door.w / 2, door.y + door.h / 2)) > 1) return door;
    changed = true;
    const { x: dx, y: dy } = DOOR_SHIFT[door.side];
    return { ...door, x: door.x + dx, y: door.y + dy, hit: { ...door.hit, x: door.hit.x + dx, y: door.hit.y + dy } };
  });
  return changed ? { ...layout, doors } : layout;
}