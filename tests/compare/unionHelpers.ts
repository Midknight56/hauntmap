import { expect } from "vitest";
import type { Investigation } from "../../src/contracts/types";
import { buildUnionGraph, buildUnionRequest, extendLayout, type ExtendOutcome, type UnionGraph } from "../../src/features/compare/unionLayout";
import { place } from "../../src/features/compare/placement";
import { analysisApi } from "../../src/features/investigation/analysisApi";
import type { LayoutRequest, LayoutResult, Rect, RoomBox, WingBox } from "../../src/scene/layout/types";
import { layoutOf, requestFor, intersects } from "../ui/layoutRequests";
export interface Extended {
  current: LayoutResult;
  union: UnionGraph;
  request: LayoutRequest;
  out: ExtendOutcome;
}

/** Lay out `before` with the fleet engine, then extend that layout to the union with `after`. */
export async function extendFor(before: Investigation, after: Investigation, expanded: readonly string[] | "all"): Promise<Extended> {
  const current = await layoutOf(requestFor(before, expanded));
  const union = buildUnionGraph(before, after, "static-value", analysisApi);
  const keep = new Map(current.wings.filter((w) => w.expanded).map((w) => [w.wing, w.shownIds] as const));
  const request = buildUnionRequest(union, [...keep.keys()], keep, "static-value", "dagre");
  return { current, union, request, out: extendLayout(current, union, request, place, "union-key") };
}

export const rect = (b: Rect): Rect => ({ x: b.x, y: b.y, w: b.w, h: b.h });
export const wingOf = (l: LayoutResult, name: string): WingBox => l.wings.find((w) => w.wing === name) as WingBox;
export const roomOf = (l: LayoutResult, id: string): RoomBox => l.rooms.find((r) => r.id === id) as RoomBox;

/** The kept boxes keep their geometry unless they are in the moved list (4.1, I6). */
export function expectKeptGeometry(current: LayoutResult, out: ExtendOutcome): void {
  const moved = new Set(out.movedRoomIds);
  const movedWings = new Set(out.layout.rooms.filter((r) => moved.has(r.id)).map((r) => r.wing));
  for (const room of current.rooms) {
    const next = out.layout.rooms.find((r) => r.id === room.id);
    if (next === undefined) {
      expect(out.droppedRoomIds).toContain(room.id);
      continue;
    }
    if (moved.has(room.id)) expect(rect(next)).not.toEqual(rect(room));
    else expect(rect(next)).toEqual(rect(room));
  }
  for (const wing of current.wings) {
    const next = out.layout.wings.find((w) => w.wing === wing.wing);
    if (next === undefined) continue;
    if (movedWings.has(wing.wing)) {
      expect(next.x).toBe(wing.x);
      expect(next.w).toBe(wing.w);
    } else {
      expect(next.x).toBe(wing.x);
      expect(next.y).toBe(wing.y);
      expect(next.w).toBe(wing.w);
    }
  }
  for (const g of current.grouped) {
    const next = out.layout.grouped.find((x) => x.wing === g.wing);
    if (next !== undefined && !movedWings.has(g.wing)) expect(rect(next)).toEqual(rect(g));
  }
}

export function expectNoWingOverlap(layout: LayoutResult): void {
  for (let i = 0; i < layout.wings.length; i++) {
    for (let j = i + 1; j < layout.wings.length; j++) {
      const a = layout.wings[i] as WingBox;
      const b = layout.wings[j] as WingBox;
      expect(intersects(a, b), `${a.wing} intersects ${b.wing}`).toBe(false);
    }
  }
}
