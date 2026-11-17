import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyze, DEFAULT_ANALYSIS_OPTIONS, selectSources } from "../../src/analysis/index";
import type { HashFn } from "../../src/analysis/index";
import type { Investigation, Preset, SourceFile } from "../../src/contracts/types";

// The app's route to an Investigation, as the analysis worker takes it: SourceFiles from a
// packed folder (public/demo/<sample>/sources.json), selectSources, then analyze with a Web
// Crypto hash. The Node loader of the package is compared against this (matrix rows 26 and 27).

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const webCryptoHash: HashFn = async (text) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

export function readJson<T>(...parts: string[]): T {
  return JSON.parse(readFileSync(join(REPO, ...parts), "utf8")) as T;
}

/** SourceFiles of a packed sample, with `bytes` equal to the UTF-8 length of each text. */
export function packedFiles(sample: string): SourceFile[] {
  const packed = readJson<{ files: { path: string; text: string }[] }>("public", "demo", ...sample.split("/"), "sources.json");
  return packed.files.map((file) => ({ path: file.path, text: file.text, bytes: new TextEncoder().encode(file.text).length }));
}

/** The app path: selectSources and analyze on `files`. Throws when selectSources hits a cap. */
export async function appInvestigation(files: SourceFile[], rootLabel: string, preset: Preset = "static-value"): Promise<Investigation> {
  const options = { ...DEFAULT_ANALYSIS_OPTIONS, preset };
  const selected = selectSources(files, rootLabel, options);
  if (!selected.ok) throw new Error(`selectSources stopped: ${selected.diagnostics.map((d) => d.message).join(" ")}`);
  return analyze(selected.sourceSet, options, webCryptoHash, undefined, selected.diagnostics);
}

export interface ExpectedManor {
  modules: { id: string; language: string; parseStatus: string }[];
  wings: Record<string, number>;
  receiptToCheckout: { specifier: string; importLine: number; useLine: number };
  imports: { from: string; to: string | null; specifier: string; syntaxKind: string; dependencyKind: string; resolution: string }[];
  diagnostics: { code: string; module: string; specifier: string }[];
  cycles: Record<Preset, { members: string[]; witness: { modules: string[]; relationIds: string[] } }[]>;
}

/** The hand written facts of the manor, read from public/demo/manor/before/expected.json. */
export function expectedManor(): ExpectedManor {
  return readJson<ExpectedManor>("public", "demo", "manor", "before", "expected.json");
}

/** The id of the demo relation, built from the hand written import record of expected.json. */
export const DEMO_RELATION_ID = JSON.stringify(["src/notifications/receipt.ts", ["local", "src/orders/checkout.ts"], "import", "value"]);

/** A fresh folder under .hauntmap/ (git-ignored, inside the workspace, so that roots in it pass the containment check). */
export function repoTemp(prefix: string): string {
  mkdirSync(join(REPO, ".hauntmap"), { recursive: true });
  return mkdtempSync(join(REPO, ".hauntmap", prefix));
}