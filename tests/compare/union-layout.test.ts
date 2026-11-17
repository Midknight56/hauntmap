import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildUnionGraph, buildUnionRequest, extendLayout, unionLayoutKey, unionRequestBuilder, type UnionGraph } from "../../src/features/compare/unionLayout";
import { place } from "../../src/features/compare/placement";
import { analysisApi } from "../../src/features/investigation/analysisApi";
import type { LayoutRequest, LayoutResult, Rect, RoomBox, WingBox } from "../../src/scene/layout/types";
import { layoutOf, requestFor } from "../ui/layoutRequests";
import { expectKeptGeometry, expectNoWingOverlap, extendFor, rect, roomOf, wingOf } from "./unionHelpers";
import { FIXTURE_NAMES, loadFixture } from "./expected";
import { mutate, perf1000, simpleInvestigation } from "./generators";
import { REPO, analyzeFiles, readSourcesJson } from "./loadFolder";

describe("extendLayout keeps every kept box (4.1)", () => {
  for (const name of FIXTURE_NAMES) {
    it(`${name}: kept rooms, wings and grouped rooms keep their geometry with all wings expanded`, async () => {
      const { before, after } = loadFixture(name);
      const { current, out } = await extendFor(before, after, "all");
      expectKeptGeometry(current, out);
      expect(out.layout.layoutKey).toBe("union-key");
      expect(out.layout.engine).toEqual(current.engine);
      for (const id of out.droppedRoomIds) expect(out.layout.rooms.some((r) => r.id === id)).toBe(false);
    });

    it(`${name}: no wing boxes overlap afterwards`, async () => {
      const { before, after } = loadFixture(name);
      const { out } = await extendFor(before, after, "all");
      expectNoWingOverlap(out.layout);
    });
  }

  it("the manor pair: no room moves, no room is added, only doors of receipt.ts change", async () => {
    const read = (side: string) => readSourcesJson(join(REPO, "public", "demo", "manor", side, "sources.json"));
    const before = await analyzeFiles(read("before"), "manor/before");
    const after = await analyzeFiles(read("after"), "manor/after");
    for (const expanded of ["all", ["src/orders"]] as const) {
      const { current, out } = await extendFor(before, after, expanded);
      expect(out.movedRoomIds).toEqual([]);
      expect(out.addedRoomIds).toEqual([]);
      expect(out.droppedRoomIds).toEqual([]);
      expect(out.layout.rooms.map((r) => [r.id, rect(r)])).toEqual(current.rooms.map((r) => [r.id, rect(r)]));
      expect(out.layout.wings.map((w) => [w.wing, rect(w)])).toEqual(current.wings.map((w) => [w.wing, rect(w)]));
      const doorRect = (l: LayoutResult) => new Map(l.doors.map((d) => [d.relationId, rect(d)] as const));
      const was = doorRect(current);
      const now = doorRect(out.layout);
      const changed = [...new Set([...was.keys(), ...now.keys()])].filter((id) => JSON.stringify(was.get(id)) !== JSON.stringify(now.get(id)));
      for (const id of changed) expect((JSON.parse(id) as string[])[0]).toBe("src/notifications/receipt.ts");
    }
  });
});

