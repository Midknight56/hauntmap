import { describe, expect, it } from "vitest";
import { collapsedWingMarks } from "../../src/scene/compare/collapsed";
import type { ComparisonStyle } from "../../src/scene/compare";
import type { LayoutResult, WingBox } from "../../src/scene/layout/types";
import { relationIdFor } from "./ids";

// Item 9 of the design pass: the removed door and the added door are the first things the eye finds, also when their
// wing is collapsed: the wing shows a dashed doorway (removed) and a doorway in moss (added) on its wall.

const wing = (name: string, expanded: boolean, x: number): WingBox => ({ wing: name, x, y: 0, w: 200, h: 160, moduleCount: 4, expanded, rank: 0, shownIds: [], hiddenCount: 0 });
const layout = (wings: WingBox[]): Pick<LayoutResult, "wings" | "doors" | "sealed"> => ({ wings, doors: [], sealed: [] });

const removed = relationIdFor("src/notifications/receipt.ts", "src/orders/checkout.ts", "import", "value");
const added = relationIdFor("src/notifications/receipt.ts", "src/orders/summary.ts", "import", "value");

const style = (patch: Partial<ComparisonStyle> = {}): ComparisonStyle => ({
  comparisonStyleVersion: 1,
  shown: "after",
  changedModules: [],
  removedModules: [],
  addedModules: [],
  removedRelationIds: [removed],
  addedRelationIds: [added],
  closingRelationIds: [],
  earlierLabel: "manor/before",
  newerLabel: "manor/after",
  ...patch,
});

describe("collapsedWingMarks", () => {
  it("puts a dashed doorway and a moss doorway on the wall of each collapsed wing the changed relations touch", () => {
    const marks = collapsedWingMarks(layout([wing("src/notifications", false, 0), wing("src/orders", false, 400)]), style());
    const of = (w: string, kind: string) => marks.filter((m) => m.wing === w && m.kind === kind);
    expect(of("src/notifications", "removed")).toHaveLength(1);
    expect(of("src/notifications", "added")).toHaveLength(1);
    expect(of("src/orders", "removed")).toHaveLength(1);
    expect(of("src/orders", "added")).toHaveLength(1);
    expect(marks).toHaveLength(4);
  });

  it("marks only the collapsed wing when the other end is open", () => {
    const marks = collapsedWingMarks(layout([wing("src/notifications", true, 0), wing("src/orders", false, 400)]), style());
    expect(new Set(marks.map((m) => m.wing))).toEqual(new Set(["src/orders"]));
  });

  it("puts the two doorways on the wall of the wing, apart from each other, at a size that can be hit", () => {
    const w = wing("src/orders", false, 400);
    const marks = collapsedWingMarks(layout([wing("src/notifications", true, 0), w]), style());
    const [a, b] = [marks.find((m) => m.kind === "removed"), marks.find((m) => m.kind === "added")];
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    for (const m of [a!, b!]) {
      expect(m.w).toBeGreaterThanOrEqual(24);
      expect(m.h).toBeGreaterThanOrEqual(24);
      // The centre sits on the wall (right edge) of the wing.
      expect(m.x + m.w / 2).toBeCloseTo(w.x + w.w, 6);
      expect(m.y).toBeGreaterThanOrEqual(w.y);
      expect(m.y + m.h).toBeLessThanOrEqual(w.y + w.h);
    }
    expect(Math.abs((a!.y ?? 0) - (b!.y ?? 0))).toBeGreaterThanOrEqual(a!.h);
  });

  it("draws nothing for a relation whose door is drawn, for the earlier view, or for a wing that is open", () => {
    const open = layout([wing("src/notifications", true, 0), wing("src/orders", true, 400)]);
    expect(collapsedWingMarks(open, style())).toEqual([]);
    const closed = layout([wing("src/notifications", false, 0), wing("src/orders", false, 400)]);
    expect(collapsedWingMarks(closed, style({ shown: "before" }))).toEqual([]);
    const drawn = { ...closed, doors: [{ relationId: removed }, { relationId: added }] } as unknown as Pick<LayoutResult, "wings" | "doors" | "sealed">;
    expect(collapsedWingMarks(drawn, style())).toEqual([]);
  });

  it("reads the modules from the relation ID and ignores an ID it cannot read", () => {
    const marks = collapsedWingMarks(layout([wing("src/orders", false, 0)]), style({ removedRelationIds: ["not json", JSON.stringify([1, 2])], addedRelationIds: [] }));
    expect(marks).toEqual([]);
  });

  it("is the same on every call (the order follows the wing order and then removed before added)", () => {
    const l = layout([wing("src/orders", false, 400), wing("src/notifications", false, 0)]);
    expect(collapsedWingMarks(l, style())).toEqual(collapsedWingMarks(l, style()));
    expect(collapsedWingMarks(l, style()).map((m) => `${m.wing}:${m.kind}`)).toEqual([
      "src/orders:removed",
      "src/orders:added",
      "src/notifications:removed",
      "src/notifications:added",
    ]);
  });
});
