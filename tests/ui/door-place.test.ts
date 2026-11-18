import { describe, expect, it } from "vitest";
import { doorGrow } from "../../src/scene/doorLook";
import { DOOR_SHIFT, presentDoors } from "../../src/scene/doorPlace";
import type { DoorBox, LayoutResult, Rect } from "../../src/scene/layout/types";
import { intersects, layoutOf, requestFor } from "./layoutRequests";
import { manorInvestigation } from "./manorFixture";

// Door pass: the layout puts a door on the wall of its room, so that half of a bigger door would sit inside the room, on the name.
// The scene draws it just outside the wall instead (and the ghost, the hit target and the labels follow the drawn door). Pure.

const room: Rect = { x: 100, y: 100, w: 96, h: 64 };
const door = (side: DoorBox["side"], cx: number, cy: number, extra: Partial<DoorBox> = {}): DoorBox => ({
  x: cx - 8,
  y: cy - 8,
  w: 16,
  h: 16,
  relationId: `${side}${cx}${cy}`,
  from: "a",
  to: "b",
  side,
  arrow: [
    { x: cx, y: cy },
    { x: cx + 40, y: cy },
  ],
  hit: { x: cx - 12, y: cy - 12, w: 24, h: 24 },
  ...extra,
});
const layoutWith = (doors: DoorBox[]): LayoutResult =>
  ({ layoutVersion: 1, layoutKey: "k", engine: { name: "dagre", version: "0" }, wings: [], rooms: [{ ...room, id: "a", wing: "w", label: "a.ts" }], grouped: [], doors, sealed: [], corridors: [], bounds: room, stats: { ms: 0, nodeCount: 0, edgeCount: 0 } }) as LayoutResult;

describe("presenting the doors", () => {
  it("moves a door that sits on the wall straight out of its room, by its side", () => {
    const out = presentDoors(layoutWith([door("n", 148, 100), door("s", 148, 164), door("e", 196, 132), door("w", 100, 132)])).doors;
    const center = (d: DoorBox): { x: number; y: number } => ({ x: d.x + d.w / 2, y: d.y + d.h / 2 });
    expect(center(out[0] as DoorBox)).toEqual({ x: 148 + DOOR_SHIFT.n.x, y: 100 + DOOR_SHIFT.n.y });
    expect(center(out[1] as DoorBox)).toEqual({ x: 148 + DOOR_SHIFT.s.x, y: 164 + DOOR_SHIFT.s.y });
    expect(center(out[2] as DoorBox)).toEqual({ x: 196 + DOOR_SHIFT.e.x, y: 132 + DOOR_SHIFT.e.y });
    expect(center(out[3] as DoorBox)).toEqual({ x: 100 + DOOR_SHIFT.w.x, y: 132 + DOOR_SHIFT.w.y });
    // North goes up and out of the room, south down, east right and west left; the east and west doors also drop below the name at the top of the room.
    expect(DOOR_SHIFT.n.y).toBeLessThan(0);
    expect(DOOR_SHIFT.s.y).toBeGreaterThan(0);
    expect(DOOR_SHIFT.e.x).toBeGreaterThan(0);
    expect(DOOR_SHIFT.w.x).toBeLessThan(0);
    expect(DOOR_SHIFT.e.y).toBeGreaterThan(0);
    expect(DOOR_SHIFT.w.y).toBeGreaterThan(0);
  });

  it("moves the hit target with the door and keeps the size of both", () => {
    const [moved] = presentDoors(layoutWith([door("e", 196, 132)])).doors as [DoorBox];
    expect(moved.hit).toEqual({ x: 196 + DOOR_SHIFT.e.x - 12, y: 120 + DOOR_SHIFT.e.y, w: 24, h: 24 });
    expect([moved.w, moved.h]).toEqual([16, 16]);
  });

  it("leaves a door that already stands outside the wall (a farther ring), the rest of the layout and the input alone", () => {
    const far = door("e", 196 + 24, 132);
    const input = layoutWith([far]);
    const before = JSON.stringify(input);
    const out = presentDoors(input);
    expect(out.doors[0]).toEqual(far);
    expect(out.rooms).toBe(input.rooms);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("keeps a door that was moved on the wall of its own side: the east and west doors stay between the top and the bottom of the room", () => {
    for (const d of presentDoors(layoutWith([door("e", 196, 132), door("w", 100, 132)])).doors) {
      const cy = d.y + d.h / 2;
      expect(cy - 8).toBeGreaterThanOrEqual(room.y);
      expect(cy + 8).toBeLessThanOrEqual(room.y + room.h);
    }
  });

  it("leaves a door whose room is not drawn where it is", () => {
    const lost = door("n", 148, 100, { from: "nowhere" });
    expect(presentDoors(layoutWith([lost])).doors[0]).toEqual(lost);
  });

  it("keeps a first view door (grown to about 18 px at the zoom of the first view) out of its room on every side", () => {
    const grow = doorGrow(0.82);
    const half = (16 * grow) / 2;
    for (const d of presentDoors(layoutWith([door("n", 148, 100), door("s", 148, 164), door("e", 196, 132), door("w", 100, 132)])).doors) {
      const cx = d.x + d.w / 2;
      const cy = d.y + d.h / 2;
      expect(intersects({ x: cx - half, y: cy - half, w: half * 2, h: half * 2 }, room), `${d.side} door`).toBe(false);
    }
  });
});

describe("the doors of the manor, presented", () => {
  it("leave no door box of the first view inside a room", async () => {
    const layout = await layoutOf(requestFor(await manorInvestigation(), "all"));
    const half = (16 * doorGrow(0.82)) / 2;
    expect(layout.doors.length).toBeGreaterThan(10);
    const rooms = new Map(layout.rooms.map((r) => [r.id, r]));
    for (const d of presentDoors(layout).doors) {
      const from = rooms.get(d.from);
      if (from === undefined) continue;
      const cx = d.x + d.w / 2;
      const cy = d.y + d.h / 2;
      expect(intersects({ x: cx - half, y: cy - half, w: half * 2, h: half * 2 }, from), `${d.relationId} against its room`).toBe(false);
    }
  });
});