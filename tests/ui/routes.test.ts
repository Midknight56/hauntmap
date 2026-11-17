import { describe, expect, it } from "vitest";
import { manorInvestigation } from "./manorFixture";
import { layoutOf, requestFor } from "./layoutRequests";
import { createRouter, segmentHitsRect } from "../../src/scene/layout/routes";
import type { LayoutResult, Point, Rect } from "../../src/scene/layout/types";

// Item 6b: door arrows and corridors between wings are routed passages that do not cross rooms.

describe("segmentHitsRect", () => {
  const rect: Rect = { x: 10, y: 10, w: 20, h: 20 };
  it("is true when a segment passes through the inside and false when it only touches or misses", () => {
    expect(segmentHitsRect({ x: 0, y: 20 }, { x: 40, y: 20 }, rect)).toBe(true);
    expect(segmentHitsRect({ x: 0, y: 5 }, { x: 40, y: 5 }, rect)).toBe(false);
    expect(segmentHitsRect({ x: 0, y: 10 }, { x: 40, y: 10 }, rect)).toBe(false);
    expect(segmentHitsRect({ x: 20, y: 0 }, { x: 20, y: 10 }, rect)).toBe(false);
    expect(segmentHitsRect({ x: 20, y: 0 }, { x: 20, y: 12 }, rect)).toBe(true);
  });
});

describe("the router", () => {
  it("goes around a block that stands between the start and the goal", () => {
    const wall: Rect = { x: 100, y: 0, w: 20, h: 200 };
    const router = createRouter({ x: -40, y: -40, w: 280, h: 280 }, [wall], { cell: 6, margin: 3 });
    const goal: Rect = { x: 160, y: 90, w: 40, h: 20 };
    const path = router.route({ x: 40, y: 100 }, goal) as Point[];
    expect(path).not.toBeNull();
    expect(path[0]).toEqual({ x: 40, y: 100 });
    for (let i = 1; i < path.length; i++) expect(segmentHitsRect(path[i - 1] as Point, path[i] as Point, wall)).toBe(false);
    const end = path[path.length - 1] as Point;
    const dx = Math.max(goal.x - end.x, 0, end.x - (goal.x + goal.w));
    const dy = Math.max(goal.y - end.y, 0, end.y - (goal.y + goal.h));
    expect(Math.hypot(dx, dy)).toBeLessThan(0.51);
  });

  it("returns null when the goal is walled in", () => {
    const blocks: Rect[] = [
      { x: 80, y: 80, w: 100, h: 10 },
      { x: 80, y: 160, w: 100, h: 10 },
      { x: 80, y: 80, w: 10, h: 90 },
      { x: 170, y: 80, w: 10, h: 90 },
    ];
    const router = createRouter({ x: 0, y: 0, w: 260, h: 260 }, blocks, { cell: 6, margin: 3 });
    expect(router.route({ x: 10, y: 10 }, { x: 120, y: 115, w: 10, h: 10 })).toBeNull();
  });
});

function segments(path: readonly Point[]): [Point, Point][] {
  return path.slice(1).map((p, i) => [path[i] as Point, p]);
}

function nearestBoundaryGap(p: Point, r: Rect): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h));
  if (dx === 0 && dy === 0) return Math.min(p.x - r.x, r.x + r.w - p.x, p.y - r.y, r.y + r.h - p.y);
  return Math.hypot(dx, dy);
}

async function manor(expanded: readonly string[] | "all"): Promise<LayoutResult> {
  return layoutOf(requestFor(await manorInvestigation(), expanded));
}

describe("routed door arrows on the manor", () => {
  for (const [name, expanded] of [
    ["every wing expanded", "all"],
    ["src/orders expanded", ["src/orders"]],
    ["orders, notifications and payments expanded", ["src/orders", "src/notifications", "src/payments"]],
  ] as const) {
    it(`no arrow crosses a room (${name})`, async () => {
      const layout = await manor(expanded);
      const rooms = new Map(layout.rooms.map((r) => [r.id, r] as const));
      expect(layout.doors.length).toBeGreaterThan(0);
      const offenders: string[] = [];
      for (const door of layout.doors) {
        for (const [a, b] of segments(door.arrow)) {
          for (const room of layout.rooms) {
            if (room.id === door.from || room.id === door.to) continue;
            if (segmentHitsRect(a, b, room)) offenders.push(`${door.relationId} crosses ${room.id}`);
          }
          for (const g of layout.grouped) if (segmentHitsRect(a, b, g)) offenders.push(`${door.relationId} crosses the grouped room of ${g.wing}`);
        }
        const target = rooms.get(door.to) as Rect;
        const start = door.arrow[0] as Point;
        expect(start, "an arrow starts at its door").toEqual({ x: door.x + door.w / 2, y: door.y + door.h / 2 });
        if (door.from !== door.to) expect(nearestBoundaryGap(door.arrow[door.arrow.length - 1] as Point, target), `${door.relationId} ends on its target room`).toBeLessThan(1);
      }
      expect(offenders).toEqual([]);
    });
  }

  it("routes a door between two wings through the gaps: its path has bends and is longer than the straight line only by a detour", async () => {
    const layout = await manor("all");
    const wingOf = new Map(layout.rooms.map((r) => [r.id, r.wing] as const));
    const cross = layout.doors.filter((d) => wingOf.get(d.from) !== wingOf.get(d.to));
    expect(cross.length).toBeGreaterThan(5);
    for (const door of cross) {
      for (const [a, b] of segments(door.arrow)) {
        // Passages run along the grid: horizontal or vertical, except the short stub that meets the target room.
        const straight = a.x === b.x || a.y === b.y;
        const stub = Math.hypot(a.x - b.x, a.y - b.y) <= 14;
        expect(straight || stub, `${door.relationId}: ${JSON.stringify([a, b])}`).toBe(true);
      }
    }
  });

  it("is deterministic", async () => {
    expect(await manor("all")).toEqual(await manor("all"));
  });
});

describe("routed corridors between wings on the manor", () => {
  it("no corridor crosses a wing other than its two ends", async () => {
    const layout = await manor(["src/orders"]);
    expect(layout.corridors.length).toBeGreaterThan(3);
    expect(layout.corridors.every((c) => c.route !== undefined && c.route.length >= 2)).toBe(true);
    const offenders: string[] = [];
    for (const corridor of layout.corridors) {
      for (const [a, b] of segments(corridor.route ?? corridor.path)) {
        for (const wing of layout.wings) {
          if (wing.wing === corridor.fromWing || wing.wing === corridor.toWing) continue;
          if (segmentHitsRect(a, b, wing)) offenders.push(`${corridor.fromWing} to ${corridor.toWing} crosses ${wing.wing}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