describe("placement of added rooms (4.2)", () => {
  const ids = (wing: string, n: number, from = 1): string[] => Array.from({ length: n }, (_, i) => `${wing}/m${String(from + i).padStart(3, "0")}.ts`);

  it("an expanded wing with fewer than 80 rooms gets a new row below its lowest room, left to right in ID order, and grows", async () => {
    const before = simpleInvestigation("b", ids("src/a", 2));
    const after = simpleInvestigation("a", ids("src/a", 5));
    const { current, out } = await extendFor(before, after, ["src/a"]);
    const w0 = wingOf(current, "src/a");
    const w1 = wingOf(out.layout, "src/a");
    expect(w0.w).toBe(256);
    const lowest = Math.max(...current.rooms.map((r) => r.y + r.h));
    const [m3, m4, m5] = ["src/a/m003.ts", "src/a/m004.ts", "src/a/m005.ts"].map((id) => roomOf(out.layout, id));
    expect([m3?.x, m3?.y]).toEqual([w0.x + 24, lowest + 16]);
    expect([m4?.x, m4?.y]).toEqual([w0.x + 24 + 112, lowest + 16]);
    expect([m5?.x, m5?.y]).toEqual([w0.x + 24, lowest + 16 + 80]);
    expect(m5?.w).toBe(96);
    expect(m5?.h).toBe(64);
    expect(m5?.label).toBe("m005.ts");
    expect(w1.y + w1.h).toBe((m5 as RoomBox).y + 64 + 24);
    expect(w1.h).toBe(w0.h + 160);
    expect(w1.moduleCount).toBe(5);
    expect(w1.shownIds).toEqual(ids("src/a", 5));
    expect(out.addedRoomIds).toEqual(["src/a/m003.ts", "src/a/m004.ts", "src/a/m005.ts"]);
    expect(out.movedRoomIds).toEqual([]);
  });

  it("an expanded wing that shows 80 rooms counts the module as hidden and writes the grouped label", async () => {
    const before = simpleInvestigation("b", ids("src/b", 81));
    const after = simpleInvestigation("a", ids("src/b", 82));
    const { current, out } = await extendFor(before, after, ["src/b"]);
    expect(current.rooms).toHaveLength(80);
    expect(current.grouped[0]?.label).toBe("+1 more modules");
    const wing = wingOf(out.layout, "src/b");
    expect(out.layout.rooms).toHaveLength(80);
    expect(wing.hiddenCount).toBe(2);
    expect(wing.moduleCount).toBe(82);
    expect(out.layout.grouped).toHaveLength(1);
    expect(out.layout.grouped[0]?.label).toBe("+2 more modules");
    expect(rect(out.layout.grouped[0] as Rect)).toEqual(rect(current.grouped[0] as Rect));
  });

  it("a wing that shows exactly 80 rooms gets a grouped room when a module is added", async () => {
    const before = simpleInvestigation("b", ids("src/b", 80));
    const after = simpleInvestigation("a", ids("src/b", 81));
    const { current, out } = await extendFor(before, after, ["src/b"]);
    expect(current.grouped).toHaveLength(0);
    expect(out.layout.grouped).toHaveLength(1);
    expect(out.layout.grouped[0]?.label).toBe("+1 more modules");
    expect(out.layout.rooms).toHaveLength(80);
  });

  it("a collapsed wing only counts the module", async () => {
    const before = simpleInvestigation("b", [...ids("src/c", 1), ...ids("src/e", 1)]);
    const after = simpleInvestigation("a", [...ids("src/c", 2), ...ids("src/e", 1)]);
    const { current, out } = await extendFor(before, after, ["src/e"]);
    const w0 = wingOf(current, "src/c");
    const w1 = wingOf(out.layout, "src/c");
    expect(rect(w1)).toEqual(rect(w0));
    expect(w1.expanded).toBe(false);
    expect(w1.moduleCount).toBe(2);
    expect(w1.hiddenCount).toBe(2);
    expect(out.layout.rooms.some((r) => r.wing === "src/c")).toBe(false);
    expect(out.addedRoomIds).toEqual([]);
  });

  it("a module in a wing the layout does not have gets a new collapsed wing to the right, 48 units below the previous new wing", async () => {
    const before = simpleInvestigation("b", ids("src/a", 2));
    const after = simpleInvestigation("a", [...ids("src/a", 2), "src/d/x.ts", "src/e/y.ts", "src/e/z.ts"]);
    const { current, out } = await extendFor(before, after, ["src/a"]);
    const maxRank = Math.max(...current.wings.map((w) => w.rank));
    const d = wingOf(out.layout, "src/d");
    const e = wingOf(out.layout, "src/e");
    expect(rect(d)).toEqual({ x: current.bounds.x + current.bounds.w + 48, y: current.bounds.y + 32, w: 144, h: 120 });
    expect(rect(e)).toEqual({ x: d.x, y: d.y + 120 + 48, w: 144, h: 120 });
    expect([d.rank, d.expanded, d.moduleCount, d.hiddenCount, d.shownIds]).toEqual([maxRank + 1, false, 1, 1, []]);
    expect([e.rank, e.moduleCount]).toEqual([maxRank + 2, 2]);
    expectNoWingOverlap(out.layout);
  });
});

