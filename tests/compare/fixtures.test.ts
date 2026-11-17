import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { validateInvestigation } from "../../src/contracts/validate";
import type { Investigation } from "../../src/contracts/types";
import { FIXTURE_NAMES } from "./expected";
import { arbitraryOccurrenceOnlyPair, arbitraryPair, expectedDiff, makeInvestigation, mutate, perf1000, resolveMutations } from "./generators";
import { FIXTURES, nodeSha256, readFolder } from "./loadFolder";
import { createHarness, openManorBefore } from "./storeHarness";

function load(name: string, side: "before" | "after"): Investigation {
  return JSON.parse(readFileSync(join(FIXTURES, name, `${side}.json`), "utf8")) as Investigation;
}

// Counted by hand from the table of design.md: modules before/after, distinct relation IDs before/after.
const COUNTS: Record<(typeof FIXTURE_NAMES)[number], { modules: [number, number]; relations: [number, number] }> = {
  "comment-shift": { modules: [2, 2], relations: [1, 1] },
  "duplicate-occurrence": { modules: [2, 2], relations: [1, 1] },
  rename: { modules: [2, 2], relations: [1, 1] },
  "cycle-closes": { modules: [2, 2], relations: [2, 1] },
  "boundary-change": { modules: [1, 2], relations: [2, 2] },
  identical: { modules: [2, 2], relations: [1, 1] },
  "options-mismatch": { modules: [2, 2], relations: [1, 1] },
  "parse-failure": { modules: [2, 2], relations: [1, 0] },
  escaped: { modules: [1, 1], relations: [0, 1] },
};

const FROM_SOURCE = ["comment-shift", "duplicate-occurrence", "rename", "escaped"] as const;

describe("fixtures load", () => {
  for (const name of FIXTURE_NAMES) {
    it(`${name}: both sides are valid investigations with the counts of design.md`, () => {
      const before = load(name, "before");
      const after = load(name, "after");
      for (const inv of [before, after]) {
        expect(inv.schemaVersion).toBe(1);
        expect(inv.resolverMode).toBe("documented-source-subset");
        expect(validateInvestigation(inv)).toEqual({ ok: true });
      }
      const counts = COUNTS[name];
      expect([before.modules.length, after.modules.length]).toEqual(counts.modules);
      expect([new Set(before.imports.map((r) => r.relationId)).size, new Set(after.imports.map((r) => r.relationId)).size]).toEqual(counts.relations);
      const expected = JSON.parse(readFileSync(join(FIXTURES, name, "expected.json"), "utf8")) as {
        expectedVersion: number;
        before: { moduleCount: number; relationCount: number };
        after: { moduleCount: number; relationCount: number };
      };
      expect(expected.expectedVersion).toBe(1);
      expect([expected.before.moduleCount, expected.after.moduleCount]).toEqual(counts.modules);
      expect([expected.before.relationCount, expected.after.relationCount]).toEqual(counts.relations);
    });
  }

  it("the manor pair expected.json has the counts of design.md", () => {
    const expected = JSON.parse(readFileSync(join(FIXTURES, "manor-pair", "expected.json"), "utf8")) as {
      expectedVersion: number;
      before: { moduleCount: number; relationCount: number };
      after: { moduleCount: number; relationCount: number };
      cyclicComponentsBefore: number;
      cyclicComponentsAfter: number;
    };
    expect(expected.expectedVersion).toBe(1);
    expect(expected.before).toEqual({ moduleCount: 40, relationCount: 72 });
    expect(expected.after).toEqual({ moduleCount: 40, relationCount: 72 });
    expect([expected.cyclicComponentsBefore, expected.cyclicComponentsAfter]).toEqual([1, 0]);
  });

  for (const name of FROM_SOURCE) {
    for (const side of ["before", "after"] as const) {
      const dir = join(FIXTURES, name, "src", side);
      if (!existsSync(dir)) continue;
      it(`${name}/${side}: every source file hashes to the listed sourceHash`, async () => {
        const inv = load(name, side);
        const files = readFolder(dir, ".txt");
        expect(files.length).toBeGreaterThan(0);
        for (const file of files) {
          const record = inv.modules.find((m) => m.id === file.path);
          expect(record, `${file.path} has a module record`).toBeDefined();
          expect(await nodeSha256(file.text)).toBe(record?.sourceHash);
          expect(file.text.includes("\r")).toBe(false);
          expect(file.text.endsWith("\n")).toBe(true);
        }
      });
    }
  }

  it("escaped: the module text is 120 bytes", () => {
    const [file] = readFolder(join(FIXTURES, "escaped", "src", "after"), ".txt");
    expect(file?.path).toBe("src/a&b.ts");
    expect(file?.bytes).toBe(120);
  });
});

