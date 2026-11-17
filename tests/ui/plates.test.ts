import { describe, expect, it } from "vitest";
import { firstPlateFit, plateCandidates, plateRect, rectsOverlap } from "../../src/scene/labels";

// A name plate never covers another drawn name: it is shortened by the label rule or hidden (design pass 3, item 12b).

const measure = (text: string): number => text.length * 7;

describe("plate candidates", () => {
  it("run from the full file name to the name without its extension and then to cuts of 4 letters or more", () => {
    const list = plateCandidates("receipt.ts", "receipt");
    expect(list[0]).toBe("receipt.ts");
    expect(list[1]).toBe("receipt");
    expect(list.slice(2)).toEqual(["receip\u2026", "recei\u2026", "rece\u2026"]);
    for (const w of list.slice(2)) expect(w.replace("\u2026", "").length).toBeGreaterThanOrEqual(4);
  });

  it("has no cut for a stem of four letters or fewer", () => {
    expect(plateCandidates("a.ts", "a")).toEqual(["a.ts", "a"]);
  });
});

describe("first plate that fits", () => {
  it("takes the longest words that do not collide, and null when none does", () => {
    const list = plateCandidates("checkout.ts", "checkout");
    expect(firstPlateFit(list, () => true)).toBe("checkout.ts");
    expect(firstPlateFit(list, (w) => w.length <= 6)).toBe("check\u2026");
    expect(firstPlateFit(list, () => false)).toBeNull();
  });
});

describe("plate rectangle", () => {
  const room = { x: 100, y: 200, w: 96, h: 64 };
  it("sits over the top of the room, centered, when it is at most a room gap wider than the room", () => {
    const r = plateRect(room, 1, 1, 80);
    expect(r.w).toBeCloseTo(80 + 6, 6);
    expect(r.x + r.w / 2).toBeCloseTo(148, 6);
    expect(r.y).toBeLessThan(room.y + 6);
    expect(r.y + r.h).toBeLessThan(room.y + room.h);
  });
  it("sits under the room when it is far wider", () => {
    const r = plateRect(room, 1, 1, 200);
    expect(r.y).toBeGreaterThanOrEqual(room.y + room.h);
  });
});

describe("overlap", () => {
  it("is true only when the rectangles share area", () => {
    expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
    expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 })).toBe(false);
    expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 11, w: 10, h: 10 })).toBe(false);
  });
});

void measure;