/** A hand-built stack of wings in one column, two rooms each, no doors: the shape of one dagre rank. */
function column(names: readonly string[]): { layout: LayoutResult; ids: string[] } {
  const wings: WingBox[] = [];
  const rooms: RoomBox[] = [];
  names.forEach((name, i) => {
    const y = i * 168;
    wings.push({ wing: name, x: 0, y, w: 256, h: 120, moduleCount: 2, expanded: true, rank: i, shownIds: [`${name}/m001.ts`, `${name}/m002.ts`], hiddenCount: 0 });
    rooms.push({ id: `${name}/m001.ts`, wing: name, x: 24, y: y + 32, w: 96, h: 64, label: "m001.ts" });
    rooms.push({ id: `${name}/m002.ts`, wing: name, x: 136, y: y + 32, w: 96, h: 64, label: "m002.ts" });
  });
  const layout: LayoutResult = {
    layoutVersion: 1,
    layoutKey: "base",
    engine: { name: "dagre", version: "test" },
    wings,
    rooms,
    grouped: [],
    doors: [],
    sealed: [],
    corridors: [],
    bounds: { x: -32, y: -32, w: 320, h: names.length * 168 - 48 + 64 },
    stats: { ms: 0, nodeCount: 0, edgeCount: 0 },
  };
  return { layout, ids: rooms.map((r) => r.id) };
}

describe("overlap resolution of grown wings (4.3)", () => {
  const modulesOf = (names: readonly string[], extra: Record<string, number> = {}): string[] =>
    names.flatMap((n) => [`${n}/m001.ts`, `${n}/m002.ts`, ...Array.from({ length: extra[n] ?? 0 }, (_, i) => `${n}/m${String(3 + i).padStart(3, "0")}.ts`)]);

  it("translates the wings below a grown wing, accumulates translations in rank order, and lists the moved rooms", () => {
    const names = ["src/a", "src/b", "src/c", "src/d"];
    const { layout } = column(names);
    const before = simpleInvestigation("b", modulesOf(names));
    const after = simpleInvestigation("a", modulesOf(names, { "src/a": 3, "src/b": 1 }));
    const union = buildUnionGraph(before, after, "static-value", analysisApi);
    const keep = new Map(layout.wings.map((w) => [w.wing, w.shownIds] as const));
    const request = buildUnionRequest(union, names, keep, "static-value", "dagre");
    const out = extendLayout(layout, union, request, place, "k");
    // a: 3 added rooms are two new rows (+160); b: 1 added room is one new row (+80).
    expect(wingOf(out.layout, "src/a").h).toBe(120 + 160);
    expect(wingOf(out.layout, "src/b").y).toBe(168 + 160);
    expect(wingOf(out.layout, "src/b").h).toBe(120 + 80);
    expect(wingOf(out.layout, "src/c").y).toBe(336 + 160 + 80);
    expect(wingOf(out.layout, "src/d").y).toBe(504 + 160 + 80);
    expect(roomOf(out.layout, "src/c/m001.ts").y).toBe(336 + 32 + 240);
    expect(out.movedRoomIds).toEqual(["src/b/m001.ts", "src/b/m002.ts", "src/c/m001.ts", "src/c/m002.ts", "src/d/m001.ts", "src/d/m002.ts"]);
    expect(out.addedRoomIds).toHaveLength(4);
    expectNoWingOverlap(out.layout);
  });

  it("moves nothing when the grown wing has no wing below it", () => {
    const names = ["src/a", "src/b"];
    const { layout } = column(names);
    const before = simpleInvestigation("b", modulesOf(names));
    const after = simpleInvestigation("a", modulesOf(names, { "src/b": 2 }));
    const union = buildUnionGraph(before, after, "static-value", analysisApi);
    const keep = new Map(layout.wings.map((w) => [w.wing, w.shownIds] as const));
    const out = extendLayout(layout, union, buildUnionRequest(union, names, keep, "static-value", "dagre"), place, "k");
    expect(out.movedRoomIds).toEqual([]);
    expect(wingOf(out.layout, "src/b").h).toBe(120 + 80);
  });

  it("ignores a wing beside the grown one: only wings whose horizontal extent overlaps move", () => {
    const names = ["src/a", "src/b"];
    const { layout } = column(names);
    // Put b to the right of a, below a's bottom edge: no horizontal overlap, so it must not move.
    const b = wingOf(layout, "src/b");
    b.x = 400;
    for (const r of layout.rooms.filter((r) => r.wing === "src/b")) r.x += 400;
    const before = simpleInvestigation("b", modulesOf(names));
    const after = simpleInvestigation("a", modulesOf(names, { "src/a": 2 }));
    const union = buildUnionGraph(before, after, "static-value", analysisApi);
    const keep = new Map(layout.wings.map((w) => [w.wing, w.shownIds] as const));
    const out = extendLayout(layout, union, buildUnionRequest(union, names, keep, "static-value", "dagre"), place, "k");
    expect(out.movedRoomIds).toEqual([]);
    expect(wingOf(out.layout, "src/b").y).toBe(168);
  });

  it("generated stacks: no wing boxes intersect afterwards and the moved rooms are exactly the kept rooms that changed position", () => {
    for (let n = 2; n <= 6; n++) {
      for (let mask = 0; mask < 1 << n; mask++) {
        const names = Array.from({ length: n }, (_, i) => `src/w${i}`);
        const { layout } = column(names);
        const extra: Record<string, number> = {};
        names.forEach((name, i) => {
          if (mask & (1 << i)) extra[name] = 1 + ((mask + i) % 4);
        });
        const union = buildUnionGraph(simpleInvestigation("b", modulesOf(names)), simpleInvestigation("a", modulesOf(names, extra)), "static-value", analysisApi);
        const keep = new Map(layout.wings.map((w) => [w.wing, w.shownIds] as const));
        const out = extendLayout(layout, union, buildUnionRequest(union, names, keep, "static-value", "dagre"), place, "k");
        expectNoWingOverlap(out.layout);
        const changed = layout.rooms.filter((r) => rect(roomOf(out.layout, r.id)).y !== r.y).map((r) => r.id).sort();
        expect(out.movedRoomIds).toEqual(changed);
      }
    }
  });
});

