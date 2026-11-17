import { describe, expect, it } from "vitest";
import { compareInvestigations } from "../../src/analysis/graph/compare";
import type { Investigation } from "../../src/contracts/types";
import { analysisApi } from "../../src/features/investigation/analysisApi";
import { styleOf } from "../../src/features/compare/style";
import type { CompareState } from "../../src/features/compare/store";
import { buildUnionGraph } from "../../src/features/compare/unionLayout";
import { CLOSING_MS, applyComparison, closingKey, comparisonStateOf, shouldClose, type ComparisonStyle } from "../../src/scene/compare";
import { buildHitTargets } from "../../src/scene/hitTest";
import { deriveStates } from "../../src/scene/stateMap";
import { loadFixture } from "./expected";
import { relationIdFor } from "./ids";
import { extendFor } from "./unionHelpers";

const style = (patch: Partial<ComparisonStyle> = {}): ComparisonStyle => ({
  comparisonStyleVersion: 1,
  shown: "after",
  changedModules: ["src/c.ts"],
  removedModules: ["src/r.ts"],
  addedModules: ["src/a.ts"],
  removedRelationIds: ["rel-removed"],
  addedRelationIds: ["rel-added"],
  closingRelationIds: [],
  earlierLabel: "one",
  newerLabel: "two",
  ...patch,
});

/** A compare state built from a fixture pair, as the compare store holds it while active. */
function activeState(before: Investigation, after: Investigation, shown: "before" | "after", closing: string[] = []): CompareState {
  const outcome = compareInvestigations(before, after);
  if (!outcome.ok) throw new Error(outcome.error.message);
  return {
    compareStateVersion: 1,
    status: "active",
    panelOpen: false,
    before: { label: before.sourceLabel, investigation: before, sourceText: null },
    after: { label: after.sourceLabel, investigation: after, sourceText: null },
    result: outcome.result,
    detail: outcome.detail,
    shown,
    union: buildUnionGraph(before, after, "static-value", analysisApi),
    layoutPath: "extended",
    unionLayoutKey: "k",
    closingRelationIds: closing,
    selected: null,
    error: null,
  };
}

describe("comparisonStateOf (5.1, 5.2)", () => {
  const rooms: [string, string, string][] = [
    ["src/c.ts", "comparison-changed", "comparison-changed"],
    ["src/r.ts", "comparison-removed", "default"],
    ["src/a.ts", "comparison-added", "hidden"],
    ["src/same.ts", "default", "default"],
  ];
  it.each(rooms)("room %s is %s in the newer view and %s in the earlier view", (id, newer, earlier) => {
    expect(comparisonStateOf(style({ shown: "after" }), { kind: "room", id })).toBe(newer);
    expect(comparisonStateOf(style({ shown: "before" }), { kind: "room", id })).toBe(earlier);
  });

  const doors: [string, string, string][] = [
    ["rel-removed", "comparison-removed", "default"],
    ["rel-added", "comparison-added", "hidden"],
    ["rel-same", "default", "default"],
  ];
  for (const kind of ["door", "sealed"] as const) {
    it.each(doors)(`${kind} %s is %s in the newer view and %s in the earlier view`, (id, newer, earlier) => {
      expect(comparisonStateOf(style({ shown: "after" }), { kind, id })).toBe(newer);
      expect(comparisonStateOf(style({ shown: "before" }), { kind, id })).toBe(earlier);
    });
  }

  it("is default for everything without a comparison", () => {
    expect(comparisonStateOf(null, { kind: "room", id: "src/c.ts" })).toBe("default");
    expect(comparisonStateOf(null, { kind: "door", id: "rel-added" })).toBe("default");
  });

  it("5.8 ignores labels, including a live: label with no source", () => {
    for (const target of [
      { kind: "room" as const, id: "src/c.ts" },
      { kind: "room" as const, id: "src/a.ts" },
      { kind: "door" as const, id: "rel-removed" },
    ]) {
      for (const shown of ["before", "after"] as const) {
        const a = comparisonStateOf(style({ shown }), target);
        const b = comparisonStateOf(style({ shown, earlierLabel: "live:samples/manor", newerLabel: "<img src=x>" }), target);
        expect(b).toBe(a);
      }
    }
  });
});

describe("hash and relation changes stay apart (5.7)", () => {
  for (const name of ["comment-shift", "duplicate-occurrence"] as const) {
    it(`${name}: room src/a.ts is changed and its door keeps its ordinary state in both views`, () => {
      const { before, after } = loadFixture(name);
      const door = relationIdFor("src/a.ts", "src/b.ts", "import", "value");
      for (const shown of ["after", "before"] as const) {
        const s = styleOf(activeState(before, after, shown));
        expect(comparisonStateOf(s, { kind: "room", id: "src/a.ts" })).toBe("comparison-changed");
        expect(comparisonStateOf(s, { kind: "room", id: "src/b.ts" })).toBe("default");
        expect(comparisonStateOf(s, { kind: "door", id: door })).toBe("default");
      }
    });
  }
});

