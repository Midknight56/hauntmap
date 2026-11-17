import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { findCycles } from "../../src/analysis/graph/cycles";
import { trace } from "../../src/analysis/graph/trace";
import { analyze } from "../../src/analysis/parser/analyze";
import { selectSources } from "../../src/analysis/parser/select";
import { DEFAULT_ANALYSIS_OPTIONS } from "../../src/contracts/options";
import type { CyclicComponent, Diagnostic, ImportRecord, Investigation, Preset, TraceResult } from "../../src/contracts/types";
import { checkFixtureStructure, FIXTURES_ROOT, loadFixtureFiles, readExpected } from "./load";

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
// ---- the modules, imports and diagnostics sections (task 6) ----

const nodeHash = (text: string): Promise<string> => Promise.resolve(createHash("sha256").update(text, "utf8").digest("hex"));

async function analyzeFixture(name: string): Promise<Investigation> {
  const files = loadFixtureFiles(join(FIXTURES_ROOT, name));
  const selected = selectSources(files, name, DEFAULT_ANALYSIS_OPTIONS);
  if (!selected.ok) throw new Error(`selection failed for ${name}`);
  return analyze(selected.sourceSet, DEFAULT_ANALYSIS_OPTIONS, nodeHash, undefined, selected.diagnostics);
}

interface ExpectedModule {
  id: string;
  language: string;
  parseStatus: string;
}
interface ExpectedImport {
  from: string;
  specifier: string;
  syntaxKind: string;
  dependencyKind: string;
  resolution: string;
  to: string | null;
  reason?: string;
  line: number;
  column: number;
}

const ANALYZED = Object.keys(EXTRA_SECTIONS);

function byOccurrence(a: { from: string; line: number; column: number; specifier: string }, b: typeof a): number {
  const x = JSON.stringify([a.from, a.line, a.column, a.specifier]);
  const y = JSON.stringify([b.from, b.line, b.column, b.specifier]);
  return x < y ? -1 : x > y ? 1 : 0;
}

describe("analyze against the fixtures' expected.json", () => {
  for (const name of ANALYZED) {
    describe(name, () => {
      const expected = readExpected(join(FIXTURES_ROOT, name)) as unknown as {
        modules: ExpectedModule[];
        imports: ExpectedImport[];
        diagnostics: Diagnostic[];
      };

      it("modules: id, language and parse status, with a SHA-256 hash of the text", async () => {
        const investigation = await analyzeFixture(name);
        const files = loadFixtureFiles(join(FIXTURES_ROOT, name));
        expect(investigation.modules.map((m) => ({ id: m.id, language: m.language, parseStatus: m.parseStatus }))).toEqual(
          expected.modules,
        );
        for (const record of investigation.modules) {
          const file = files.find((f) => f.path === record.id);
          expect(record.sourceHash).toBe(createHash("sha256").update(file?.text ?? "", "utf8").digest("hex"));
        }
      });

      it("imports: every field, the two ids built from the formulas, sorted by occurrenceId", async () => {
        const investigation = await analyzeFixture(name);
        const wanted = [...expected.imports].sort(byOccurrence);
        const actual = investigation.imports.map((i: ImportRecord) => {
          const picked: ExpectedImport = {
            from: i.from,
            specifier: i.specifier,
            syntaxKind: i.syntaxKind,
            dependencyKind: i.dependencyKind,
            resolution: i.resolution,
            to: i.to,
            line: i.line,
            column: i.column,
          };
          if (i.reason !== undefined) picked.reason = i.reason;
          return picked;
        });
        expect(actual).toEqual(wanted);
        investigation.imports.forEach((record, position) => {
          const w = wanted[position];
          if (w === undefined) throw new Error("missing expected import");
          expect(record.occurrenceId).toBe(JSON.stringify([w.from, w.line, w.column, w.specifier]));
          const targetKey = w.resolution === "local" ? ["local", w.to] : [w.resolution, w.specifier];
          expect(record.relationId).toBe(JSON.stringify([w.from, targetKey, w.syntaxKind, w.dependencyKind]));
        });
      });

      it("diagnostics: code, module, line, column and specifier, in order", async () => {
        const investigation = await analyzeFixture(name);
        const actual = investigation.diagnostics.map((d) => {
          const picked: Record<string, unknown> = { code: d.code };
          if (d.module !== undefined) picked.module = d.module;
          if (d.line !== undefined) picked.line = d.line;
          if (d.column !== undefined) picked.column = d.column;
          if (d.specifier !== undefined) picked.specifier = d.specifier;
          return picked;
        });
        expect(actual).toEqual(expected.diagnostics);
      });
    });
  }
});
// ---- the cycles section (task 7) ----

describe("findCycles against the fixtures' expected.json", () => {
  for (const name of ANALYZED.filter((n) => (EXTRA_SECTIONS[n] ?? []).includes("cycles"))) {
    for (const preset of ["static-value", "type-inclusive", "dynamic-inclusive"] as Preset[]) {
      it(`${name} under ${preset}`, async () => {
        const expected = readExpected(join(FIXTURES_ROOT, name)) as unknown as { cycles: Record<Preset, CyclicComponent[]> };
        const report = findCycles(await analyzeFixture(name), preset);
        expect(report.preset).toBe(preset);
        expect(report.components).toEqual(expected.cycles[preset]);
      });
    }
  }
});
// ---- the trace section (task 8) ----

describe("trace against the fixtures' expected.json", () => {
  for (const name of ANALYZED.filter((n) => (EXTRA_SECTIONS[n] ?? []).includes("trace"))) {
    it(`${name}: every trace entry`, async () => {
      const investigation = await analyzeFixture(name);
      const expected = (readExpected(join(FIXTURES_ROOT, name)) as unknown as { trace: TraceResult[] }).trace;
      expect(expected.length).toBeGreaterThan(0);
      for (const entry of expected) {
        expect(trace(investigation, entry.origin, entry.direction, entry.preset)).toEqual(entry);
      }
    });
  }
});