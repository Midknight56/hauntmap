import { describe, expect, it } from "vitest";
import { hitTest, buildHitTargets } from "../../src/scene/hitTest";
import type { LayoutResult, Rect } from "../../src/scene/layout/types";
import { fixture } from "./fixtureFiles";
import { makeInvestigation } from "./generators";
import { center, layoutOf, requestFor } from "./layoutRequests";

const centerOf = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const overlap = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function checkLayout(layout: LayoutResult): void {
  const targets = buildHitTargets(layout);
  const doors = targets.filter((t) => t.kind === "door");
  const sealed = targets.filter((t) => t.kind === "sealed");
  expect(doors).toHaveLength(layout.doors.length);
  expect(sealed).toHaveLength(layout.sealed.length);
  for (const t of [...doors, ...sealed]) {
    expect(t.rect.w).toBeGreaterThanOrEqual(24);
    expect(t.rect.h).toBeGreaterThanOrEqual(24);
    expect(hitTest(targets, centerOf(t.rect))).toMatchObject({ kind: t.kind, id: t.id });
  }
  // Hit rectangles of one room never overlap.
  const byRoom = new Map<string, { id: string; rect: Rect }[]>();
  for (const d of layout.doors) (byRoom.get(d.from) ?? byRoom.set(d.from, []).get(d.from)!).push({ id: d.relationId, rect: d.hit });
  for (const s of layout.sealed) (byRoom.get(s.from) ?? byRoom.set(s.from, []).get(s.from)!).push({ id: s.relationId, rect: s.hit });
  for (const list of byRoom.values()) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) expect(overlap(list[i]!.rect, list[j]!.rect)).toBe(false);
  }
  // A point outside the bounds hits nothing.
  const b = layout.bounds;
  expect(hitTest(targets, { x: b.x - 10, y: b.y - 10 })).toBeNull();
  expect(hitTest(targets, { x: b.x + b.w + 10, y: b.y + b.h + 10 })).toBeNull();
}

describe("hit targets (9.1)", () => {
  it("meets the size, overlap and priority rules on the two-wings layout", async () => {
    const layout = await layoutOf(requestFor(fixture("two-wings"), "all"));
    expect(layout.doors.length).toBe(3);
    checkLayout(layout);
  });

  it("returns a room inside a wing, a wing in empty wing space, and null elsewhere", async () => {
    const layout = await layoutOf(requestFor(fixture("two-wings"), ["src/orders"]));
    const targets = buildHitTargets(layout);
    const room = layout.rooms[0]!;
    expect(hitTest(targets, center(room))).toMatchObject({ kind: "room", id: room.id });
    const wing = layout.wings.find((w) => w.wing === "src/orders")!;
    expect(hitTest(targets, { x: wing.x + 2, y: wing.y + 2 })).toMatchObject({ kind: "wing", id: "src/orders" });
    expect(hitTest(targets, { x: layout.bounds.x - 1, y: layout.bounds.y - 1 })).toBeNull();
  });

  it("prefers a door over the room it sits on, and a sealed doorway over the room", async () => {
    const layout = await layoutOf(requestFor(fixture("two-wings"), "all"));
    const door = layout.doors[0]!;
    const targets = buildHitTargets(layout);
    const hit = hitTest(targets, centerOf(door.hit));
    expect(hit?.kind).toBe("door");
    const boundary = await layoutOf(requestFor(fixture("boundary"), "all"));
    const bTargets = buildHitTargets(boundary);
    expect(boundary.sealed.length).toBe(3);
    expect(hitTest(bTargets, centerOf(boundary.sealed[0]!.hit))?.kind).toBe("sealed");
  });

  it("places the grouped room above the room and wing under it", async () => {
    const { wide } = await import("./generators");
    const layout = await layoutOf(requestFor(wide, ["src/big"]));
    expect(layout.grouped).toHaveLength(1);
    const targets = buildHitTargets(layout);
    expect(hitTest(targets, centerOf(layout.grouped[0]!))).toMatchObject({ kind: "grouped", id: "src/big" });
  });

  it("holds on 50 generated layouts (P4)", async () => {
    for (let seed = 1; seed <= 50; seed++) {
      const wings: Record<string, number> = { "src/a": 3 + (seed % 9), "src/b": 2 + (seed % 5), "src/c": 1 + (seed % 7) };
      const inv = makeInvestigation({ wings, relationsPerModule: 1 + (seed % 3), seed, boundaryRatio: 0.1 });
      checkLayout(await layoutOf(requestFor(inv, "all")));
    }
  }, 120_000);
});