describe("the closing set (6.3)", () => {
  it("styleOf carries closingRelationIds from the compare state, at activation and at each show", () => {
    const { before, after } = loadFixture("cycle-closes");
    const yx = relationIdFor("src/y.ts", "src/x.ts", "import", "value");
    expect(styleOf(activeState(before, after, "after", [yx]))?.closingRelationIds).toEqual([yx]);
    expect(styleOf(activeState(before, after, "before", []))?.closingRelationIds).toEqual([]);
  });

  it("the corridor closes only when a non-empty set differs from the last one applied", () => {
    expect(shouldClose(style({ closingRelationIds: [] }), "")).toBe(false);
    expect(shouldClose(style({ closingRelationIds: ["b", "a"] }), "")).toBe(true);
    expect(shouldClose(style({ closingRelationIds: ["a", "b"] }), closingKey(["b", "a"]))).toBe(false);
    expect(shouldClose(null, "")).toBe(false);
    expect(CLOSING_MS).toBe(600);
  });
});

describe("applyComparison over a union layout (5.1, 5.2, 5.6)", () => {
  it("rename, newer view: ghosts are drawn and hit-testable; earlier view: added room and door are hidden and not hit-testable", async () => {
    const { before, after } = loadFixture("rename");
    const { out } = await extendFor(before, after, "all");
    const removedDoor = relationIdFor("src/app.ts", "src/util/format.ts", "import", "value");
    const addedDoor = relationIdFor("src/app.ts", "src/util/formatMoney.ts", "import", "value");
    const fleet = deriveStates(out.layout, { selection: { kind: "none" }, routeFilter: null });

    const newer = applyComparison(out.layout, fleet, styleOf(activeState(before, after, "after")));
    expect(newer.debug).toMatchObject({
      "src/app.ts": "comparison-changed",
      "src/util/format.ts": "comparison-removed",
      "src/util/formatMoney.ts": "comparison-added",
      [removedDoor]: "comparison-removed",
      [addedDoor]: "comparison-added",
    });
    expect(newer.states.rooms.get("src/util/format.ts")).toBe("comparison-removed");
    expect(newer.states.doors.get(addedDoor)?.state).toBe("comparison-added");
    const newerTargets = buildHitTargets(newer.drawn).map((t) => `${t.kind}:${t.id}`);
    expect(newerTargets).toEqual(expect.arrayContaining(["room:src/util/format.ts", `door:${removedDoor}`, "room:src/util/formatMoney.ts", `door:${addedDoor}`]));

    const earlier = applyComparison(out.layout, fleet, styleOf(activeState(before, after, "before")));
    expect(earlier.debug["src/util/formatMoney.ts"]).toBe("hidden");
    expect(earlier.debug[addedDoor]).toBe("hidden");
    expect(earlier.debug["src/util/format.ts"]).toBe("default");
    expect(earlier.drawn.rooms.some((r) => r.id === "src/util/formatMoney.ts")).toBe(false);
    expect(earlier.drawn.doors.some((d) => d.relationId === addedDoor)).toBe(false);
    const earlierTargets = buildHitTargets(earlier.drawn).map((t) => `${t.kind}:${t.id}`);
    expect(earlierTargets).not.toContain("room:src/util/formatMoney.ts");
    expect(earlierTargets).not.toContain(`door:${addedDoor}`);
    // Hidden boxes keep their slots: every drawn box has the geometry of the union layout.
    for (const room of earlier.drawn.rooms) expect(room).toEqual(out.layout.rooms.find((r) => r.id === room.id));
  });

  it("the fleet's selected, witness and subdued states keep precedence; the comparison mark is drawn on top", async () => {
    const { before, after } = loadFixture("cycle-closes");
    const { out } = await extendFor(before, after, "all");
    const yx = relationIdFor("src/y.ts", "src/x.ts", "import", "value");
    const fleet = deriveStates(out.layout, { selection: { kind: "module", id: "src/y.ts" }, routeFilter: null });
    const view = applyComparison(out.layout, fleet, styleOf(activeState(before, after, "after")));
    expect(view.states.rooms.get("src/y.ts")).toBe("selected");
    expect(view.marks.rooms.get("src/y.ts")).toBe("comparison-changed");
    expect(view.states.doors.get(yx)?.state).toBe("comparison-removed");
    expect(view.debug[yx]).toBe("comparison-removed");
  });

  it("without a comparison it changes nothing", async () => {
    const { before, after } = loadFixture("rename");
    const { out } = await extendFor(before, after, "all");
    const fleet = deriveStates(out.layout, { selection: { kind: "none" }, routeFilter: null });
    const view = applyComparison(out.layout, fleet, null);
    expect(view.drawn).toBe(out.layout);
    expect(view.states).toBe(fleet);
    expect(Object.values(view.debug).every((s) => s === "default")).toBe(true);
  });
});
