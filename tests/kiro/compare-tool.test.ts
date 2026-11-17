import { rmSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compareInvestigations } from "../../src/analysis/graph/compare";
import { validateComparison } from "../../src/contracts/validate";
import { analyzeTool, compareTool, createContext } from "../../packages/hauntmap-mcp/src/tools";
import { appInvestigation, DEMO_RELATION_ID, expectedManor, packedFiles, repoTemp, REPO } from "./appPath";
import { makeManorAfterRemoval } from "./generators";

// Requirements 4.1, 4.2, 4.5 and 4.6.

const expected = expectedManor();
const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** manor-after-removal inside the workspace (under .hauntmap/), returned as a root relative to it. */
function removalRoot(): string {
  const parent = repoTemp("compare-");
  temporary.push(parent);
  makeManorAfterRemoval(REPO, join(parent, "manor-after-removal"));
  return relative(REPO, join(parent, "manor-after-removal")).replace(/\\/g, "/");
}

describe("compare", () => {
  const ctx = createContext(REPO);

  it("4.2 the removal copy removes exactly the demo relation", async () => {
    const after = removalRoot();
    const result = await compareTool(ctx, { rootBefore: "public/demo/manor/before", rootAfter: after });
    if (!result.ok) throw new Error(result.error.message);
    const value = result.value;
    expect(value.removedRelations.map((r) => r.relationId)).toEqual([DEMO_RELATION_ID]);
    expect(value.addedRelations).toEqual([]);
    expect(value.removedModules).toEqual([]);
    expect(value.addedModules).toEqual([]);
    expect(value.changedModules).toEqual(["src/notifications/receipt.ts"]);
    expect(value.before.moduleCount).toBe(expected.modules.length);
    expect(value.after.moduleCount).toBe(expected.modules.length);
    expect(value.before.relationCount).toBe(expected.imports.length);
    expect(value.after.relationCount).toBe(expected.imports.length - 1);
    expect(value.cyclicComponentsBefore).toBe(expected.cycles["static-value"].length);
    expect(value.cyclicComponentsAfter).toBe(0);
    expect(validateComparison(value)).toEqual({ ok: true });
  });

  it("4.1 the labels are the two source labels", async () => {
    const after = removalRoot();
    const result = await compareTool(ctx, { rootBefore: "./public/demo/manor/before/", rootAfter: after });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.before.label).toBe("live:public/demo/manor/before");
    expect(result.value.after.label).toBe(`live:${after}`);
  });

  it("4.6 the result equals a direct compareInvestigations call and is not re-sorted", async () => {
    const after = removalRoot();
    const result = await compareTool(ctx, { rootBefore: "public/demo/manor/before", rootAfter: after });
    const before = await analyzeTool(ctx, { root: "public/demo/manor/before" });
    const newer = await analyzeTool(ctx, { root: after });
    if (!result.ok || !before.ok || !newer.ok) throw new Error("tools failed");
    const direct = compareInvestigations(before.value, newer.value);
    if (!direct.ok) throw new Error(direct.error.message);
    expect(result.value).toEqual(direct.result);
    expect(result.value).not.toHaveProperty("detail");
    // the app's own path gives the same relation lists (matrix row 27, programmatic)
    const appBefore = await appInvestigation(packedFiles("manor/before"), "live:public/demo/manor/before");
    expect(appBefore.imports.map((i) => i.relationId).sort()).toEqual(before.value.imports.map((i) => i.relationId).sort());
  });

  it("4.1 an { ok: false } outcome of the comparison becomes analysis-failed", async () => {
    const stub = createContext(REPO, {
      analysis: { ...ctx.analysis, compareInvestigations: () => ({ ok: false, error: { code: "incompatible-schema", message: "schemaVersion differs" } }) },
    });
    expect(await compareTool(stub, { rootBefore: "public/demo/manor/before", rootAfter: "haunts/manor" })).toEqual({
      ok: false,
      error: { code: "analysis-failed", message: "The snapshots cannot be compared: schemaVersion differs." },
    });
  });

  it("4.5 a root failure names the side and returns no comparison", async () => {
    const before = await compareTool(ctx, { rootBefore: "nope", rootAfter: "haunts/manor" });
    expect(before).toEqual({ ok: false, error: { code: "root-not-found", message: 'rootBefore: Root "nope" does not exist or is not a directory.' } });
    const after = await compareTool(ctx, { rootBefore: "haunts/manor", rootAfter: ".." });
    expect(after.ok === false && after.error.code).toBe("root-outside-workspace");
    expect(after.ok === false && after.error.message.startsWith("rootAfter: ")).toBe(true);
  });

  it("4.1 both sides are analyzed under static-value", async () => {
    const result = await compareTool(ctx, { rootBefore: "haunts/manor", rootAfter: "haunts/manor" });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.preset).toBe("static-value");
    expect(result.value.removedRelations).toEqual([]);
    expect(result.value.addedRelations).toEqual([]);
  });
});

describe("compare without compare.ts", () => {
  it("returns the precondition message while compareInvestigations is not wired", async () => {
    const base = createContext(REPO);
    const without = createContext(REPO, { analysis: { ...base.analysis, compareInvestigations: undefined } });
    expect(await compareTool(without, { rootBefore: "haunts/manor", rootAfter: "haunts/manor" })).toEqual({
      ok: false,
      error: { code: "analysis-failed", message: "compare is not available until snapshot-comparison lands" },
    });
  });
});
