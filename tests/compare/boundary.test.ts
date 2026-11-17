import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// 2.6 and I4: compare.ts imports only src/contracts/** and sibling files of src/analysis/graph/.
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FILE = join(REPO, "src", "analysis", "graph", "compare.ts");
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm;

export function importsOf(text: string): string[] {
  return [...text.matchAll(SPECIFIER)].map((m) => m[1] as string);
}

export function allowedImport(specifier: string): boolean {
  return specifier.startsWith("../../contracts/") || /^\.\/[A-Za-z0-9_-]+$/.test(specifier);
}

describe("compare.ts imports (2.6, I4)", () => {
  it("imports only src/contracts and siblings of src/analysis/graph", () => {
    const specifiers = importsOf(readFileSync(FILE, "utf8"));
    expect(specifiers.length).toBeGreaterThan(0);
    expect(specifiers.filter((s) => !allowedImport(s))).toEqual([]);
  });

  it("reads and hashes no source text and touches no DOM or Node API", () => {
    const text = readFileSync(FILE, "utf8");
    expect(text).not.toMatch(/\b(?:document|window|localStorage|crypto)\b|node:/);
    expect(text).not.toMatch(/\bsourceText\b/);
  });

  it("the detector rejects what it should (a check of the check)", () => {
    expect(importsOf('import { a } from "../parser/analyze";').filter((s) => !allowedImport(s))).toEqual(["../parser/analyze"]);
    expect(importsOf('import x from "../../scene/layout/types";').filter((s) => !allowedImport(s))).toHaveLength(1);
    expect(importsOf('import type { T } from "../../contracts/types";').filter((s) => !allowedImport(s))).toEqual([]);
    expect(importsOf('import { findCycles } from "./cycles";').filter((s) => !allowedImport(s))).toEqual([]);
    expect(importsOf('const m = await import("react");').filter((s) => !allowedImport(s))).toEqual(["react"]);
  });
});