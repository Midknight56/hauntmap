import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compareInvestigations } from "../../src/analysis/graph/compare";
import { findCycles } from "../../src/analysis";
import { validateComparison } from "../../src/contracts/validate";
import { expectedRefs, readJson, type Expected } from "./expected";
import { REPO, analyzeFiles, readSourcesJson } from "./loadFolder";

// 3.6: the committed sources.json files (the ones the app fetches) are analyzed by the analysis module and
// compared. The expected facts are in fixtures/manor-pair/expected.json, written by hand from the sources.
async function manorPair() {
  const read = (side: string) => readSourcesJson(join(REPO, "public", "demo", "manor", side, "sources.json"));
  const before = await analyzeFiles(read("before"), "manor/before");
  const after = await analyzeFiles(read("after"), "manor/after");
  return { before, after };
}

describe("the manor pair (3.6, matrix row 16)", () => {
  const expected = readJson<Expected>("manor-pair", "expected.json");

  it("has exactly the removed and added relation of the plan", async () => {
    const { before, after } = await manorPair();
    const outcome = compareInvestigations(before, after);
    if (!outcome.ok) throw new Error(outcome.error.message);
    const { result, detail } = outcome;
    expect(result.removedRelations).toHaveLength(1);
    expect(result.removedRelations[0]).toMatchObject({ from: "src/notifications/receipt.ts", to: "src/orders/checkout.ts" });
    expect(result.addedRelations).toHaveLength(1);
    expect(result.addedRelations[0]).toMatchObject({ from: "src/notifications/receipt.ts", to: "src/orders/summary.ts" });
    expect(result.changedModules).toEqual(["src/notifications/receipt.ts", "src/orders/checkout.ts"]);
    expect(result.addedModules).toEqual([]);
    expect(result.removedModules).toEqual([]);
    expect(result.before).toEqual({ label: "manor/before", moduleCount: 40, relationCount: 72 });
    expect(result.after).toEqual({ label: "manor/after", moduleCount: 40, relationCount: 72 });
    expect(result.cyclicComponentsBefore).toBe(1);
    expect(result.cyclicComponentsAfter).toBe(0);
    expect(validateComparison(result)).toEqual({ ok: true });
    expect(detail.identical).toBe(false);
  });

  it("matches every field of fixtures/manor-pair/expected.json", async () => {
    const { before, after } = await manorPair();
    const outcome = compareInvestigations(before, after);
    if (!outcome.ok) throw new Error(outcome.error.message);
    const { result, detail } = outcome;
    expect(result.addedModules).toEqual(expected.addedModules);
    expect(result.removedModules).toEqual(expected.removedModules);
    expect(result.changedModules).toEqual(expected.changedModules);
    expect(result.addedRelations).toEqual(expectedRefs(expected.addedRelations));
    expect(result.removedRelations).toEqual(expectedRefs(expected.removedRelations));
    expect({ moduleCount: result.before.moduleCount, relationCount: result.before.relationCount }).toEqual(expected.before);
    expect({ moduleCount: result.after.moduleCount, relationCount: result.after.relationCount }).toEqual(expected.after);
    expect(result.cyclicComponentsBefore).toBe(expected.cyclicComponentsBefore);
    expect(result.cyclicComponentsAfter).toBe(expected.cyclicComponentsAfter);
    expect(detail.occurrenceCounts).toEqual(expected.occurrenceCounts);
    expect(detail.relationChangesByModule).toEqual(expected.relationChangesByModule);
    expect(detail.optionsDiffer).toEqual(expected.optionsDiffer);
    expect(detail.parseFailed).toEqual(expected.parseFailed);
    expect(detail.identical).toBe(expected.identical);
  });

  it("agrees with the cycle report of the analysis (one loop before, none after)", async () => {
    const { before, after } = await manorPair();
    const loop = findCycles(before, "static-value").components;
    expect(loop.map((c) => c.members)).toEqual([["src/notifications/receipt.ts", "src/orders/checkout.ts", "src/payments/charge.ts"]]);
    expect(findCycles(after, "static-value").components).toEqual([]);
  });

  it("reads the same module count as the samples' own expected.json files", () => {
    for (const side of ["before", "after"]) {
      const sample = JSON.parse(readFileSync(join(REPO, "public", "demo", "manor", side, "expected.json"), "utf8")) as { modules: unknown[]; imports: unknown[] };
      expect(sample.modules).toHaveLength(40);
      expect(sample.imports).toHaveLength(72);
    }
  });
});