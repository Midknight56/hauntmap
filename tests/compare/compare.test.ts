import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { codeUnitCompare, compareInvestigations, distinctRelationCount, relationIndex, type CompareOutcome } from "../../src/analysis/graph/compare";
import type { Investigation } from "../../src/contracts/types";
import { validateComparison } from "../../src/contracts/validate";
import { FIXTURE_NAMES, expectedRefs, loadFixture as load, type Expected } from "./expected";
import { mutate, mulberry32, perf1000 } from "./generators";
import { FIXTURES, analyzeFolder } from "./loadFolder";

function ok(outcome: CompareOutcome) {
  if (!outcome.ok) throw new Error(`compare failed: ${outcome.error.message}`);
  return outcome;
}

function assertAgainst(outcome: CompareOutcome, expected: Expected): void {
  const { result, detail } = ok(outcome);
  expect(result.schemaVersion).toBe(1);
  expect(result.preset).toBe("static-value");
  expect(result.addedModules).toEqual(expected.addedModules);
  expect(result.removedModules).toEqual(expected.removedModules);
  expect(result.changedModules).toEqual(expected.changedModules);
  expect(result.addedRelations).toEqual(expectedRefs(expected.addedRelations));
  expect(result.removedRelations).toEqual(expectedRefs(expected.removedRelations));
  expect(result.before.moduleCount).toBe(expected.before.moduleCount);
  expect(result.before.relationCount).toBe(expected.before.relationCount);
  expect(result.after.moduleCount).toBe(expected.after.moduleCount);
  expect(result.after.relationCount).toBe(expected.after.relationCount);
  expect(result.cyclicComponentsBefore).toBe(expected.cyclicComponentsBefore);
  expect(result.cyclicComponentsAfter).toBe(expected.cyclicComponentsAfter);
  expect(detail.occurrenceCounts).toEqual(expected.occurrenceCounts);
  expect(detail.relationChangesByModule).toEqual(expected.relationChangesByModule);
  expect(detail.optionsDiffer).toEqual(expected.optionsDiffer);
  expect(detail.parseFailed).toEqual(expected.parseFailed);
  expect(detail.identical).toBe(expected.identical);
  expect(validateComparison(result)).toEqual({ ok: true });
}

function shuffled<T>(list: readonly T[], seed: number): T[] {
  const rand = mulberry32(seed);
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
}

const permute = (inv: Investigation, seed: number): Investigation => ({ ...inv, modules: shuffled(inv.modules, seed), imports: shuffled(inv.imports, seed + 1) });

