import type { DoorBox, Point, Rect, SealedBox } from "./types";

// Placement of doors and sealed doorways on the sides of rooms. Pure: it reads rectangles and
// returns rectangles, so the rules can be tested without a scene.
//
// A room has four sides. Each side holds a few ports in a ring around the room: the north and
// south sides hold three (centers 24 units apart), the east and west sides hold one. The corner
// clearance is what keeps the 24 x 24 hit rectangles of two neighbouring sides from touching. A
// port that does not fit on its preferred side goes to the next side clockwise; when all four
// sides of a ring are full, the port moves to the next ring, 24 units further out.

export type Side = "n" | "e" | "s" | "w";

const CLOCKWISE: Side[] = ["n", "e", "s", "w"];
const CAPACITY: Record<Side, number> = { n: 3, s: 3, e: 1, w: 1 };
const SPACING = 24;
const DOOR_SIZE = 16;
const HIT_SIZE = 24;
const RING_STEP = 24;

export interface PlacementInput {
  rooms: ReadonlyMap<string, Rect>;
  relations: readonly { relationId: string; from: string; to: string }[];
  boundaries: readonly { relationId: string; from: string }[];
}

interface Item {
  kind: "door" | "sealed";
  relationId: string;
  from: string;
  to: string | null;
  preferred: Side;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function centerOf(rect: Rect): Point {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/** The side of `from` that faces the center of `to`: the larger vector component decides, a tie goes to the horizontal. */
export function sideFacing(from: Rect, to: Rect): Side {
  const a = centerOf(from);
  const b = centerOf(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return "n";
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "e" : "w";
  return dy >= 0 ? "s" : "n";
}

function outward(side: Side): Point {
  return side === "n" ? { x: 0, y: -1 } : side === "s" ? { x: 0, y: 1 } : side === "e" ? { x: 1, y: 0 } : { x: -1, y: 0 };
}

function clampTo(point: Point, rect: Rect): Point {
  return {
    x: Math.min(Math.max(point.x, rect.x), rect.x + rect.w),
    y: Math.min(Math.max(point.y, rect.y), rect.y + rect.h),
  };
}

function portCenter(room: Rect, side: Side, ring: number, offset: number): Point {
  const mid = centerOf(room);
  const push = RING_STEP * ring;
  if (side === "n") return { x: mid.x + offset, y: room.y - push };
  if (side === "s") return { x: mid.x + offset, y: room.y + room.h + push };
  if (side === "e") return { x: room.x + room.w + push, y: mid.y + offset };
  return { x: room.x - push, y: mid.y + offset };
}

function squareAt(c: Point, size: number): Rect {
  return { x: c.x - size / 2, y: c.y - size / 2, w: size, h: size };
}

/** Place every door and sealed doorway. Doors need both rooms; a sealed doorway needs its importer room. */
export function placeDoors(input: PlacementInput): { doors: DoorBox[]; sealed: SealedBox[] } {
  const perRoom = new Map<string, Item[]>();
  const add = (item: Item) => {
    const list = perRoom.get(item.from);
    if (list === undefined) perRoom.set(item.from, [item]);
    else list.push(item);
  };

  const relations = [...input.relations].sort((a, b) => compareText(a.relationId, b.relationId));
  for (const r of relations) {
    const from = input.rooms.get(r.from);
    const to = input.rooms.get(r.to);
    if (from === undefined || to === undefined) continue;
    add({ kind: "door", relationId: r.relationId, from: r.from, to: r.to, preferred: r.from === r.to ? "n" : sideFacing(from, to) });
  }
  const boundaries = [...input.boundaries].sort((a, b) => compareText(a.relationId, b.relationId));
  for (const b of boundaries) {
    if (!input.rooms.has(b.from)) continue;
    add({ kind: "sealed", relationId: b.relationId, from: b.from, to: null, preferred: "n" });
  }

  const doors: DoorBox[] = [];
  const sealed: SealedBox[] = [];

  for (const [roomId, items] of [...perRoom.entries()].sort(([a], [b]) => compareText(a, b))) {
    const room = input.rooms.get(roomId) as Rect;

    // Doors first (by preferred side, then relation ID), sealed doorways after them.
    const ordered = [...items].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "door" ? -1 : 1;
      const sa = CLOCKWISE.indexOf(a.preferred);
      const sb = CLOCKWISE.indexOf(b.preferred);
      return sa - sb || compareText(a.relationId, b.relationId);
    });

    const used = new Map<string, number>();
    const groups = new Map<string, { side: Side; ring: number; items: Item[] }>();
    for (const item of ordered) {
      const start = CLOCKWISE.indexOf(item.preferred);
      let placed = false;
      for (let ring = 0; !placed; ring++) {
        for (let step = 0; step < 4 && !placed; step++) {
          const side = CLOCKWISE[(start + step) % 4] as Side;
          const key = `${ring}:${side}`;
          const count = used.get(key) ?? 0;
          if (count >= CAPACITY[side]) continue;
          used.set(key, count + 1);
          const group = groups.get(key);
          if (group === undefined) groups.set(key, { side, ring, items: [item] });
          else group.items.push(item);
          placed = true;
        }
      }
    }

    for (const group of groups.values()) {
      const { side, ring } = group;
      // Along the side, order doors by where their target lies so that arrows do not cross; sealed doorways follow.
      const axis = (item: Item): number => {
        if (item.to === null) return Number.POSITIVE_INFINITY;
        const target = input.rooms.get(item.to) as Rect;
        const c = centerOf(target);
        return side === "n" || side === "s" ? c.x : c.y;
      };
      group.items.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "door" ? -1 : 1;
        return axis(a) - axis(b) || compareText(a.relationId, b.relationId);
      });
      const k = group.items.length;
      group.items.forEach((item, i) => {
        const offset = (i - (k - 1) / 2) * SPACING;
        const c = portCenter(room, side, ring, offset);
        const rect = squareAt(c, DOOR_SIZE);
        const hit = squareAt(c, HIT_SIZE);
        if (item.kind === "sealed") {
          sealed.push({ ...rect, relationId: item.relationId, from: item.from, hit });
          return;
        }
        const target = input.rooms.get(item.to as string) as Rect;
        const near = clampTo(c, target);
        const towards = outward(side);
        const arrowEnd: Point =
          item.to === item.from || (near.x === c.x && near.y === c.y)
            ? { x: c.x + towards.x * 16, y: c.y + towards.y * 16 }
            : near;
        doors.push({ ...rect, relationId: item.relationId, from: item.from, to: item.to as string, side, arrow: [c, arrowEnd], hit });
      });
    }
  }

  doors.sort((a, b) => compareText(a.relationId, b.relationId));
  sealed.sort((a, b) => compareText(a.relationId, b.relationId));
  return { doors, sealed };
}
