import { describe, expect, it } from "vitest";
import { deriveStates } from "../../src/scene/stateMap";
import { analysisApi } from "../../src/features/investigation/analysisApi";
import type { RouteFilter } from "../../src/features/investigation/selection";
import { fixture } from "./fixtureFiles";
import { relationIdFor } from "./ids";
import { layoutOf, requestFor } from "./layoutRequests";

async function triad() {
  const inv = fixture("triad");
  return { inv, layout: await layoutOf(requestFor(inv, "all")) };
}

describe("element states (2.4, 2.5, 2.6)", () => {
  it("draws everything default with no selection and no route", async () => {
    const { layout } = await triad();
    const s = deriveStates(layout, { selection: { kind: "none" }, routeFilter: null });
    expect([...s.rooms.values()].every((v) => v === "default")).toBe(true);
    expect(s.haloRoom).toBeNull();
    expect(s.route).toBeNull();
  });

  it("marks the selected room, its halo, the selected door and the selected wing", async () => {
    const { layout } = await triad();
    const room = deriveStates(layout, { selection: { kind: "module", id: "src/b.ts" }, routeFilter: null });
    expect(room.rooms.get("src/b.ts")).toBe("selected");
    expect(room.haloRoom).toBe("src/b.ts");
    const door = relationIdFor("src/a.ts", "src/b.ts", "import", "value");
    const rel = deriveStates(layout, { selection: { kind: "relation", relationId: door }, routeFilter: null });
    expect(rel.doors.get(door)?.state).toBe("selected");
    const wing = deriveStates(layout, { selection: { kind: "wing", wing: "src" }, routeFilter: null });
    expect(wing.wings.get("src")).toBe("selected");
  });

  it("subdues rooms outside a route filter and numbers a witness route", async () => {
    const inv = fixture("cycle");
    const layout = await layoutOf(requestFor(inv, "all"));
    const report = analysisApi.cycles(inv, "static-value");
    const witness = report.components[0]!.witness;
    const routeFilter: RouteFilter = { kind: "witness", modules: witness.modules, relationIds: witness.relationIds, label: "Loop" };
    const s = deriveStates(layout, { selection: { kind: "none" }, routeFilter });
    expect(s.rooms.get("src/x.ts")).toBe("witness");
    expect(s.rooms.get("src/y.ts")).toBe("witness");
    expect(s.rooms.get("src/z.ts")).toBe("subdued");
    expect(s.doors.get(witness.relationIds[0]!)).toEqual({ state: "witness", step: 1 });
    expect(s.doors.get(witness.relationIds[1]!)).toEqual({ state: "witness", step: 2 });
  });

  it("keeps a selected room selected inside a route, and marks a trace route as trace", async () => {
    const { layout } = await triad();
    const a = relationIdFor("src/a.ts", "src/b.ts", "import", "value");
    const b = relationIdFor("src/b.ts", "src/c.ts", "import", "value");
    const routeFilter: RouteFilter = { kind: "trace", modules: ["src/a.ts", "src/b.ts", "src/c.ts"], relationIds: [a, b], label: "Path" };
    const s = deriveStates(layout, { selection: { kind: "module", id: "src/b.ts" }, routeFilter });
    expect(s.rooms.get("src/b.ts")).toBe("selected");
    expect(s.rooms.get("src/a.ts")).toBe("trace");
    expect(s.rooms.get("src/d.ts")).toBe("subdued");
    expect(s.doors.get(b)).toEqual({ state: "trace", step: 2 });
  });

  it("a focus route leaves its rooms default and subdues the others", async () => {
    const { layout } = await triad();
    const routeFilter: RouteFilter = { kind: "focus", modules: ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"], relationIds: [], label: "Focus" };
    const all = deriveStates(layout, { selection: { kind: "none" }, routeFilter });
    expect([...all.rooms.values()].every((v) => v === "default")).toBe(true);
    const some = deriveStates(layout, { selection: { kind: "none" }, routeFilter: { ...routeFilter, modules: ["src/b.ts"] } });
    expect(some.rooms.get("src/b.ts")).toBe("default");
    expect(some.rooms.get("src/a.ts")).toBe("subdued");
  });
});

describe("the loop that is shown from the start (design pass, item 5)", () => {
  async function cycle() {
    const inv = fixture("cycle");
    const layout = await layoutOf(requestFor(inv, "all"));
    const report = analysisApi.cycles(inv, "static-value");
    const loops = report.components.map((c) => ({ modules: c.witness.modules, relationIds: c.witness.relationIds }));
    return { layout, loops };
  }

  it("puts the rooms and the doors of every loop in the looping state, without step numbers and without subduing the others", async () => {
    const { layout, loops } = await cycle();
    const s = deriveStates(layout, { selection: { kind: "none" }, routeFilter: null, loops });
    expect(s.rooms.get("src/x.ts")).toBe("witness");
    expect(s.rooms.get("src/y.ts")).toBe("witness");
    expect(s.rooms.get("src/z.ts")).toBe("witness");
    for (const id of loops[0]!.relationIds) expect(s.doors.get(id)).toEqual({ state: "witness", step: null });
    expect([...s.rooms.values()].filter((v) => v === "subdued")).toEqual([]);
    expect(s.route).toBeNull();
    expect(s.ambient.map((l) => l.modules)).toEqual(loops.map((l) => l.modules));
  });

  it("changes neither the selection nor the halo: a selected room stays selected on the loop", async () => {
    const { layout, loops } = await cycle();
    const s = deriveStates(layout, { selection: { kind: "module", id: "src/x.ts" }, routeFilter: null, loops });
    expect(s.rooms.get("src/x.ts")).toBe("selected");
    expect(s.rooms.get("src/y.ts")).toBe("witness");
    expect(s.haloRoom).toBe("src/x.ts");
  });

  it("a selected relation on the loop is selected, the rest of the loop stays looping", async () => {
    const { layout, loops } = await cycle();
    const first = loops[0]!.relationIds[0]!;
    const s = deriveStates(layout, { selection: { kind: "relation", relationId: first }, routeFilter: null, loops });
    expect(s.doors.get(first)?.state).toBe("selected");
    expect(s.doors.get(loops[0]!.relationIds[1]!)).toEqual({ state: "witness", step: null });
  });

  it("is off while a route filter is active, and without loops nothing is looping", async () => {
    const { layout, loops } = await cycle();
    const routeFilter: RouteFilter = { kind: "focus", modules: ["src/x.ts"], relationIds: [], label: "Focus" };
    const withRoute = deriveStates(layout, { selection: { kind: "none" }, routeFilter, loops });
    expect(withRoute.ambient).toEqual([]);
    expect(withRoute.rooms.get("src/y.ts")).toBe("subdued");
    const none = deriveStates(layout, { selection: { kind: "none" }, routeFilter: null });
    expect(none.ambient).toEqual([]);
    expect([...none.rooms.values()].every((v) => v === "default")).toBe(true);
  });
});