describe("compareInvestigations on the fixtures (3.1, 3.3, 3.4, 3.5, 3.7, 3.8, 2.3, 2.4, 2.5)", () => {
  for (const name of FIXTURE_NAMES) {
    it(`${name}: every field equals its hand-written expected.json`, () => {
      const { before, after, expected } = load(name);
      assertAgainst(compareInvestigations(before, after), expected);
    });

    it(`${name}: shuffled inputs give a deep-equal outcome (3.2)`, () => {
      const { before, after } = load(name);
      const plain = compareInvestigations(before, after);
      expect(compareInvestigations(permute(before, 5), permute(after, 9))).toEqual(plain);
    });
  }

  it("every list is sorted by code unit order, not by locale (3.2)", () => {
    const { before, after } = load("rename");
    const { result } = ok(compareInvestigations(before, after));
    for (const list of [result.addedModules, result.removedModules, result.changedModules]) {
      expect(list).toEqual([...list].sort(codeUnitCompare));
    }
    expect(codeUnitCompare("B", "a")).toBe(-1);
    expect(codeUnitCompare("a", "a")).toBe(0);
    expect(codeUnitCompare("b", "a")).toBe(1);
  });

  it("boundary-change: the removed ref keeps to: null and its original specifier (3.3)", () => {
    const { before, after } = load("boundary-change");
    const { result } = ok(compareInvestigations(before, after));
    expect(result.removedRelations).toEqual([
      {
        from: "src/app.ts",
        to: null,
        specifier: "./ghosts/missing",
        syntaxKind: "import",
        dependencyKind: "value",
        resolution: "unresolved",
        relationId: JSON.stringify(["src/app.ts", ["unresolved", "./ghosts/missing"], "import", "value"]),
      },
    ]);
  });

  it("comment-shift: the occurrence ID differs and the relation ID is equal (3.4, matrix row 23)", () => {
    const { before, after } = load("comment-shift");
    expect(before.imports[0]?.occurrenceId).not.toBe(after.imports[0]?.occurrenceId);
    expect(before.imports[0]?.relationId).toBe(after.imports[0]?.relationId);
    const { result } = ok(compareInvestigations(before, after));
    expect(result.changedModules).toEqual(["src/a.ts"]);
    expect(result.addedRelations).toEqual([]);
    expect(result.removedRelations).toEqual([]);
  });

  it("duplicate-occurrence: two statements are one relation (3.5, matrix row 24)", () => {
    const { before, after } = load("duplicate-occurrence");
    const { result, detail } = ok(compareInvestigations(before, after));
    expect(result.removedRelations).toEqual([]);
    expect(result.changedModules).toEqual(["src/a.ts"]);
    expect(detail.occurrenceCounts["src/a.ts"]).toEqual({ before: 2, after: 1 });
    expect(distinctRelationCount(before)).toBe(1);
    expect(relationIndex(before).get(before.imports[0]?.relationId as string)?.map((r) => r.line)).toEqual([1, 2]);
  });

  it("identical: other labels, no other difference (2.1, 2.5)", () => {
    const { before, after } = load("identical");
    expect(before.sourceLabel).toBe("local:manor-before");
    expect(after.sourceLabel).toBe("local:manor-after");
    const { result, detail } = ok(compareInvestigations(before, after));
    expect(result.before.label).toBe("local:manor-before");
    expect(result.after.label).toBe("local:manor-after");
    expect(detail.identical).toBe(true);
    expect(detail.common).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("options-mismatch: optionsDiffer is includeExtensions, the comparison still runs (2.3)", () => {
    const { before, after } = load("options-mismatch");
    const { detail } = ok(compareInvestigations(before, after));
    expect(detail.optionsDiffer).toEqual(["includeExtensions"]);
  });

  it("parse-failure: the failed side is named and its relations read as removed (2.4)", () => {
    const { before, after } = load("parse-failure");
    const { result, detail } = ok(compareInvestigations(before, after));
    expect(detail.parseFailed).toEqual([{ id: "src/a.ts", side: "after" }]);
    expect(result.removedRelations).toHaveLength(1);
    const flipped = ok(compareInvestigations(after, before));
    expect(flipped.detail.parseFailed).toEqual([{ id: "src/a.ts", side: "before" }]);
  });

  it("returns an incompatible-schema error with the exact message, the earlier snapshot checked first (2.2)", () => {
    const { before, after } = load("comment-shift");
    const bad = { ...after, schemaVersion: 2 } as unknown as Investigation;
    expect(compareInvestigations(before, bad)).toEqual({ ok: false, error: { code: "incompatible-schema", message: "schema version 2 is not 1" } });
    const worse = { ...before, schemaVersion: 3 } as unknown as Investigation;
    expect(compareInvestigations(worse, bad)).toEqual({ ok: false, error: { code: "incompatible-schema", message: "schema version 3 is not 1" } });
  });

  it("returns an incompatible-resolver error with the exact message (2.2)", () => {
    const { before, after } = load("comment-shift");
    const bad = { ...after, resolverMode: "typescript" } as unknown as Investigation;
    expect(compareInvestigations(before, bad)).toEqual({
      ok: false,
      error: { code: "incompatible-resolver", message: 'resolver mode "typescript" is not "documented-source-subset"' },
    });
  });
});

describe("compareInvestigations from source (the comparison recomputes both graphs)", () => {
  for (const name of ["comment-shift", "duplicate-occurrence", "rename"] as const) {
    it(`${name}: the analyzer's investigations compare as the hand-written expected.json says`, async () => {
      const dir = (side: string): string => join(FIXTURES, name, "src", side);
      const before = await analyzeFolder(dir("before"), `${name}/before`, ".txt");
      const after = await analyzeFolder(dir("after"), `${name}/after`, ".txt");
      assertAgainst(compareInvestigations(before, after), load(name).expected);
    });
  }
});

describe("compare performance (3.9)", () => {
  it("compares two 1,000-module, 3,000-relation investigations; the figure is printed", () => {
    const before = perf1000();
    const after = mutate(before, [
      { kind: "removeRelation", relationId: before.imports[10]?.relationId as string },
      { kind: "changeHash", id: before.modules[5]?.id as string },
      { kind: "addModule", id: "src/new/added.ts" },
    ]);
    const started = performance.now();
    const outcome = compareInvestigations(before, after);
    const ms = performance.now() - started;
    expect(outcome.ok).toBe(true);
    const target = process.env["HAUNTMAP_PERF_DEVICE"] !== undefined;
    console.log(`compareInvestigations perf1000: ${ms.toFixed(1)} ms (HAUNTMAP_PERF_DEVICE ${target ? "set" : "not set"}; ceiling 5000 ms, target 500 ms)`);
    expect(ms).toBeLessThan(5000);
    if (target) expect(ms).toBeLessThan(500);
  });
});
