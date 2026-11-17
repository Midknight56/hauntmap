import { describe, expect, it } from "vitest";
import { rectOfTarget } from "../../src/scene/targets";
import { fixture } from "./fixtureFiles";
import { relationIdFor } from "./ids";
import { layoutOf, requestFor } from "./layoutRequests";

describe("target rectangles (focusOn and screenRectOf)", () => {
  it("finds rooms, wings and doors by ID", async () => {
    const inv = fixture("two-wings");
    const layout = await layoutOf(requestFor(inv, "all"));
    const room = layout.rooms.find((r) => r.id === "src/orders/a.ts")!;
    expect(rectOfTarget(layout, { kind: "room", id: room.id })).toEqual({ x: room.x, y: room.y, w: room.w, h: room.h });
    const wing = layout.wings.find((w) => w.wing === "src/orders")!;
    expect(rectOfTarget(layout, { kind: "wing", id: "src/orders" })).toEqual({ x: wing.x, y: wing.y, w: wing.w, h: wing.h });
    const door = layout.doors[0]!;
    expect(rectOfTarget(layout, { kind: "door", id: door.relationId })).toEqual({ x: door.x, y: door.y, w: door.w, h: door.h });
  });

  it("falls back from an undrawn door to the importer's room, then to its wing", async () => {
    const inv = fixture("two-wings");
    const layout = await layoutOf(requestFor(inv, ["src/orders"]));
    const undrawn = relationIdFor("src/orders/a.ts", "src/payments/p.ts", "import", "value");
    expect(layout.doors.some((d) => d.relationId === undrawn)).toBe(false);
    const room = layout.rooms.find((r) => r.id === "src/orders/a.ts")!;
    expect(rectOfTarget(layout, { kind: "door", id: undrawn })).toEqual({ x: room.x, y: room.y, w: room.w, h: room.h });
    const collapsed = relationIdFor("src/payments/q.ts", "src/orders/c.ts", "import", "value");
    const wing = layout.wings.find((w) => w.wing === "src/payments")!;
    expect(rectOfTarget(layout, { kind: "door", id: collapsed })).toEqual({ x: wing.x, y: wing.y, w: wing.w, h: wing.h });
  });

  it("returns null for an unknown target and for an ID that is not a relation ID", async () => {
    const layout = await layoutOf(requestFor(fixture("two-wings"), "all"));
    expect(rectOfTarget(layout, { kind: "room", id: "src/none.ts" })).toBeNull();
    expect(rectOfTarget(layout, { kind: "door", id: "not json" })).toBeNull();
    expect(rectOfTarget(layout, { kind: "wing", id: "src/none" })).toBeNull();
  });
});