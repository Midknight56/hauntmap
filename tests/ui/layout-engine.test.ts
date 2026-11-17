import { describe, expect, it } from "vitest";
import type { Investigation } from "../../src/contracts/types";
import { fixture, type FixtureName } from "./fixtureFiles";
import { perf1000, perf200 } from "./generators";
import { center, inside, intersects, layoutOf, rankMap, requestFor } from "./layoutRequests";

const FIXTURES: FixtureName[] = ["triad", "escaped", "boundary", "cycle", "two-wings", "mixed-presets", "long-name"];

function checkWingBoxes(result: Awaited<ReturnType<typeof layoutOf>>): void {
  for (const wing of result.wings) expect(inside(wing, result.bounds)).toBe(true);
  for (let i = 0; i < result.wings.length; i++) {
    for (let j = i + 1; j < result.wings.length; j++) {
      expect(intersects(result.wings[i]!, result.wings[j]!)).toBe(false);
    }
  }
}

describe("layout engine: rooms (2.1, 2.3, 2.9)", () => {
  it("draws every room at 96 x 64, inside its wing, whatever the file or the wing", async () => {
    const result = await layoutOf(requestFor(fixture("two-wings"), "all"));
    expect(result.rooms).toHaveLength(5);
    for (const room of result.rooms) {
      expect([room.w, room.h]).toEqual([96, 64]);
      const wing = result.wings.find((w) => w.wing === room.wing)!;
      expect(inside(room, wing)).toBe(true);
    }
  });

  it("boundary.json gives 1 room, 0 doors and 3 sealed doorways", async () => {
    const result = await layoutOf(requestFor(fixture("boundary"), "all"));
    expect(result.rooms).toHaveLength(1);
    expect(result.doors).toHaveLength(0);
    expect(result.sealed).toHaveLength(3);
    expect(result.sealed.every((s) => s.from === "src/app.ts")).toBe(true);
  });

  it("long-name.json clips the label at 18 characters and keeps the full ID", async () => {
    const result = await layoutOf(requestFor(fixture("long-name"), "all"));
    expect(result.rooms[0]?.label).toBe("aVeryLongModuleNam\u2026");
    expect(result.rooms[0]?.id).toBe("src/long/aVeryLongModuleName.ts");
  });

  it("a name of at most 18 characters is not clipped", async () => {
    const result = await layoutOf(requestFor(fixture("triad"), "all"));
    expect(result.rooms.map((r) => r.label)).toEqual(["a.ts", "b.ts", "c.ts", "d.ts"]);
  });
});

describe("layout engine: overview, corridors and expansion (3.4, 3.6)", () => {
  it("draws one wing per wing and the aggregated corridors of two-wings.json", async () => {
    const result = await layoutOf(requestFor(fixture("two-wings")));
    expect(result.wings.map((w) => [w.wing, w.moduleCount, w.expanded])).toEqual([
      ["src/orders", 3, false],
      ["src/payments", 2, false],
    ]);
    expect(result.rooms).toHaveLength(0);
    expect(result.doors).toHaveLength(0);
    expect(result.corridors.map((c) => [c.fromWing, c.toWing, c.count])).toEqual([
      ["src/orders", "src/payments", 2],
      ["src/payments", "src/orders", 1],
    ]);
    for (const corridor of result.corridors) expect(corridor.path.length).toBeGreaterThanOrEqual(2);
  });

  it("expanding src/orders alone draws 3 rooms and no door", async () => {
    const result = await layoutOf(requestFor(fixture("two-wings"), ["src/orders"]));
    expect(result.rooms.map((r) => r.id)).toEqual(["src/orders/a.ts", "src/orders/b.ts", "src/orders/c.ts"]);
    expect(result.doors).toHaveLength(0);
    expect(result.corridors).toHaveLength(2);
  });

  it("expanding both wings draws 5 rooms and 3 doors, on the side that faces the other wing", async () => {
    const result = await layoutOf(requestFor(fixture("two-wings"), "all"));
    expect(result.rooms).toHaveLength(5);
    expect(result.doors).toHaveLength(3);
    const byFrom = new Map(result.doors.map((d) => [d.from, d]));
    const roomOf = new Map(result.rooms.map((r) => [r.id, r]));
    for (const door of result.doors) {
      const from = center(roomOf.get(door.from)!);
      const to = center(roomOf.get(door.to)!);
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const expected = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? "e" : "w") : dy >= 0 ? "s" : "n";
      expect(door.side).toBe(expected);
    }
    const opposite = { e: "w", w: "e", n: "s", s: "n" } as const;
    expect(byFrom.get("src/orders/a.ts")!.side).toBe(byFrom.get("src/orders/b.ts")!.side);
    expect(byFrom.get("src/payments/q.ts")!.side).toBe(opposite[byFrom.get("src/orders/a.ts")!.side]);
  });

  it("keeps every wing's rank when a wing is expanded or collapsed (3.6)", async () => {
    for (const inv of [fixture("two-wings"), perf200]) {
      const wings = [...new Set(inv.modules.map((m) => m.id.slice(0, m.id.lastIndexOf("/"))))];
      const collapsed = await layoutOf(requestFor(inv));
      const expanded = await layoutOf(requestFor(inv, [wings[0]!]));
      const all = await layoutOf(requestFor(inv, "all"));
      const collapsedAgain = await layoutOf(requestFor(inv));
      expect(rankMap(expanded)).toEqual(rankMap(collapsed));
      expect(rankMap(all)).toEqual(rankMap(collapsed));
      expect(rankMap(collapsedAgain)).toEqual(rankMap(collapsed));
      checkWingBoxes(collapsed);
      checkWingBoxes(expanded);
      checkWingBoxes(all);
    }
  });

  it("gives every fixture wing boxes inside bounds that do not intersect", async () => {
    for (const name of FIXTURES) {
      checkWingBoxes(await layoutOf(requestFor(fixture(name))));
      checkWingBoxes(await layoutOf(requestFor(fixture(name), "all")));
    }
  });

  it("ranks wings left to right along the imports, which gives the wing graph a direction", async () => {
    const result = await layoutOf(requestFor(fixture("two-wings")));
    const ranks = rankMap(result);
    expect(ranks["src/orders"]).not.toBe(ranks["src/payments"]);
  });
});

