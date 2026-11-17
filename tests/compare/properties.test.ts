import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { codeUnitCompare, compareInvestigations } from "../../src/analysis/graph/compare";
import type { ComparisonResult, ImportRecord, Investigation } from "../../src/contracts/types";
import { arbitraryOccurrenceOnlyPair, arbitraryPair, expectedDiff, mulberry32 } from "./generators";
import { expectKeptGeometry, expectNoWingOverlap, extendFor, rect } from "./unionHelpers";
import { comparisonStateOf, type ComparisonStyle } from "../../src/scene/compare";

// Properties P1 to P8 of design.md: 200 runs each; fast-check prints the seed of a failing run.
const RUNS = { numRuns: 200 };

function run(a: Investigation, b: Investigation) {
  const outcome = compareInvestigations(a, b);
  if (!outcome.ok) throw new Error(`compare failed: ${outcome.error.message}`);
  return outcome;
}

const ids = (inv: Investigation): Set<string> => new Set(inv.modules.map((m) => m.id));
const rels = (inv: Investigation): Set<string> => new Set(inv.imports.map((r) => r.relationId));
const sorted = (set: Iterable<string>): string[] => [...set].sort(codeUnitCompare);

function permute(inv: Investigation, seed: number): Investigation {
  const rand = mulberry32(seed);
  const shuffle = <T>(list: readonly T[]): T[] => {
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
    }
    return copy;
  };
  return { ...inv, modules: shuffle(inv.modules), imports: shuffle(inv.imports) };
}

const isSorted = (list: readonly string[]): boolean => list.every((v, i) => i === 0 || codeUnitCompare(list[i - 1] as string, v) <= 0);

function firstOccurrence(inv: Investigation, relationId: string): ImportRecord {
  const all = inv.imports.filter((r) => r.relationId === relationId).sort((x, y) => x.line - y.line || x.column - y.column);
  return all[0] as ImportRecord;
}

