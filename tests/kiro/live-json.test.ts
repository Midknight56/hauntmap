import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compareInvestigations } from "../../src/analysis/graph/compare";
import { validateInvestigation } from "../../src/contracts/validate";
import type { Investigation } from "../../src/contracts/types";
import { loadSourceSet, resolveRoot, sha256Hex } from "../../packages/hauntmap-mcp/src/loader";
import { analyze, DEFAULT_ANALYSIS_OPTIONS } from "../../src/analysis/index";
import { DEMO_RELATION_ID, expectedManor, REPO } from "./appPath";

// Requirements 6.7 and 9.5: the committed public/demo/live.json (written at task 7, replaced at
// task 12).

const LIVE = join(REPO, "public", "demo", "live.json");
const SESSION = join(REPO, "docs", "acceptance", "h9-session");

describe("6.7 public/demo/live.json", () => {
  it("exists, validates, carries the live label and has only modules of the manor wings", () => {
    expect(existsSync(LIVE)).toBe(true);
    const live = JSON.parse(readFileSync(LIVE, "utf8")) as Investigation;
    expect(validateInvestigation(live)).toEqual({ ok: true });
    expect(live.sourceLabel).toBe("live:haunts/manor");
    expect(live.modules).toHaveLength(expectedManor().modules.length);
    const wings = Object.keys(expectedManor().wings);
    for (const module of live.modules) {
      const match = /^src\/([^/]+)\/[^/]+$/.exec(module.id);
      expect(match, module.id).not.toBeNull();
      expect(wings, module.id).toContain(match?.[1]);
    }
    expect(JSON.stringify(live)).not.toContain('"text"');
  });
});

describe("9.5 the recorded session", () => {
  // The session copy is a record: it keeps the sourceLabel it was written with, from before the working folder was renamed. Every other field must still match.
  it.skipIf(!existsSync(join(SESSION, "live.json")))("the session copy equals the committed live.json in every field except sourceLabel", () => {
    const record = JSON.parse(readFileSync(join(SESSION, "live.json"), "utf8")) as Investigation;
    const live = JSON.parse(readFileSync(LIVE, "utf8")) as Investigation;
    expect({ ...record, sourceLabel: live.sourceLabel }).toEqual(live);
  });

  it.skipIf(!existsSync(join(SESSION, "live.json")))("comparing the analysis of manor/before with the committed file removes exactly the demo relation", async () => {
    const resolved = await resolveRoot(REPO, "public/demo/manor/before");
    if (!resolved.ok) throw new Error(resolved.error.message);
    const loaded = await loadSourceSet(resolved.root, DEFAULT_ANALYSIS_OPTIONS);
    if (!loaded.ok) throw new Error(loaded.error.message);
    const before = await analyze(loaded.sourceSet, DEFAULT_ANALYSIS_OPTIONS, sha256Hex, undefined, loaded.diagnostics);
    const live = JSON.parse(readFileSync(LIVE, "utf8")) as Investigation;
    const compared = compareInvestigations(before, live);
    if (!compared.ok) throw new Error(compared.error.message);
    expect(compared.result.removedRelations.map((r) => r.relationId)).toEqual([DEMO_RELATION_ID]);
    expect(compared.result.addedRelations).toEqual([]);
  });
});
