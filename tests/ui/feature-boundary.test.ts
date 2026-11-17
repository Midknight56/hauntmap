import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
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