describe("generator self-checks", () => {
  it("expectedDiff of an empty mutation list is empty", () => {
    const base = makeInvestigation({ modules: 30, wings: 3, relationsPerModule: 2, boundaryShare: 0.1, seed: 7 });
    expect(expectedDiff(base, [])).toEqual({
      addedModules: [],
      removedModules: [],
      changedModules: [],
      addedRelationIds: [],
      removedRelationIds: [],
    });
    expect(mutate(base, [])).toEqual({ ...base, sourceLabel: `${base.sourceLabel}+after` });
  });

  it("perf1000 has 1,000 modules in 40 wings of 25 and 3,000 relations", () => {
    const inv = perf1000();
    expect(inv.modules).toHaveLength(1000);
    const wings = new Map<string, number>();
    for (const m of inv.modules) wings.set(m.id.slice(0, m.id.lastIndexOf("/")), (wings.get(m.id.slice(0, m.id.lastIndexOf("/"))) ?? 0) + 1);
    expect(wings.size).toBe(40);
    expect([...wings.values()].every((n) => n === 25)).toBe(true);
    expect(inv.imports).toHaveLength(3000);
    expect(new Set(inv.imports.map((r) => r.relationId)).size).toBe(3000);
    expect(validateInvestigation(inv)).toEqual({ ok: true });
  });

  it("the same seed gives the same investigation", () => {
    const spec = { modules: 20, wings: 4, relationsPerModule: 3, boundaryShare: 0.2, seed: 99 };
    expect(makeInvestigation(spec)).toEqual(makeInvestigation(spec));
    expect(makeInvestigation({ ...spec, seed: 100 })).not.toEqual(makeInvestigation(spec));
  });

  it("each mutation has its documented effect", () => {
    const base = makeInvestigation({ modules: 12, wings: 2, relationsPerModule: 2, boundaryShare: 0, seed: 3 });
    const first = base.imports[0];
    const mod = base.modules[1];
    if (first === undefined || mod === undefined) throw new Error("generator produced no imports");
    expect(expectedDiff(base, [{ kind: "removeRelation", relationId: first.relationId }]).removedRelationIds).toEqual([first.relationId]);
    expect(expectedDiff(base, [{ kind: "changeHash", id: mod.id }]).changedModules).toEqual([mod.id]);
    const shifted = mutate(base, [{ kind: "shiftLines", id: first.from, by: 5 }]);
    expect(shifted.imports.filter((r) => r.from === first.from).every((r) => r.line >= 6)).toBe(true);
    expect(expectedDiff(base, [{ kind: "shiftLines", id: first.from, by: 5 }])).toEqual(expectedDiff(base, []));
    const dup = mutate(base, [{ kind: "duplicateOccurrence", relationId: first.relationId }]);
    expect(dup.imports.filter((r) => r.relationId === first.relationId)).toHaveLength(2);
    expect(expectedDiff(base, [{ kind: "duplicateOccurrence", relationId: first.relationId }])).toEqual(expectedDiff(base, []));
    expect(expectedDiff(base, [{ kind: "removeModule", id: mod.id }]).removedModules).toEqual([mod.id]);
    expect(expectedDiff(base, [{ kind: "addModule", id: "src/new/added.ts" }]).addedModules).toEqual(["src/new/added.ts"]);
    const renamed = expectedDiff(base, [{ kind: "renameModule", id: mod.id, to: "src/new/renamed.ts" }]);
    expect(renamed.removedModules).toEqual([mod.id]);
    expect(renamed.addedModules).toEqual(["src/new/renamed.ts"]);
  });

  it("generated pairs are valid investigations and resolved mutations apply", () => {
    fc.assert(
      fc.property(arbitraryPair(), ({ before, after, mutations }) => {
        expect(validateInvestigation(before)).toEqual({ ok: true });
        expect(validateInvestigation(after)).toEqual({ ok: true });
        expect(mutations.length).toBeLessThanOrEqual(12);
        expect(resolveMutations(before, mutations)).toEqual(mutations);
      }),
      { numRuns: 50 },
    );
    fc.assert(
      fc.property(arbitraryOccurrenceOnlyPair(), ({ before, after, mutations }) => {
        expect(mutations.every((m) => ["shiftLines", "duplicateOccurrence", "dropDuplicate", "changeHash"].includes(m.kind))).toBe(true);
        expect(after.modules.map((m) => m.id)).toEqual(before.modules.map((m) => m.id));
        expect(new Set(after.imports.map((r) => r.relationId))).toEqual(new Set(before.imports.map((r) => r.relationId)));
      }),
      { numRuns: 50 },
    );
  });
});
describe("store harness", () => {
  it("opens manor/before in the real investigation store and records the layout request", async () => {
    const h = createHarness();
    const inv = await openManorBefore(h);
    const state = h.store.getState();
    expect(state.investigation).toBe(inv);
    expect(state.layoutStatus).toBe("idle");
    expect(state.layout?.rooms.length).toBeGreaterThan(0);
    expect(h.layoutClient.requests).toHaveLength(1);
    expect(h.fetcher.urls).toEqual(["/demo/manor/before/sources.json"]);
  });
});