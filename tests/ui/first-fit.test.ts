import { describe, expect, it } from "vitest";
import { fitBounds } from "../../src/scene/camera";
import { COMPACT_WIDTH, firstFitBounds, firstViewPlan } from "../../src/components/firstFit";
import type { LayoutResult } from "../../src/scene/layout/types";

// On a phone the map is 328 px wide: the whole manor would need a zoom under the 0.25 floor, so the first view shows the wings that
// are open (the three wings of the loop) and the rest is a pan away. On a desktop the first view still fits everything.

const wing = (name: string, x: number, expanded: boolean) => ({ wing: name, x, y: 100, w: 300, h: 200, moduleCount: 3, expanded, rank: 0, shownIds: [], hiddenCount: 0 });
const layout = {
  bounds: { x: 0, y: 0, w: 2400, h: 600 },
  wings: [wing("a", 100, true), wing("b", 500, true), wing("c", 900, false), wing("d", 2000, false)],
} as unknown as Pick<LayoutResult, "bounds" | "wings">;

describe("first fit (design pass, phone)", () => {
  it("fits every wing on a wide screen", () => {
    expect(firstFitBounds(layout, 1232)).toEqual(layout.bounds);
  });

  it("fits the open wings on a phone", () => {
    expect(COMPACT_WIDTH).toBe(520);
    expect(firstFitBounds(layout, 328)).toEqual({ x: 100, y: 100, w: 700, h: 200 });
    const camera = fitBounds(firstFitBounds(layout, 328), { width: 328, height: 204 }, 16);
    expect(camera.zoom).toBeGreaterThan(0.25);
    expect(fitBounds(layout.bounds, { width: 328, height: 204 }, 16).zoom).toBe(0.25);
  });

  it("falls back to every wing when none is open", () => {
    const closed = { ...layout, wings: layout.wings.map((w) => ({ ...w, expanded: false })) };
    expect(firstFitBounds(closed, 328)).toEqual(layout.bounds);
  });
});

// Design pass 2, items 1 and 7: the first view frames the loop. On a wide map that is the wings that hold the loop's rooms; on a
// phone it is the loop's rooms, its doors and the corridors between its wings.
const room = (id: string, wing: string, x: number, y: number) => ({ id, wing, x, y, w: 96, h: 64, label: id });
const loopLayout = {
  bounds: { x: 0, y: 0, w: 2400, h: 600 },
  wings: [wing("a", 100, true), wing("b", 500, true), wing("c", 900, true), wing("d", 2000, false)].map((w, i) => ({ ...w, wing: ["a", "b", "c", "d"][i] as string })),
  rooms: [room("a/x.ts", "a", 120, 140), room("b/y.ts", "b", 540, 160), room("c/z.ts", "c", 940, 130), room("c/other.ts", "c", 1040, 230)],
  doors: [
    { relationId: "r1", from: "a/x.ts", to: "b/y.ts", x: 216, y: 160, w: 20, h: 20, side: "e", arrow: [{ x: 216, y: 170 }, { x: 540, y: 190 }], hit: { x: 216, y: 160, w: 20, h: 20 } },
    { relationId: "r2", from: "b/y.ts", to: "c/z.ts", x: 636, y: 180, w: 20, h: 20, side: "e", arrow: [{ x: 636, y: 190 }, { x: 940, y: 160 }], hit: { x: 636, y: 180, w: 20, h: 20 } },
    { relationId: "r3", from: "c/z.ts", to: "a/x.ts", x: 940, y: 140, w: 20, h: 20, side: "n", arrow: [{ x: 950, y: 140 }, { x: 950, y: 60 }, { x: 170, y: 60 }, { x: 170, y: 140 }], hit: { x: 940, y: 140, w: 20, h: 20 } },
    { relationId: "unrelated", from: "c/other.ts", to: "c/z.ts", x: 1040, y: 230, w: 20, h: 20, side: "w", arrow: [{ x: 1040, y: 240 }, { x: 1000, y: 240 }], hit: { x: 1040, y: 230, w: 20, h: 20 } },
  ],
  corridors: [],
} as unknown as Parameters<typeof firstViewPlan>[0];
const loops = [{ modules: ["a/x.ts", "b/y.ts", "c/z.ts"], relationIds: ["r1", "r2", "r3"] }];

describe("first view plan (design pass 2)", () => {
  it("on a wide map frames the wings that hold the loop's rooms, not the others", () => {
    const plan = firstViewPlan(loopLayout, loops, 1232);
    expect(plan.compact).toBe(false);
    expect(plan.rects).toEqual([loopLayout.wings[0], loopLayout.wings[1], loopLayout.wings[2]].map((w) => ({ x: w!.x, y: w!.y, w: w!.w, h: w!.h })));
  });

  it("on a phone frames the loop's rooms and doors and the path of its doors, and nothing of the wings around them", () => {
    const plan = firstViewPlan(loopLayout, loops, 328);
    expect(plan.compact).toBe(true);
    const union = plan.rects.reduce((u, r) => ({ x0: Math.min(u.x0, r.x), y0: Math.min(u.y0, r.y), x1: Math.max(u.x1, r.x + r.w), y1: Math.max(u.y1, r.y + r.h) }), { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 });
    // The rooms span x 120 to 1036; the door path runs over the top at y 60.
    expect(union).toEqual({ x0: 120, y0: 60, x1: 1036, y1: 224 });
    expect(plan.rects.length).toBeGreaterThanOrEqual(3);
  });

  it("falls back to the old first fit when the investigation has no loop", () => {
    expect(firstViewPlan(loopLayout, [], 1232)).toEqual({ rects: [loopLayout.bounds], compact: false });
    expect(firstViewPlan(loopLayout, [], 328).compact).toBe(false);
  });
});