describe("doors, sealed doorways, corridors, bounds and key (4.4)", () => {
  it("one door per union drawn relation with both rooms drawn, one sealed doorway per boundary with its importer drawn", async () => {
    const { before, after } = loadFixture("boundary-change");
    const { out, union } = await extendFor(before, after, "all");
    const drawnBoth = union.drawn.filter((r) => out.layout.rooms.some((x) => x.id === r.from) && out.layout.rooms.some((x) => x.id === r.to));
    expect(out.layout.doors.map((d) => d.relationId).sort()).toEqual(drawnBoth.map((r) => r.relationId).sort());
    expect(out.layout.sealed.map((s) => s.relationId).sort()).toEqual(union.boundaries.map((b) => b.relationId).sort());
    for (const door of out.layout.doors) expect(door.hit.w).toBeGreaterThanOrEqual(24);
  });

  it("a removed relation keeps its door (a ghost) and an added relation gets one", async () => {
    const { before, after } = loadFixture("rename");
    const { out, union } = await extendFor(before, after, "all");
    const memberships = Object.fromEntries(union.drawn.map((r) => [r.relationId, r.membership]));
    expect(Object.values(memberships).sort()).toEqual(["after", "before"]);
    for (const id of Object.keys(memberships)) expect(out.layout.doors.some((d) => d.relationId === id)).toBe(true);
  });

  it("one corridor per ordered wing pair with its distinct union relation count", async () => {
    const before = simpleInvestigation("b", ["src/a/x.ts", "src/b/y.ts", "src/b/z.ts"], [["src/a/x.ts", "src/b/y.ts"]]);
    const after = simpleInvestigation("a", ["src/a/x.ts", "src/b/y.ts", "src/b/z.ts"], [["src/a/x.ts", "src/b/z.ts"], ["src/b/y.ts", "src/a/x.ts"]]);
    const { out } = await extendFor(before, after, "all");
    const corridors = Object.fromEntries(out.layout.corridors.map((c) => [`${c.fromWing}>${c.toWing}`, c.count]));
    expect(corridors).toEqual({ "src/a>src/b": 2, "src/b>src/a": 1 });
    for (const c of out.layout.corridors) expect(c.path).toHaveLength(2);
  });

  it("a corridor whose path is unchanged keeps its label position; a new or moved one has none, so the scene uses the middle", async () => {
    const before = simpleInvestigation("b", ["src/a/x.ts", "src/b/y.ts", "src/c/z.ts"], [["src/a/x.ts", "src/b/y.ts"]]);
    const after = simpleInvestigation("a", ["src/a/x.ts", "src/b/y.ts", "src/c/z.ts"], [["src/a/x.ts", "src/b/y.ts"], ["src/a/x.ts", "src/c/z.ts"]]);
    const { current, out } = await extendFor(before, after, "all");
    const kept = out.layout.corridors.find((c) => c.toWing === "src/b");
    expect(kept?.badge).toEqual(current.corridors.find((c) => c.toWing === "src/b")?.badge);
    expect(out.layout.corridors.find((c) => c.toWing === "src/c")?.badge).toBeUndefined();
  });

  it("bounds are the union of the wing boxes plus 32 units, and the key is the one given", async () => {
    const before = simpleInvestigation("b", ["src/a/x.ts", "src/a/y.ts"]);
    const after = simpleInvestigation("a", ["src/a/x.ts", "src/a/y.ts", "src/a/z.ts", "src/q/w.ts"]);
    const { out } = await extendFor(before, after, ["src/a"]);
    const left = Math.min(...out.layout.wings.map((w) => w.x)) - 32;
    const top = Math.min(...out.layout.wings.map((w) => w.y)) - 32;
    const right = Math.max(...out.layout.wings.map((w) => w.x + w.w)) + 32;
    const bottom = Math.max(...out.layout.wings.map((w) => w.y + w.h)) + 32;
    expect(out.layout.bounds).toEqual({ x: left, y: top, w: right - left, h: bottom - top });
    expect(out.layout.layoutKey).toBe("union-key");
    expect(out.layout.stats.nodeCount).toBe(out.layout.rooms.length + out.layout.wings.length);
    expect(out.layout.stats.edgeCount).toBe(out.layout.doors.length);
  });

  it("unionLayoutKey is the SHA-256 hex of the canonical JSON and does not depend on list order", async () => {
    const before = simpleInvestigation("b", ["src/a/x.ts", "src/a/y.ts"], [["src/a/x.ts", "src/a/y.ts"]]);
    const after = simpleInvestigation("a", ["src/a/x.ts", "src/a/y.ts", "src/a/z.ts"], [["src/a/x.ts", "src/a/z.ts"]]);
    const union = buildUnionGraph(before, after, "static-value", analysisApi);
    const request = buildUnionRequest(union, ["src/a"], new Map(), "static-value", "dagre");
    const sha = async (s: string): Promise<string> => {
      const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
      return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
    };
    const engine = { name: "dagre", version: "x" };
    const key = await unionLayoutKey("base-key", request, engine, sha);
    const canonical = JSON.stringify({
      base: "base-key",
      modules: ["src/a/x.ts", "src/a/y.ts", "src/a/z.ts"],
      relations: union.drawn.map((r) => r.relationId).sort(),
      expandedWings: ["src/a"],
      preset: "static-value",
      engine,
    });
    expect(key).toBe(await sha(canonical));
    const reversed: LayoutRequest = { ...request, modules: [...request.modules].reverse(), relations: [...request.relations].reverse() };
    expect(await unionLayoutKey("base-key", reversed, engine, sha)).toBe(key);
    expect(await unionLayoutKey(null, request, engine, sha)).not.toBe(key);
  });
});

