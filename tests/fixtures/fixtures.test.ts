import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkFixtureStructure, FIXTURES_ROOT } from "./load";

// Which sections each fixture needs, taken from the table of design.md.
// Every fixture has modules, imports and diagnostics.
const EXTRA_SECTIONS: Record<string, string[]> = {
  kinds: [],
  "resolve-order": [],
  "js-to-ts": [],
  absent: [],
  alias: [],
  external: [],
  "self-loop": ["cycles"],
  "two-cycles": ["cycles", "trace"],
  "type-cycle": ["cycles"],
  "parse-fail": [],
  case: [],
  dynamic: ["cycles"],
  chain: ["trace"],
  diamond: ["trace"],
  "same-names": [],
};

const folders = readdirSync(FIXTURES_ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

describe("fixture structure", () => {
  it("has the fifteen fixture folders of the design", () => {
    expect(folders).toEqual(Object.keys(EXTRA_SECTIONS).sort());
  });

  for (const name of Object.keys(EXTRA_SECTIONS)) {
    it(`${name}: expected.json is parseable, has its sections, and accounts for every source file`, () => {
      const problems = checkFixtureStructure(join(FIXTURES_ROOT, name), [
        "modules",
        "imports",
        "diagnostics",
        ...(EXTRA_SECTIONS[name] ?? []),
      ]);
      expect(problems).toEqual([]);
    });
  }

  it("fails when a copy of a fixture has a source file deleted", () => {
    const temp = mkdtempSync(join(tmpdir(), "hauntmap-fixture-"));
    try {
      const copy = join(temp, "chain");
      cpSync(join(FIXTURES_ROOT, "chain"), copy, { recursive: true });
      rmSync(join(copy, "c.ts"));
      const problems = checkFixtureStructure(copy, ["modules", "imports", "diagnostics", "trace"]);
      expect(problems.length).toBeGreaterThan(0);
      expect(problems.join("\n")).toContain("c.ts");
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it("fails when a copy of a fixture has an extra source file", () => {
    const temp = mkdtempSync(join(tmpdir(), "hauntmap-fixture-"));
    try {
      const copy = join(temp, "chain");
      cpSync(join(FIXTURES_ROOT, "chain"), copy, { recursive: true });
      cpSync(join(FIXTURES_ROOT, "chain", "c.ts"), join(copy, "extra.ts"));
      const problems = checkFixtureStructure(copy, ["modules", "imports", "diagnostics", "trace"]);
      expect(problems.join("\n")).toContain("extra.ts");
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});