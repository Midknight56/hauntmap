import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO } from "./appPath";

// Requirements 1.1 and 3.7. A text scan of packages/hauntmap-mcp/src: what it imports, which
// globals it names and which dangerous calls it contains. The scan is itself tested on strings.

const PACKAGE_SRC = join(REPO, "packages", "hauntmap-mcp", "src");

const ALLOWED_ANALYSIS_IMPORTS = ["src/analysis/index", "src/analysis/graph/compare", "src/contracts/types", "src/contracts/validate"];
const FORBIDDEN_FOLDERS = ["src/scene", "src/features", "src/components", "src/workers"];
const FORBIDDEN_DECLARATIONS = ["extractImports", "resolveSpecifier", "findCycles", "trace", "tarjan"];
const PARSER_PACKAGES = ["@babel/parser", "@babel/core", "@babel/traverse", "typescript", "acorn", "esprima", "espree"];

/** Import specifiers of a source text (static, dynamic and re-exports), found by pattern. */
export function importSpecifiers(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["']([^"']+)["']/g)) found.push(match[1] as string);
  return found;
}

/** Problems with the imports of `text`, a file of the package at `path` (relative to the repository root). */
export function importProblems(path: string, text: string): string[] {
  const problems: string[] = [];
  for (const specifier of importSpecifiers(text)) {
    if (PARSER_PACKAGES.includes(specifier) || specifier.startsWith("@babel/")) problems.push(`${path}: parser package ${specifier}`);
    if (!specifier.startsWith(".")) continue;
    const target = posix.normalize(posix.join(dirname(path.replace(/\\/g, "/")), specifier)).replace(/\.(ts|js|mjs|mts)$/, "");
    if (!target.startsWith("src/")) continue;
    if (FORBIDDEN_FOLDERS.some((folder) => target === folder || target.startsWith(`${folder}/`))) problems.push(`${path}: imports ${target}`);
    else if (!ALLOWED_ANALYSIS_IMPORTS.includes(target) && (target.startsWith("src/analysis/") || target.startsWith("src/contracts/"))) problems.push(`${path}: deep import ${target}`);
  }
  return problems;
}

export function globalProblems(path: string, text: string): string[] {
  const problems: string[] = [];
  for (const name of ["window", "document", "fetch"]) {
    if (new RegExp(`(^|[^\\w.$])${name}\\s*(\\.|\\()`, "m").test(text)) problems.push(`${path}: uses ${name}`);
  }
  for (const name of FORBIDDEN_DECLARATIONS) {
    if (new RegExp(`(function\\s+${name}\\b|\\b${name}\\s*[:=]\\s*(async\\s*)?(\\(|function))`).test(text)) problems.push(`${path}: declares ${name}`);
  }
  return problems;
}

export function executionProblems(path: string, text: string): string[] {
  const problems: string[] = [];
  if (/child_process/.test(text)) problems.push(`${path}: child_process`);
  if (/["']node:vm["']|["']vm["']/.test(text)) problems.push(`${path}: vm`);
  if (/\beval\(/.test(text)) problems.push(`${path}: eval(`);
  if (/new Function\(/.test(text)) problems.push(`${path}: new Function(`);
  return problems;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? sourceFiles(join(dir, entry.name)) : entry.name.endsWith(".ts") ? [join(dir, entry.name)] : []));
}

describe("the scan itself", () => {
  it("flags forbidden imports, deep analysis imports, parser packages, globals and declarations", () => {
    const here = "packages/hauntmap-mcp/src/x.ts";
    expect(importProblems(here, 'import { a } from "../../../src/scene/draw";')).toHaveLength(1);
    expect(importProblems(here, 'import { a } from "../../../src/features/liveSnapshot/index";')).toHaveLength(1);
    expect(importProblems(here, 'import { a } from "../../../src/components/App";')).toHaveLength(1);
    expect(importProblems(here, 'import { a } from "../../../src/analysis/parser/analyze";')).toHaveLength(1);
    expect(importProblems(here, 'import { a } from "@babel/parser";')).toHaveLength(1);
    expect(importProblems(here, 'import { a } from "../../../src/analysis/index";')).toEqual([]);
    expect(importProblems(here, 'import { a } from "../../../src/analysis/graph/compare";')).toEqual([]);
    expect(importProblems(here, 'import type { A } from "../../../src/contracts/types";')).toEqual([]);
    expect(importProblems(here, 'import { v } from "../../../src/contracts/validate";')).toEqual([]);
    expect(globalProblems(here, "const r = await fetch(url);")).toHaveLength(1);
    expect(globalProblems(here, "document.title = 'x';")).toHaveLength(1);
    expect(globalProblems(here, "function findCycles() {}")).toHaveLength(1);
    expect(globalProblems(here, "const trace = (a) => a;")).toHaveLength(1);
    expect(globalProblems(here, "const fetched = 1; ctx.analysis.findCycles(inv);")).toEqual([]);
    expect(executionProblems(here, 'import { spawn } from "node:child_process";')).toHaveLength(1);
    expect(executionProblems(here, 'import vm from "node:vm";')).toHaveLength(1);
    expect(executionProblems(here, "eval('1')")).toHaveLength(1);
    expect(executionProblems(here, "new Function('return 1')")).toHaveLength(1);
  });
});

describe("packages/hauntmap-mcp/src", () => {
  const files = sourceFiles(PACKAGE_SRC);

  it("has the five source files of the design", () => {
    expect(files.map((f) => f.slice(PACKAGE_SRC.length + 1)).sort()).toEqual(["cli.ts", "errors.ts", "index.ts", "loader.ts", "tools.ts"]);
  });

  it("1.1 imports analysis only through the allowed files, no scene, features or components, no parser package", () => {
    const problems = files.flatMap((file) => importProblems(file.slice(REPO.length + 1), readFileSync(file, "utf8")));
    expect(problems).toEqual([]);
  });

  it("1.1 names no browser global and declares no extraction, resolution, cycle or trace function", () => {
    const problems = files.flatMap((file) => globalProblems(file.slice(REPO.length + 1), readFileSync(file, "utf8")));
    expect(problems).toEqual([]);
  });

  it("3.7 contains no child_process, vm, eval( or new Function(", () => {
    const problems = files.flatMap((file) => executionProblems(file.slice(REPO.length + 1), readFileSync(file, "utf8")));
    expect(problems).toEqual([]);
  });
});
