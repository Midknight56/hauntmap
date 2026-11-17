import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_ANALYSIS_OPTIONS, analyze, selectSources } from "../../src/analysis";
import type { Investigation, SourceFile } from "../../src/contracts/types";

export const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

export const nodeSha256 = async (text: string): Promise<string> => createHash("sha256").update(text, "utf8").digest("hex");

function walk(dir: string, prefix: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) walk(join(dir, entry.name), rel, out);
    else out.push(rel);
  }
}

/**
 * Read a folder into source files: forward slashes, sorted paths, `bytes` the UTF-8 length.
 * `stripSuffix` removes a suffix from every path (the fixture sources carry `.txt`, so that the
 * repository's typecheck and lint never see them as code).
 */
export function readFolder(dir: string, stripSuffix = ""): SourceFile[] {
  const paths: string[] = [];
  walk(dir, "", paths);
  return paths
    .map((path) => ({ path, name: stripSuffix !== "" && path.endsWith(stripSuffix) ? path.slice(0, -stripSuffix.length) : path }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map(({ path, name }) => {
      const text = readFileSync(join(dir, ...path.split("/")), "utf8");
      return { path: name, text, bytes: Buffer.byteLength(text, "utf8") };
    });
}

/** The `{ files: [{ path, text }] }` body that the app fetches, as source files. */
export function readSourcesJson(path: string): SourceFile[] {
  const body = JSON.parse(readFileSync(path, "utf8")) as { files: { path: string; text: string }[] };
  return body.files.map((f) => ({ path: f.path, text: f.text, bytes: Buffer.byteLength(f.text, "utf8") }));
}

/** Classify with `selectSources` (never re-implemented here) and analyze with the default options. */
export async function analyzeFiles(files: SourceFile[], label: string): Promise<Investigation> {
  const selected = selectSources(files, label, DEFAULT_ANALYSIS_OPTIONS);
  if (!selected.ok) throw new Error(`selectSources refused ${label}: ${selected.diagnostics.map((d) => d.message).join("; ")}`);
  return analyze(selected.sourceSet, DEFAULT_ANALYSIS_OPTIONS, nodeSha256, undefined, selected.diagnostics);
}

export function analyzeFolder(dir: string, label: string, stripSuffix = ""): Promise<Investigation> {
  return analyzeFiles(readFolder(dir, stripSuffix), label);
}

/** The source map the app keeps for a snapshot: path to text. */
export function sourceMapOf(files: SourceFile[]): Map<string, string> {
  return new Map(files.map((f) => [f.path, f.text] as const));
}
