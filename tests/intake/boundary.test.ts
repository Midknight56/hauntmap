import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// 1.8: the intake folders reach the store and the analysis client through structural types. They import
// nothing from src/components or src/features/investigation, a type import included.
// The detector is written again here on purpose; it is not imported from tests/ui.

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FOLDERS = ["src/features/import", "src/features/github"];
const FORBIDDEN = ["src/components", "src/features/investigation"];
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm;

function posix(path: string): string {
  return relative(REPO, path).split("\\").join("/");
}

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(path);
  }
  return files;
}

/** The forbidden folder that a specifier written in `file` (repository relative) reaches, or null. */
export function forbiddenTarget(file: string, specifier: string): string | null {
  if (!specifier.startsWith(".") && !specifier.startsWith("/") && !specifier.startsWith("src/")) return null;
  const base = specifier.startsWith("src/") ? specifier : posix(resolve(REPO, dirname(file), specifier));
  return FORBIDDEN.find((folder) => base === folder || base.startsWith(`${folder}/`)) ?? null;
}

export function forbiddenImports(file: string, text: string): string[] {
  const hits: string[] = [];
  for (const match of text.matchAll(SPECIFIER)) {
    const specifier = match[1] ?? "";
    const target = forbiddenTarget(file, specifier);
    if (target !== null) hits.push(`${file} imports ${specifier} (${target})`);
  }
  return hits;
}

describe("intake boundary (1.8)", () => {
  it("no file under src/features/import or src/features/github imports src/components or src/features/investigation", () => {
    const offenders = FOLDERS.flatMap((folder) => sourceFiles(join(REPO, folder))).flatMap((file) => forbiddenImports(posix(file), readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("the folder src/features/import has source files to check", () => {
    expect(FOLDERS.flatMap((folder) => sourceFiles(join(REPO, folder))).length).toBeGreaterThan(0);
  });

  it("the detector finds value, type, dynamic and absolute specifiers (a check of the check)", () => {
    const file = "src/features/import/x.ts";
    expect(forbiddenImports(file, 'import { a } from "../../components/App";')).toHaveLength(1);
    expect(forbiddenImports(file, 'import type { S } from "../investigation/store";')).toHaveLength(1);
    expect(forbiddenImports(file, 'const m = await import("../../components/Landing");')).toHaveLength(1);
    expect(forbiddenImports(file, 'import "src/features/investigation/store";')).toHaveLength(1);
    expect(forbiddenImports(file, 'export * from "../../components/App";')).toHaveLength(1);
  });

  it("the detector accepts the analysis, contracts and sibling files", () => {
    const file = "src/features/import/x.ts";
    expect(forbiddenImports(file, 'import { selectSources } from "../../analysis";')).toEqual([]);
    expect(forbiddenImports(file, 'import type { Investigation } from "../../contracts/types";')).toEqual([]);
    expect(forbiddenImports(file, 'import { plural } from "./review";')).toEqual([]);
    expect(forbiddenImports(file, 'import { useState } from "react";')).toEqual([]);
    expect(forbiddenImports(file, 'import x from "../compare/store";')).toEqual([]);
  });
});
