import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SourceFile } from "../../src/contracts/types";

export const FIXTURES_ROOT = dirname(fileURLToPath(import.meta.url));

const SOURCE_EXTENSIONS = [".js", ".jsx", ".ts", ".tsx", ".mjs", ".mts"];

function walk(dir: string, prefix: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) walk(join(dir, entry.name), relative, out);
    else out.push(relative);
  }
}

/**
 * The source files of one fixture folder, paths relative to the folder with forward slashes.
 * A fixture may also carry `files.json` (path to text) for paths that cannot coexist on a
 * case-insensitive file system, such as `Util.ts` and `util.ts`.
 */
export function loadFixtureFiles(dir: string): SourceFile[] {
  const paths: string[] = [];
  walk(dir, "", paths);
  const files: SourceFile[] = [];
  for (const path of paths) {
    if (!SOURCE_EXTENSIONS.some((extension) => path.endsWith(extension))) continue;
    const text = readFileSync(join(dir, path), "utf8");
    files.push({ path, text, bytes: Buffer.byteLength(text, "utf8") });
  }
  const virtual = join(dir, "files.json");
  if (existsSync(virtual)) {
    const entries = JSON.parse(readFileSync(virtual, "utf8")) as Record<string, string>;
    for (const [path, text] of Object.entries(entries)) {
      files.push({ path, text, bytes: Buffer.byteLength(text, "utf8") });
    }
  }
  return files;
}

export function readExpected(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, "expected.json"), "utf8")) as Record<string, unknown>;
}

/** Returns a list of problems; an empty list means the fixture is well formed. */
export function checkFixtureStructure(dir: string, requiredSections: string[]): string[] {
  const problems: string[] = [];
  let expected: Record<string, unknown>;
  try {
    expected = readExpected(dir);
  } catch (error) {
    return [`expected.json is missing or not parseable: ${(error as Error).message}`];
  }
  for (const section of requiredSections) {
    if (!(section in expected)) problems.push(`missing section "${section}"`);
  }
  const modules = expected.modules;
  if (!Array.isArray(modules)) {
    problems.push('section "modules" is not a list');
    return problems;
  }
  const listed = new Set<string>();
  for (const entry of modules as { id?: unknown }[]) {
    if (typeof entry.id !== "string") problems.push("a module entry has no string id");
    else listed.add(entry.id);
  }
  const sources = new Set(loadFixtureFiles(dir).map((file) => file.path));
  for (const path of sources) {
    if (!listed.has(path)) problems.push(`source file ${path} is not listed in modules`);
  }
  for (const id of listed) {
    if (!sources.has(id)) problems.push(`module ${id} has no source file`);
  }
  return problems;
}