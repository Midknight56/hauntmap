import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ghostAt, pointOnPolyline, polylineLength, witnessLegs } from "../../src/scene/walk";
import { LIGHT_STEP_MS } from "../../src/scene/corridors";
import type { LayoutResult, Point, Rect } from "../../src/scene/layout/types";
import { layoutOf, requestFor } from "./layoutRequests";
import { manorInvestigation } from "./manorFixture";

// Item 4: the ghost that walks the loop door to door, in step order, one leg per traveling-light step.

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const centerOf = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

describe("polylines", () => {
  const line: Point[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ];
  it("measures a polyline and finds the point at a distance along it", () => {
    expect(polylineLength(line)).toBe(20);
    expect(pointOnPolyline(line, 0)).toEqual({ x: 0, y: 0 });
    expect(pointOnPolyline(line, 5)).toEqual({ x: 5, y: 0 });
    expect(pointOnPolyline(line, 15)).toEqual({ x: 10, y: 5 });
    expect(pointOnPolyline(line, 99)).toEqual({ x: 10, y: 10 });
  });
  it("handles one point", () => {
    expect(pointOnPolyline([{ x: 3, y: 4 }], 5)).toEqual({ x: 3, y: 4 });
    expect(polylineLength([{ x: 3, y: 4 }])).toBe(0);
  });
});

async function manorLoop(): Promise<{ layout: LayoutResult; route: { modules: string[]; relationIds: string[] } }> {
  const layout = await layoutOf(requestFor(await manorInvestigation(), ["src/orders", "src/notifications", "src/payments"]));
  const expected = JSON.parse(readFileSync(join(REPO, "public", "demo", "manor", "before", "expected.json"), "utf8")) as {
    cycles: Record<string, { witness: { modules: string[]; relationIds: string[] } }[]>;
  };
  const witness = expected.cycles["static-value"]?.[0]?.witness;
  if (witness === undefined) throw new Error("expected.json has no loop");
  return { layout, route: witness };
}

describe("the ghost on the manor loop", () => {
  it("has one leg per relation, from the door of a step to the door of the next, the last closing on the first", async () => {
    const { layout, route } = await manorLoop();
    const legs = witnessLegs(layout, route);
    expect(legs).toHaveLength(3);
    const doors = route.relationIds.map((id) => layout.doors.find((d) => d.relationId === id) as NonNullable<(typeof layout.doors)[number]>);
    legs.forEach((leg, k) => {
      expect(leg.points[0]).toEqual(centerOf(doors[k] as Rect));
      expect(leg.points[leg.points.length - 1]).toEqual(centerOf(doors[(k + 1) % 3] as Rect));
      expect(leg.length).toBeGreaterThan(0);
    });
  });

  it("walks one leg per traveling-light step, in step order, and loops", async () => {
    const { layout, route } = await manorLoop();
    const legs = witnessLegs(layout, route);
    expect(LIGHT_STEP_MS).toBe(1200);
    const at = (ms: number) => ghostAt(legs, ms, LIGHT_STEP_MS);
    expect(at(0).leg).toBe(0);
    expect(at(0).at).toEqual(legs[0]?.points[0]);
    expect(at(600).leg).toBe(0);
    expect(at(600).at).toEqual(pointOnPolyline(legs[0]?.points as Point[], (legs[0]?.length as number) / 2));
    expect(at(1200).leg).toBe(1);
    expect(at(1200).at).toEqual(legs[1]?.points[0]);
    expect(at(2400).leg).toBe(2);
    expect(at(3600).leg).toBe(0);
    expect(at(3600).at).toEqual(at(0).at);
    const visited: number[] = [];
    for (let ms = 0; ms < 8000; ms += 100) {
      const leg = at(ms).leg;
      if (visited[visited.length - 1] !== leg) visited.push(leg);
    }
    expect(visited).toEqual([0, 1, 2, 0, 1, 2, 0]);
  });

  it("walks the loop even while two of its wings are closed: from wing to wing, through the one open door", async () => {
    const { route } = await manorLoop();
    const layout = await layoutOf(requestFor(await manorInvestigation(), ["src/orders"]));
    expect(layout.rooms.some((r) => r.wing === "src/notifications")).toBe(false);
    const legs = witnessLegs(layout, route);
    expect(legs).toHaveLength(3);
    const wing = (name: string) => centerOf(layout.wings.find((w) => w.wing === name) as Rect);
    expect(legs[0]?.points[0]).toEqual(wing("src/notifications"));
    expect(legs[2]?.points[0]).toEqual(wing("src/payments"));
    for (const leg of legs) expect(leg.length).toBeGreaterThan(0);
  });

  it("falls back to the centers of the rooms when a door is not drawn", async () => {
    const { layout, route } = await manorLoop();
    const withoutDoors: LayoutResult = { ...layout, doors: [] };
    const legs = witnessLegs(withoutDoors, route);
    expect(legs).toHaveLength(3);
    const rooms = new Map(layout.rooms.map((r) => [r.id, r] as const));
    expect(legs[0]?.points[0]).toEqual(centerOf(rooms.get(route.modules[0] as string) as Rect));
  });
});
