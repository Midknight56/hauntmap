import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeRoot, createContext } from "../../packages/hauntmap-mcp/src/tools";
import { DEFAULT_ANALYSIS_OPTIONS } from "../../src/contracts/options";
import type { Investigation, SourceFile } from "../../src/contracts/types";
import { readAll } from "../../src/features/import/readFiles";
import { classify, stripRoot } from "../../src/features/import/review";
import type { Candidate } from "../../src/features/import/review";
import { runRequest } from "../../src/workers/analysis.worker";
import type { WorkerReply } from "../../src/workers/client";
import { folderOf } from "./generators";
import { filesOfManifest, readManifest, writeManifest } from "./materialize";
import type { Manifest } from "./materialize";

// I2: the investigation the browser pipeline makes from a folder equals the one the command line tool
// makes from the same folder, byte for byte, except for sourceLabel (`local:<folder>` against `live:.`).

const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** classify, readAll, then the analysis worker's own entry, exactly as the dialog does it (3.4). */
async function browserInvestigation(manifest: Manifest): Promise<Investigation> {
  const stripped = filesOfManifest(manifest).map((file) => ({ file, ...stripRoot(file.webkitRelativePath) }));
  const candidates: Candidate[] = stripped.map(({ file, path }) => ({ path, size: file.size, file }));
  const review = classify(manifest.folder, candidates, DEFAULT_ANALYSIS_OPTIONS);
  const read = await readAll(
    review.included.map((candidate) => ({ path: candidate.path, file: candidate.file as File })),
    { delayMs: 0, now: () => 0, onProgress: () => undefined },
  );
  const sizes = new Map(candidates.map((candidate) => [candidate.path, candidate.size]));
  const oversized: SourceFile[] = review.skipped.filter((entry) => entry.reason === "oversized").map((entry) => ({ path: entry.path, text: "", bytes: sizes.get(entry.path) ?? 0 }));
  const replies: WorkerReply[] = [];
  await runRequest(
    { requestId: "parity", revision: 1, kind: "analyze", payload: { files: [...read.files, ...oversized], rootLabel: `local:${manifest.folder}`, options: { ...DEFAULT_ANALYSIS_OPTIONS, preset: "static-value" } } },
    (reply) => replies.push(reply),
  );
  const result = replies.find((reply) => reply.kind === "result");
  if (result?.kind !== "result") throw new Error(`no result: ${JSON.stringify(replies.at(-1))}`);
  return result.investigation;
}

async function nodeInvestigation(manifest: Manifest): Promise<Investigation> {
  const parent = mkdtempSync(join(tmpdir(), "hauntmap-parity-"));
  temporary.push(parent);
  const folder = realpathSync(writeManifest(manifest, parent));
  const result = await analyzeRoot(createContext(folder), ".", "static-value");
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function text(investigation: Investigation): string {
  return JSON.stringify({ ...investigation, sourceLabel: "label" });
}

describe("parity with the command line tool (I2)", () => {
  it("the fixture folder gives the same JSON text from the browser pipeline and from analyzeRoot, except sourceLabel", async () => {
    const manifest = readManifest("folder");
    const browser = await browserInvestigation(manifest);
    const node = await nodeInvestigation(manifest);
    expect(browser.sourceLabel).toBe("local:sample-local");
    expect(node.sourceLabel).toBe("live:.");
    expect(browser.modules).toHaveLength(3);
    expect(browser.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.module])).toEqual([["oversized", "big.ts"]]);
    expect(text(browser)).toBe(text(node));
  });

  it("a generated folder of 30 files agrees too", async () => {
    const manifest = folderOf(30);
    const browser = await browserInvestigation(manifest);
    const node = await nodeInvestigation(manifest);
    expect(browser.modules).toHaveLength(30);
    expect(text(browser)).toBe(text(node));
  });
});
