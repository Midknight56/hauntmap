import { readFileSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ComparisonResult, Investigation, SourceFile } from "../src/contracts/types";
import { main } from "../packages/hauntmap-mcp/src/cli";
import { appInvestigation, DEMO_RELATION_ID, packedFiles, REPO, repoTemp } from "./kiro/appPath";
import { makeManorAfterRemoval } from "./kiro/generators";
import { RpcProcess } from "./kiro/rpc";

// Matrix rows 26 and 27. The Node route (CLI and MCP server over the loader) and the app route
// (packed sources, selectSources, analyze with Web Crypto) must agree on the same files.

const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function firstDifference(a: string[], b: string[]): string {
  const index = a.findIndex((value, i) => value !== b[i]);
  return index >= 0 ? `first difference at ${index}: ${a[index] ?? "(none)"} versus ${b[index] ?? "(none)"}` : `lengths ${a.length} and ${b.length}`;
}

async function cliAnalyze(root: string, out: string): Promise<Investigation> {
  const code = await main(["analyze", root, "--out", out], { cwd: REPO, stdout: () => undefined, stderr: () => undefined });
  if (code !== 0) throw new Error(`hauntmap analyze ${root} exited with ${code}`);
  return JSON.parse(readFileSync(out, "utf8")) as Investigation;
}

describe("row 26", () => {
  it("the CLI on samples/manor and the app path on manor/before sources agree on module IDs, hashes and relation IDs", async () => {
    const dir = repoTemp("agree-");
    temporary.push(dir);
    const node = await cliAnalyze("samples/manor", join(dir, "live.json"));
    const app = await appInvestigation(packedFiles("manor/before"), "manor/before");

    const nodeIds = node.modules.map((m) => m.id);
    const appIds = app.modules.map((m) => m.id);
    expect(nodeIds, firstDifference(nodeIds, appIds)).toEqual(appIds);
    expect(nodeIds).toEqual([...nodeIds].sort());

    const nodeHashes = node.modules.map((m) => `${m.id} ${m.sourceHash}`);
    const appHashes = app.modules.map((m) => `${m.id} ${m.sourceHash}`);
    expect(nodeHashes, firstDifference(nodeHashes, appHashes)).toEqual(appHashes);

    const nodeRelations = node.imports.map((i) => i.relationId).sort();
    const appRelations = app.imports.map((i) => i.relationId).sort();
    expect(nodeRelations, firstDifference(nodeRelations, appRelations)).toEqual(appRelations);
    expect(new Set(nodeRelations).size).toBe(72);
  });
});

describe("row 27 programmatic", () => {
  it("MCP compare through the server boundary equals the app path, relation by relation, in order", async () => {
    const dir = repoTemp("agree-");
    temporary.push(dir);
    const after = makeManorAfterRemoval(REPO, join(dir, "manor-after-removal"));
    const afterRoot = relative(REPO, after).replace(/\\/g, "/");

    const server = new RpcProcess(join(REPO, "packages", "hauntmap-mcp", "dist", "index.js"), REPO);
    try {
      await server.initialize();
      const response = await server.request("tools/call", { name: "compare", arguments: { rootBefore: "public/demo/manor/before", rootAfter: afterRoot } });
      const result = response.result as { isError?: boolean; content: { text: string }[] };
      expect(result.isError).not.toBe(true);
      const mcp = JSON.parse(result.content[0]?.text ?? "") as ComparisonResult;

      const afterFiles: SourceFile[] = [];
      for (const file of packedFiles("manor/before")) {
        const text = readFileSync(join(after, ...file.path.split("/")), "utf8");
        afterFiles.push({ path: file.path, text, bytes: new TextEncoder().encode(text).length });
      }
      const appBefore = await appInvestigation(packedFiles("manor/before"), "live:public/demo/manor/before");
      const appAfter = await appInvestigation(afterFiles, `live:${afterRoot}`);
      const { compareInvestigations } = await import("../src/analysis/graph/compare");
      const compared = compareInvestigations(appBefore, appAfter);
      if (!compared.ok) throw new Error(compared.error.message);

      expect(mcp.removedRelations).toEqual(compared.result.removedRelations);
      expect(mcp.addedRelations).toEqual(compared.result.addedRelations);
      expect(mcp.removedRelations.map((r) => r.relationId)).toEqual([DEMO_RELATION_ID]);
      expect(mcp.addedRelations).toEqual([]);
    } finally {
      await server.close();
    }
  });
});