describe("the union request (4.5, 4.6)", () => {
  it("lists every union module, the union relations and boundaries, and the 80 smallest modules of a newly expanded wing", () => {
    const many = Array.from({ length: 90 }, (_, i) => `src/w/m${String(i).padStart(3, "0")}.ts`);
    const union = buildUnionGraph(simpleInvestigation("b", many.slice(0, 85)), simpleInvestigation("a", many), "static-value", analysisApi);
    const request = buildUnionRequest(union, ["src/w"], new Map(), "static-value", "dagre");
    expect(request.modules).toHaveLength(90);
    expect(request.expandedWings).toEqual([{ wing: "src/w", shownIds: many.slice(0, 80), hiddenCount: 10 }]);
    expect(request.room).toEqual({ w: 96, h: 64 });
    expect(request.layoutVersion).toBe(1);
  });

  it("a wing that is already shown keeps its shown modules, drops removed ones and appends added ones while fewer than 80", () => {
    const union = buildUnionGraph(
      simpleInvestigation("b", ["src/w/a.ts", "src/w/b.ts", "src/w/c.ts"]),
      simpleInvestigation("a", ["src/w/b.ts", "src/w/c.ts", "src/w/d.ts"]),
      "static-value",
      analysisApi,
    );
    const request = buildUnionRequest(union, ["src/w"], new Map([["src/w", ["src/w/c.ts", "src/w/a.ts"]]]), "static-value", "dagre");
    expect(request.expandedWings[0]?.shownIds).toEqual(["src/w/c.ts", "src/w/a.ts", "src/w/b.ts", "src/w/d.ts"]);
    expect(request.expandedWings[0]?.hiddenCount).toBe(0);
  });

  it("the builder returns null without a comparison and a request with one, reading only the view state", () => {
    const union = buildUnionGraph(simpleInvestigation("b", ["src/w/a.ts"]), simpleInvestigation("a", ["src/w/a.ts", "src/w/b.ts"]), "static-value", analysisApi);
    let active: { union: UnionGraph; engine: "dagre" | "elk" } | null = null;
    const builder = unionRequestBuilder(() => active);
    const state = { preset: "static-value" as const, expandedWings: ["src/w"], layout: null };
    expect(builder(state as never)).toBeNull();
    active = { union, engine: "dagre" };
    const request = builder(state as never);
    expect(request?.modules.map((m) => m.id)).toEqual(["src/w/a.ts", "src/w/b.ts"]);
    expect(request?.expandedWings[0]?.shownIds).toEqual(["src/w/a.ts", "src/w/b.ts"]);
  });
});