describe("comparison properties", () => {
  it("P1 partition: added, removed and common modules and relations partition the unions (3.1, I2)", () => {
    fc.assert(
      fc.property(arbitraryPair(), ({ before, after }) => {
        const { result, detail } = run(before, after);
        const union = sorted(new Set([...ids(before), ...ids(after)]));
        const parts = [...result.addedModules, ...result.removedModules, ...detail.common];
        if (parts.length !== union.length || JSON.stringify(sorted(parts)) !== JSON.stringify(union)) throw new Error("modules do not partition the union");
        const relUnion = sorted(new Set([...rels(before), ...rels(after)]));
        const common = [...rels(before)].filter((r) => rels(after).has(r));
        const relParts = [...result.addedRelations.map((r) => r.relationId), ...result.removedRelations.map((r) => r.relationId), ...common];
        if (relParts.length !== relUnion.length || JSON.stringify(sorted(relParts)) !== JSON.stringify(relUnion)) throw new Error("relations do not partition the union");
      }),
      RUNS,
    );
  });

  it("P2 antisymmetry: swapping the snapshots swaps the added and removed lists (3.1)", () => {
    fc.assert(
      fc.property(arbitraryPair(), ({ before, after }) => {
        const ab = run(before, after).result;
        const ba = run(after, before).result;
        const rid = (list: ComparisonResult["addedRelations"]): string[] => list.map((r) => r.relationId);
        const same = (x: unknown, y: unknown): void => {
          if (JSON.stringify(x) !== JSON.stringify(y)) throw new Error(`${JSON.stringify(x)} != ${JSON.stringify(y)}`);
        };
        same(ab.addedModules, ba.removedModules);
        same(ab.removedModules, ba.addedModules);
        same(ab.changedModules, ba.changedModules);
        same(rid(ab.addedRelations), rid(ba.removedRelations));
        same(rid(ab.removedRelations), rid(ba.addedRelations));
        same([ab.cyclicComponentsBefore, ab.cyclicComponentsAfter], [ba.cyclicComponentsAfter, ba.cyclicComponentsBefore]);
      }),
      RUNS,
    );
  });

  it("P3 reflexivity: compare(a, a) is empty and identical (2.5)", () => {
    fc.assert(
      fc.property(arbitraryPair(), ({ before }) => {
        const { result, detail } = run(before, before);
        const empty = [result.addedModules, result.removedModules, result.changedModules, result.addedRelations, result.removedRelations];
        if (!empty.every((l) => l.length === 0)) throw new Error("a list is not empty");
        if (!detail.identical) throw new Error("not identical");
        if (result.before.moduleCount !== result.after.moduleCount || result.before.relationCount !== result.after.relationCount) throw new Error("counts differ");
        if (result.cyclicComponentsBefore !== result.cyclicComponentsAfter) throw new Error("cycle counts differ");
      }),
      RUNS,
    );
  });

  it("P4 occurrence invariance: occurrence-only changes add or remove no relation and change exactly the re-hashed modules (3.4, 3.5, 5.7)", () => {
    fc.assert(
      fc.property(arbitraryOccurrenceOnlyPair(), ({ before, after, mutations }) => {
        const { result } = run(before, after);
        if (result.addedRelations.length !== 0 || result.removedRelations.length !== 0) throw new Error("a relation changed");
        if (result.addedModules.length !== 0 || result.removedModules.length !== 0) throw new Error("a module changed");
        const expected = expectedDiff(before, mutations).changedModules;
        if (JSON.stringify(result.changedModules) !== JSON.stringify(expected)) throw new Error("changedModules differ from the re-hashed set");
      }),
      RUNS,
    );
  });

  it("P5 hash fidelity: changedModules is exactly the common modules whose hashes differ (3.1)", () => {
    fc.assert(
      fc.property(arbitraryPair(), ({ before, after }) => {
        const { result } = run(before, after);
        const hashes = new Map(before.modules.map((m) => [m.id, m.sourceHash] as const));
        const expected = sorted(after.modules.filter((m) => hashes.has(m.id) && hashes.get(m.id) !== m.sourceHash).map((m) => m.id));
        if (JSON.stringify(result.changedModules) !== JSON.stringify(expected)) throw new Error("changedModules differ");
      }),
      RUNS,
    );
  });

  it("P6 order independence: permuting modules and imports changes nothing and every list is sorted (3.2, I3)", () => {
    fc.assert(
      fc.property(arbitraryPair(), fc.integer({ min: 1, max: 1_000_000 }), ({ before, after }, seed) => {
        const plain = run(before, after);
        const shuffled = run(permute(before, seed), permute(after, seed + 1));
        if (JSON.stringify(plain) !== JSON.stringify(shuffled)) throw new Error("the outcome depends on the input order");
        const { result } = plain;
        const lists = [result.addedModules, result.removedModules, result.changedModules, result.addedRelations.map((r) => r.relationId), result.removedRelations.map((r) => r.relationId)];
        if (!lists.every(isSorted)) throw new Error("a list is not sorted by code unit");
      }),
      RUNS,
    );
  });

  it("P7 provenance: every ref is absent on the other side and equals its first occurrence (3.3)", () => {
    fc.assert(
      fc.property(arbitraryPair(), ({ before, after }) => {
        const { result } = run(before, after);
        for (const ref of result.removedRelations) {
          if (!rels(before).has(ref.relationId) || rels(after).has(ref.relationId)) throw new Error("removed ref is not only in the earlier snapshot");
          const first = firstOccurrence(before, ref.relationId);
          const expected = { relationId: first.relationId, from: first.from, to: first.to, specifier: first.specifier, syntaxKind: first.syntaxKind, dependencyKind: first.dependencyKind, resolution: first.resolution };
          if (JSON.stringify(ref) !== JSON.stringify(expected)) throw new Error("removed ref differs from the first occurrence");
        }
        for (const ref of result.addedRelations) {
          if (!rels(after).has(ref.relationId) || rels(before).has(ref.relationId)) throw new Error("added ref is not only in the newer snapshot");
          const first = firstOccurrence(after, ref.relationId);
          if (ref.specifier !== first.specifier || ref.from !== first.from || ref.to !== first.to) throw new Error("added ref differs from the first occurrence");
        }
      }),
      RUNS,
    );
  });

  it("P8 counts: relationCount is the distinct IDs, moduleCount the modules, and the lists equal expectedDiff (3.1)", () => {
    fc.assert(
      fc.property(arbitraryPair(), ({ before, after, mutations }) => {
        const { result } = run(before, after);
        if (result.before.relationCount !== rels(before).size || result.after.relationCount !== rels(after).size) throw new Error("relationCount");
        if (result.before.moduleCount !== before.modules.length || result.after.moduleCount !== after.modules.length) throw new Error("moduleCount");
        const expected = expectedDiff(before, mutations);
        const got = {
          addedModules: result.addedModules,
          removedModules: result.removedModules,
          changedModules: result.changedModules,
          addedRelationIds: result.addedRelations.map((r) => r.relationId),
          removedRelationIds: result.removedRelations.map((r) => r.relationId),
        };
        if (JSON.stringify(got) !== JSON.stringify(expected)) throw new Error("the result differs from expectedDiff");
      }),
      RUNS,
    );
  });

  it("P9 layout extension: kept boxes keep their geometry, wings never overlap, every drawn module has one room, every drawn relation one door (4.1, 4.3, 4.4)", async () => {
    await fc.assert(
      fc.asyncProperty(arbitraryPair(), fc.array(fc.boolean(), { minLength: 8, maxLength: 8 }), async ({ before, after }, flags) => {
        const wings = [...new Set(before.modules.map((m) => m.id.slice(0, m.id.lastIndexOf("/"))))].sort();
        const expanded = wings.filter((_, i) => flags[i % flags.length]);
        const { current, union, out } = await extendFor(before, after, expanded);
        expectKeptGeometry(current, out);
        expectNoWingOverlap(out.layout);

        // The moved list is empty when no wing grew, and otherwise names exactly the kept rooms that changed position.
        const grew = out.layout.wings.some((w) => {
          const was = current.wings.find((x) => x.wing === w.wing);
          return was !== undefined && w.h > was.h;
        });
        const changed = current.rooms.filter((r) => out.layout.rooms.some((x) => x.id === r.id && x.y !== r.y)).map((r) => r.id).sort();
        expect(out.movedRoomIds).toEqual(changed);
        if (!grew) expect(out.movedRoomIds).toEqual([]);

        // Rooms: exactly the drawn modules, one box inside its wing, none overlapping, none outside the union.
        const unionIds = new Set(union.modules.map((m) => m.id));
        const drawn = out.layout.wings.flatMap((w) => w.shownIds);
        expect([...out.layout.rooms.map((r) => r.id)].sort()).toEqual([...drawn].sort());
        for (const room of out.layout.rooms) {
          expect(unionIds.has(room.id)).toBe(true);
          const wing = out.layout.wings.find((w) => w.wing === room.wing);
          expect(wing).toBeDefined();
          const w = wing as { x: number; y: number; w: number; h: number };
          expect(room.x >= w.x && room.y >= w.y && room.x + room.w <= w.x + w.w && room.y + room.h <= w.y + w.h).toBe(true);
        }
        for (const wing of out.layout.wings) {
          const inWing = out.layout.rooms.filter((r) => r.wing === wing.wing);
          for (let i = 0; i < inWing.length; i++) {
            for (let j = i + 1; j < inWing.length; j++) {
              const a = inWing[i] as { x: number; y: number; w: number; h: number };
              const b = inWing[j] as { x: number; y: number; w: number; h: number };
              expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h).toBe(false);
            }
          }
        }

        // Doors: exactly one for each drawn union relation whose two rooms are drawn.
        const roomIds = new Set(out.layout.rooms.map((r) => r.id));
        const expectedDoors = union.drawn.filter((r) => roomIds.has(r.from) && roomIds.has(r.to)).map((r) => r.relationId).sort();
        expect(out.layout.doors.map((d) => d.relationId).sort()).toEqual(expectedDoors);
        expect(rect(out.layout.bounds).w).toBeGreaterThanOrEqual(0);
      }),
      RUNS,
    );
  }, 120_000);

  it("P10b toggle and label independence: the two views differ only as 5.1 and 5.2 tabulate, and labels change nothing (5.8)", () => {
    const ALLOWED = new Set([
      "default|default",
      "comparison-changed|comparison-changed",
      "comparison-removed|default",
      "comparison-added|hidden",
    ]);
    fc.assert(
      fc.property(arbitraryPair(), fc.string(), fc.string(), ({ before, after }, labelA, labelB) => {
        const { result } = run(before, after);
        const base: ComparisonStyle = {
          comparisonStyleVersion: 1,
          shown: "after",
          changedModules: result.changedModules,
          removedModules: result.removedModules,
          addedModules: result.addedModules,
          removedRelationIds: result.removedRelations.map((r) => r.relationId),
          addedRelationIds: result.addedRelations.map((r) => r.relationId),
          closingRelationIds: [],
          earlierLabel: before.sourceLabel,
          newerLabel: after.sourceLabel,
        };
        const targets = [
          ...[...new Set([...ids(before), ...ids(after)])].map((id) => ({ kind: "room" as const, id })),
          ...[...new Set([...rels(before), ...rels(after)])].map((id) => ({ kind: "door" as const, id })),
        ];
        for (const t of targets) {
          const newer = comparisonStateOf(base, t);
          const earlier = comparisonStateOf({ ...base, shown: "before" }, t);
          if (!ALLOWED.has(`${newer}|${earlier}`)) throw new Error(`${t.kind} ${t.id}: ${newer} / ${earlier}`);
          if (comparisonStateOf({ ...base, earlierLabel: labelA, newerLabel: labelB }, t) !== newer) throw new Error("a label changed a state");
        }
      }),
      RUNS,
    );
  });
});