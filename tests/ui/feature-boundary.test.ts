import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = join(REPO, "src");

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(path);
  }
  return files;
}

function posix(path: string): string {
  return relative(REPO, path).split("\\").join("/");
}

// I9: nothing outside src/analysis/** and analysisApi.ts defines a cycle, trace or preset function.
const NAMES = "cycles|trace|inPreset";
const DEFINITION = new RegExp(
  [
    `\\bfunction\\s+(?:${NAMES})\\b`,
    `\\b(?:const|let|var)\\s+(?:${NAMES})\\b`,
    `^\\s*(?:async\\s+)?(?:${NAMES})\\s*\\([^)]*\\)\\s*(?::\\s*[^{;=]+)?\\{`,
    `^\\s*(?:${NAMES})\\s*:\\s*(?:\\(|function\\b|async\\b)`,
  ].join("|"),
  "m",
);

describe("feature boundary (I9)", () => {
  it("defines no cycles, trace or inPreset outside src/analysis and analysisApi.ts", () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => {
        const name = posix(file);
        return !name.startsWith("src/analysis/") && name !== "src/features/investigation/analysisApi.ts";
      })
      .filter((file) => DEFINITION.test(readFileSync(file, "utf8")))
      .map(posix);
    expect(offenders).toEqual([]);
  });

  it("the detector finds a definition (a check of the check)", () => {
    expect(DEFINITION.test("export function trace(a) {}")).toBe(true);
    expect(DEFINITION.test("const cycles = () => 1;")).toBe(true);
    expect(DEFINITION.test("  inPreset(record, preset) {\n  return true;\n}")).toBe(true);
    expect(DEFINITION.test("const x = api.trace(a, b);")).toBe(false);
    expect(DEFINITION.test("const report = analysisApi.cycles(inv, preset);")).toBe(false);
  });
});

// 10.6: the registry is the only coupling. `src/features/liveSnapshot` and `src/features/compare` import
// nothing from `src/components/**` or `src/features/investigation/**` (a type import counts too).
const HOSTED_FEATURES = ["src/features/liveSnapshot", "src/features/compare"];
const FORBIDDEN = ["src/components", "src/features/investigation"];
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm;

/** The forbidden folder an import specifier written in `file` (a repository-relative path) reaches, or null. */
export function forbiddenTarget(file: string, specifier: string): string | null {
  if (!specifier.startsWith(".") && !specifier.startsWith("/") && !specifier.startsWith("src/")) return null;
  const base = specifier.startsWith("src/") ? specifier : posix(resolve(REPO, dirname(file), specifier));
  return FORBIDDEN.find((folder) => base === folder || base.startsWith(`${folder}/`)) ?? null;
}

export function forbiddenImports(file: string, text: string): string[] {
  const hits: string[] = [];
  for (const match of text.matchAll(SPECIFIER)) {
    const specifier = match[1] as string;
    if (forbiddenTarget(file, specifier) !== null) hits.push(`${file} imports ${specifier}`);
  }
  return hits;
}

describe("hosted features reach the interface only through the registry (10.6)", () => {
  it("no file under src/features/liveSnapshot or src/features/compare imports src/components or src/features/investigation", () => {
    const offenders = HOSTED_FEATURES.filter((dir) => existsSync(join(REPO, dir)))
      .flatMap((dir) => sourceFiles(join(REPO, dir)))
      .flatMap((file) => forbiddenImports(posix(file), readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("the detector finds relative, aliased, type-only, dynamic and side-effect imports (a check of the check)", () => {
    const file = "src/features/compare/panel.ts";
    expect(forbiddenImports(file, 'import { Inspector } from "../../components/Inspector";')).toHaveLength(1);
    expect(forbiddenImports(file, 'import type { Registry } from "../investigation/registry";')).toHaveLength(1);
    expect(forbiddenImports(file, 'import type {\n  A,\n} from "../investigation/store";')).toHaveLength(1);
    expect(forbiddenImports(file, 'const m = await import("../../components/App");')).toHaveLength(1);
    expect(forbiddenImports(file, 'import "../investigation/prefs";')).toHaveLength(1);
    expect(forbiddenImports(file, 'import x from "src/components/App";')).toHaveLength(1);
    expect(forbiddenImports(file, 'import { findCycles } from "../../analysis";')).toEqual([]);
    expect(forbiddenImports(file, 'import { helper } from "./helper";')).toEqual([]);
    expect(forbiddenImports(file, 'import { useState } from "react";')).toEqual([]);
    expect(forbiddenImports("src/features/liveSnapshot/a.ts", 'import { x } from "../compare/y";')).toEqual([]);
  });
});