describe("dropped rooms (6.8)", () => {
  it("drops rooms of modules that are in neither snapshot, with their wing counts", async () => {
    // A first comparison A against B laid out B's `new.ts`; a second handoff compares A against C, which lacks it.
    const a = simpleInvestigation("a", ["src/a/x.ts", "src/a/y.ts", "src/a/old.ts"], [["src/a/x.ts", "src/a/y.ts"]]);
    const b = simpleInvestigation("b", ["src/a/x.ts", "src/a/y.ts", "src/a/old.ts", "src/a/new.ts"], [["src/a/x.ts", "src/a/new.ts"]]);
    const c = simpleInvestigation("c", ["src/a/x.ts", "src/a/y.ts", "src/a/old.ts"], [["src/a/x.ts", "src/a/old.ts"]]);
    const first = await extendFor(a, b, ["src/a"]);
    expect(first.out.layout.rooms.map((r) => r.id)).toContain("src/a/new.ts");
    const union = buildUnionGraph(a, c, "static-value", analysisApi);
    const keep = new Map([["src/a", first.out.layout.wings[0]?.shownIds ?? []]]);
    const out = extendLayout(first.out.layout, union, buildUnionRequest(union, ["src/a"], keep, "static-value", "dagre"), place, "k2");
    expect(out.droppedRoomIds).toEqual(["src/a/new.ts"]);
    expect(out.layout.rooms.map((r) => r.id).sort()).toEqual(["src/a/old.ts", "src/a/x.ts", "src/a/y.ts"]);
    for (const room of first.current.rooms) expect(rect(roomOf(out.layout, room.id))).toEqual(rect(roomOf(first.out.layout, room.id)));
    const wing = wingOf(out.layout, "src/a");
    expect(wing.shownIds).toEqual(["src/a/old.ts", "src/a/x.ts", "src/a/y.ts"]);
    expect(wing.moduleCount).toBe(3);
    expect(out.layout.doors.every((d) => d.from !== "src/a/new.ts" && d.to !== "src/a/new.ts")).toBe(true);
    expect(out.layout.doors.map((d) => d.relationId).sort()).toEqual(union.drawn.map((r) => r.relationId).sort());
  });
});
describe("extendLayout timing (4.9)", () => {
  it("extends a 1,000-room, 3,000-relation union; the figure is printed", async () => {
    const before = perf1000();
    const added = Array.from({ length: 20 }, (_, i) => ({ kind: "addModule" as const, id: `src/w${String(i * 2).padStart(2, "0")}/zz${i}.ts` }));
    const after = mutate(before, added);
    const current = await layoutOf(requestFor(before, "all"));
    expect(current.rooms).toHaveLength(1000);
    const union = buildUnionGraph(before, after, "static-value", analysisApi);
    expect(union.drawn).toHaveLength(3000);
    const keep = new Map(current.wings.filter((w) => w.expanded).map((w) => [w.wing, w.shownIds] as const));
    const request = buildUnionRequest(union, [...keep.keys()], keep, "static-value", "dagre");
    const started = performance.now();
    const out = extendLayout(current, union, request, place, "k");
    const ms = performance.now() - started;
    const target = process.env["HAUNTMAP_PERF_DEVICE"] !== undefined;
    console.log(`extendLayout perf1000: ${ms.toFixed(1)} ms (HAUNTMAP_PERF_DEVICE ${target ? "set" : "not set"}; ceiling 1000 ms, target 100 ms)`);
    expect(out.layout.rooms).toHaveLength(1020);
    expect(ms).toBeLessThan(1000);
    if (target) expect(ms).toBeLessThan(100);
  }, 120_000);
});
