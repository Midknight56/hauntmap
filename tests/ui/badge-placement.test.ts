import { describe, expect, it } from "vitest";
import type { LayoutResult, Rect } from "../../src/scene/layout/types";
import { BADGE_H, BADGE_W } from "../../src/scene/layout/badges";
import { fixture } from "./fixtureFiles";
import { intersects, layoutOf, requestFor } from "./layoutRequests";
import { manorInvestigation } from "./manorFixture";

// Corridor labels (the "3 imports" pills) are placed by the layout so that they overlap no other
// label, room, door, sealed doorway or wing name where the geometry allows it.

const NAME_STRIP = 28;

function badgeRect(c: LayoutResult["corridors"][number]): Rect {
  const at = c.badge as { x: number; y: number };
  return { x: at.x - BADGE_W / 2, y: at.y - BADGE_H / 2, w: BADGE_W, h: BADGE_H };
}

function problems(result: LayoutResult): string[] {
  const out: string[] = [];
  const solid: [string, Rect][] = [
    ...result.rooms.map((r): [string, Rect] => ["room", r]),
    ...result.grouped.map((r): [string, Rect] => ["grouped room", r]),
    ...result.doors.map((r): [string, Rect] => ["door", r]),
    ...result.sealed.map((r): [string, Rect] => ["sealed doorway", r]),
    ...result.wings.map((w): [string, Rect] => ["wing name", w.expanded ? { x: w.x, y: w.y, w: w.w, h: NAME_STRIP } : w]),
  ];
  result.corridors.forEach((c, i) => {
    if (c.badge === undefined) {
      out.push(`corridor ${i} has no badge`);
      return;
    }
    const rect = badgeRect(c);
    for (const [what, other] of solid) if (intersects(rect, other)) out.push(`label ${i} overlaps a ${what}`);
    result.corridors.forEach((d, j) => {
      if (j > i && d.badge !== undefined && intersects(rect, badgeRect(d))) out.push(`label ${i} overlaps label ${j}`);
    });
  });
  return out;
}

describe("corridor label placement", () => {
  it("gives every corridor of the manor a label that overlaps nothing, with the orders wing open and with every wing open", async () => {
    const manor = await manorInvestigation();
    const closed = await layoutOf(requestFor(manor, ["src/orders"]));
    expect(closed.corridors.length).toBeGreaterThan(5);
    expect(problems(closed)).toEqual([]);
    const open = await layoutOf(requestFor(manor, "all"));
    expect(problems(open)).toEqual([]);
  });

  it("places the label on or beside its corridor, and the same way on every run", async () => {
    const manor = await manorInvestigation();
    const a = await layoutOf(requestFor(manor, ["src/orders"]));
    const b = await layoutOf(requestFor(manor, ["src/orders"]));
    expect(a.corridors.map((c) => c.badge)).toEqual(b.corridors.map((c) => c.badge));
    for (const c of a.corridors) {
      const first = c.path[0] as { x: number; y: number };
      const last = c.path[c.path.length - 1] as { x: number; y: number };
      const at = c.badge as { x: number; y: number };
      const minX = Math.min(first.x, last.x) - 1;
      const maxX = Math.max(first.x, last.x) + 1;
      expect(at.x).toBeGreaterThanOrEqual(minX);
      expect(at.x).toBeLessThanOrEqual(maxX);
    }
  });

  it("labels the corridors of two-wings.json", async () => {
    const result = await layoutOf(requestFor(fixture("two-wings"), "all"));
    expect(result.corridors.every((c) => c.badge !== undefined)).toBe(true);
    expect(problems(result)).toEqual([]);
  });
});