describe("layout engine: shapes at scale", () => {
  const cases: [string, Investigation, number][] = [
    ["perf200", perf200, 200],
    ["perf1000", perf1000, 1000],
  ];
  for (const [name, inv, count] of cases) {
    it(`${name}: every module is in a wing box, rooms do not overlap, nodeCount is ${count}`, async () => {
      const result = await layoutOf(requestFor(inv, "all"));
      expect(result.stats.nodeCount).toBe(count);
      expect(result.stats.edgeCount).toBe(inv.imports.length);
      expect(result.rooms).toHaveLength(count);
      expect(new Set(result.rooms.map((r) => r.id)).size).toBe(count);
      checkWingBoxes(result);
      const byWing = new Map<string, typeof result.rooms>();
      for (const room of result.rooms) {
        const wing = result.wings.find((w) => w.wing === room.wing)!;
        expect(inside(room, wing)).toBe(true);
        byWing.set(room.wing, [...(byWing.get(room.wing) ?? []), room]);
      }
      for (const rooms of byWing.values()) {
        for (let i = 0; i < rooms.length; i++) {
          for (let j = i + 1; j < rooms.length; j++) expect(intersects(rooms[i]!, rooms[j]!)).toBe(false);
        }
      }
    }, 120_000);
  }
});

describe("layout engine: invariants I3 and I4", () => {
  it("shownIds plus hiddenCount equals the module count for every wing", async () => {
    const result = await layoutOf(requestFor(fixture("two-wings"), ["src/orders"]));
    for (const wing of result.wings) expect(wing.shownIds.length + wing.hiddenCount).toBe(wing.moduleCount);
    expect(result.wings.find((w) => w.wing === "src/payments")!.shownIds).toEqual([]);
  });

  it("draws doors only for requested relations with both rooms drawn, and no room for a boundary", async () => {
    const inv = fixture("mixed-presets");
    for (const preset of ["static-value", "type-inclusive", "dynamic-inclusive"] as const) {
      const req = requestFor(inv, "all", preset);
      const result = await layoutOf(req);
      const allowed = new Set(req.relations.map((r) => r.relationId));
      expect(result.doors.every((d) => allowed.has(d.relationId))).toBe(true);
      expect(result.doors).toHaveLength(req.relations.length);
      expect(result.rooms).toHaveLength(4);
    }
    expect((await layoutOf(requestFor(inv, "all", "static-value"))).doors).toHaveLength(1);
    expect((await layoutOf(requestFor(inv, "all", "type-inclusive"))).doors).toHaveLength(2);
    expect((await layoutOf(requestFor(inv, "all", "dynamic-inclusive"))).doors).toHaveLength(2);
  });

  it("a sealed doorway needs a drawn importer room", async () => {
    const collapsed = await layoutOf(requestFor(fixture("boundary")));
    expect(collapsed.sealed).toHaveLength(0);
  });
});

describe("door placement (hit sizes)", () => {
  it("gives every hit at least 24 x 24 and keeps the hits of one room disjoint", async () => {
    const result = await layoutOf(requestFor(perf200, "all"));
    expect(result.doors.length).toBeGreaterThan(100);
    for (const door of result.doors) {
      expect(door.hit.w).toBeGreaterThanOrEqual(24);
      expect(door.hit.h).toBeGreaterThanOrEqual(24);
    }
    const byRoom = new Map<string, { x: number; y: number; w: number; h: number }[]>();
    for (const door of result.doors) byRoom.set(door.from, [...(byRoom.get(door.from) ?? []), door.hit]);
    for (const hits of byRoom.values()) {
      for (let i = 0; i < hits.length; i++) {
        for (let j = i + 1; j < hits.length; j++) expect(intersects(hits[i]!, hits[j]!)).toBe(false);
      }
    }
  });
});
