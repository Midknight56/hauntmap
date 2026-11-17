import { describe, expect, it } from "vitest";
import { relatedRelations } from "../../src/scene/emphasis";
import type { LayoutResult } from "../../src/scene/layout/types";

// Item 6b: passages that are not part of the selection, the route or the comparison fade.

const room = (id: string, wing: string) => ({ id, wing, x: 0, y: 0, w: 96, h: 64, label: id });
const door = (relationId: string, from: string, to: string) => ({ relationId, from, to, x: 0, y: 0, w: 16, h: 16, side: "e" as const, arrow: [], hit: { x: 0, y: 0, w: 24, h: 24 } });

const layout = {
  rooms: [room("a", "w1"), room("b", "w1"), room("c", "w2"), room("d", "w2")],
  doors: [door("ab", "a", "b"), door("bc", "b", "c"), door("cd", "c", "d"), door("da", "d", "a")],
  sealed: [{ relationId: "a-ext", from: "a", x: 0, y: 0, w: 16, h: 16, hit: { x: 0, y: 0, w: 24, h: 24 } }],
} as unknown as Pick<LayoutResult, "rooms" | "doors" | "sealed">;

const none = { rooms: new Map(), doors: new Map(), sealed: new Map() };

describe("which passages stay bright", () => {
  it("fades nothing when there is no selection, no route and no comparison", () => {
    expect(relatedRelations(layout, { selection: { kind: "none" }, routeFilter: null, marks: none })).toBeNull();
  });

  it("keeps the doors of a selected room, and nothing else", () => {
    const set = relatedRelations(layout, { selection: { kind: "module", id: "b" }, routeFilter: null, marks: none }) as Set<string>;
    expect([...set].sort()).toEqual(["ab", "bc"]);
  });

  it("keeps the selected relation, and the doors of a selected wing", () => {
    expect([...(relatedRelations(layout, { selection: { kind: "relation", relationId: "cd" }, routeFilter: null, marks: none }) as Set<string>)]).toEqual(["cd"]);
    const wing = relatedRelations(layout, { selection: { kind: "wing", wing: "w2" }, routeFilter: null, marks: none }) as Set<string>;
    expect([...wing].sort()).toEqual(["bc", "cd", "da", "ab"].filter((id) => id !== "ab").sort());
  });

  it("keeps the relations of a route", () => {
    const route = { kind: "witness" as const, modules: ["a", "b"], relationIds: ["ab", "da"], label: "" };
    expect([...(relatedRelations(layout, { selection: { kind: "none" }, routeFilter: route, marks: none }) as Set<string>)].sort()).toEqual(["ab", "da"]);
  });

  it("keeps only the removed and added doors in a comparison; a changed room has its lamp, its doors fade", () => {
    const marks = {
      rooms: new Map([["c", "comparison-changed" as const]]),
      doors: new Map([["ab", "comparison-removed" as const]]),
      sealed: new Map([["a-ext", "comparison-added" as const]]),
    };
    const set = relatedRelations(layout, { selection: { kind: "none" }, routeFilter: null, marks }) as Set<string>;
    expect([...set].sort()).toEqual(["a-ext", "ab"]);
  });

  it("is deterministic and does not mutate its input", () => {
    const input = { selection: { kind: "module" as const, id: "a" }, routeFilter: null, marks: none };
    expect([...(relatedRelations(layout, input) as Set<string>)]).toEqual([...(relatedRelations(layout, input) as Set<string>)]);
    expect(layout.doors).toHaveLength(4);
  });
});
