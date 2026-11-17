import { describe, expect, it } from "vitest";
import { fitBounds } from "../../src/scene/camera";
import { COMPACT_WIDTH, firstFitBounds } from "../../src/components/firstFit";
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