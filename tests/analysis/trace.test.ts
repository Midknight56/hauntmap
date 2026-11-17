import { createHash } from "node:crypto";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { trace } from "../../src/analysis/graph/trace";
import { analyze } from "../../src/analysis/parser/analyze";
import { selectSources } from "../../src/analysis/parser/select";
import { DEFAULT_ANALYSIS_OPTIONS } from "../../src/contracts/options";
import type { Investigation, SourceFile, TraceResult } from "../../src/contracts/types";
import { FIXTURES_ROOT, loadFixtureFiles, readExpected } from "../fixtures/load";

const nodeHash = (text: string): Promise<string> => Promise.resolve(createHash("sha256").update(text, "utf8").digest("hex"));

async function investigate(files: SourceFile[]): Promise<Investigation> {
  const selected = selectSources(files, "test", DEFAULT_ANALYSIS_OPTIONS);
  if (!selected.ok) throw new Error("selection failed");
  return analyze(selected.sourceSet, DEFAULT_ANALYSIS_OPTIONS, nodeHash, undefined, selected.diagnostics);
}

function fixture(name: string): Promise<Investigation> {
  return investigate(loadFixtureFiles(join(FIXTURES_ROOT, name)));
}

function inline(entries: Record<string, string>): Promise<Investigation> {
  return investigate(Object.entries(entries).map(([path, text]) => ({ path, text, bytes: Buffer.byteLength(text, "utf8") })));
}

// The rows of the trace table of design.md, calculated by hand.
const TABLE: { fixture: string; origin: string; direction: "imports" | "imported-by"; result: Omit<TraceResult, "preset"> }[] = [
  {
    fixture: "chain",
    origin: "a.ts",
    direction: "imports",
    result: {
      origin: "a.ts",
      direction: "imports",
      visited: ["a.ts", "b.ts", "c.ts"],
      direct: ["b.ts"],
      indirect: ["c.ts"],
      predecessor: { "b.ts": "a.ts", "c.ts": "b.ts" },
      distance: { "a.ts": 0, "b.ts": 1, "c.ts": 2 },
    },
  },
  {
    fixture: "chain",
    origin: "c.ts",
    direction: "imported-by",
    result: {
      origin: "c.ts",
      direction: "imported-by",
      visited: ["a.ts", "b.ts", "c.ts", "d.ts"],
      direct: ["b.ts"],
      indirect: ["a.ts", "d.ts"],
      predecessor: { "b.ts": "c.ts", "a.ts": "b.ts", "d.ts": "b.ts" },
      distance: { "c.ts": 0, "b.ts": 1, "a.ts": 2, "d.ts": 2 },
    },
  },
  {
    fixture: "diamond",
    origin: "top.ts",
    direction: "imports",
    result: {
      origin: "top.ts",
      direction: "imports",
      visited: ["base.ts", "left.ts", "right.ts", "top.ts"],
      direct: ["left.ts", "right.ts"],
      indirect: ["base.ts"],
      predecessor: { "left.ts": "top.ts", "right.ts": "top.ts", "base.ts": "left.ts" },
      distance: { "top.ts": 0, "left.ts": 1, "right.ts": 1, "base.ts": 2 },
    },
  },
  {
    fixture: "diamond",
    origin: "base.ts",
    direction: "imported-by",
    result: {
      origin: "base.ts",
      direction: "imported-by",
      visited: ["base.ts", "left.ts", "right.ts", "top.ts"],
      direct: ["left.ts", "right.ts"],
      indirect: ["top.ts"],
      predecessor: { "left.ts": "base.ts", "right.ts": "base.ts", "top.ts": "left.ts" },
      distance: { "base.ts": 0, "left.ts": 1, "right.ts": 1, "top.ts": 2 },
    },
  },
  {
    fixture: "two-cycles",
    origin: "a.ts",
    direction: "imported-by",
    result: {
      origin: "a.ts",
      direction: "imported-by",
      visited: ["a.ts", "b.ts", "f.ts"],
      direct: ["b.ts", "f.ts"],
      indirect: [],
      predecessor: { "b.ts": "a.ts", "f.ts": "a.ts" },
      distance: { "a.ts": 0, "b.ts": 1, "f.ts": 1 },
    },
  },
  {
    fixture: "two-cycles",
    origin: "a.ts",
    direction: "imports",
    result: {
      origin: "a.ts",
      direction: "imports",
      visited: ["a.ts", "b.ts"],
      direct: ["b.ts"],
      indirect: [],
      predecessor: { "b.ts": "a.ts" },
      distance: { "a.ts": 0, "b.ts": 1 },
    },
  },
];

describe("trace: the rows of the design's table", () => {
  for (const row of TABLE) {
    it(`${row.fixture}: ${row.direction} from ${row.origin}`, async () => {
      const result = trace(await fixture(row.fixture), row.origin, row.direction, "static-value");
      expect(result).toEqual({ ...row.result, preset: "static-value" });
    });
  }

  it("diamond visits base.ts once, so visited lists four modules", async () => {
    const result = trace(await fixture("diamond"), "top.ts", "imports", "static-value");
    expect(result.visited).toHaveLength(4);
  });
});

describe("trace: the fixtures' expected.json", () => {
  for (const name of ["chain", "diamond", "two-cycles"]) {
    it(`${name}: every trace entry`, async () => {
      const investigation = await fixture(name);
      const expected = (readExpected(join(FIXTURES_ROOT, name)) as unknown as { trace: TraceResult[] }).trace;
      for (const entry of expected) {
        expect(trace(investigation, entry.origin, entry.direction, entry.preset)).toEqual(entry);
      }
    });
  }
});

describe("trace", () => {
  it("throws an error that names an origin that is not a module", async () => {
    const investigation = await fixture("chain");
    expect(() => trace(investigation, "nope.ts", "imports", "static-value")).toThrow("nope.ts");
  });

  it("does not put the origin in direct or indirect when the origin is in a loop", async () => {
    const result = trace(await fixture("two-cycles"), "c.ts", "imports", "static-value");
    expect(result.visited).toEqual(["c.ts", "d.ts", "e.ts"]);
    expect(result.direct).toEqual(["d.ts"]);
    expect(result.indirect).toEqual(["e.ts"]);
    expect(result.predecessor).toEqual({ "d.ts": "c.ts", "e.ts": "d.ts" });
    expect(Object.keys(result.predecessor)).not.toContain("c.ts");
    expect(result.distance["c.ts"]).toBe(0);
  });

  it("gives an origin with no relations only itself", async () => {
    const result = trace(await fixture("chain"), "c.ts", "imports", "static-value");
    expect(result).toEqual({
      origin: "c.ts",
      direction: "imports",
      preset: "static-value",
      visited: ["c.ts"],
      direct: [],
      indirect: [],
      predecessor: {},
      distance: { "c.ts": 0 },
    });
  });

  it("follows only the relations of the preset", async () => {
    const investigation = await inline({ "a.ts": 'import type { T } from "./b";\n', "b.ts": "export type T = 1;\n" });
    expect(trace(investigation, "a.ts", "imports", "static-value").visited).toEqual(["a.ts"]);
    const typed = trace(investigation, "a.ts", "imports", "type-inclusive");
    expect(typed.visited).toEqual(["a.ts", "b.ts"]);
    expect(typed.preset).toBe("type-inclusive");
  });

  it("ignores external and unresolved imports", async () => {
    const investigation = await inline({ "a.ts": 'import "react";\nimport "./gone";\n' });
    expect(trace(investigation, "a.ts", "imports", "static-value").visited).toEqual(["a.ts"]);
  });

  it("keeps the shortest distance when a longer path also exists", async () => {
    const investigation = await inline({
      "a.ts": 'import "./b";\nimport "./d";\n',
      "b.ts": 'import "./c";\n',
      "c.ts": 'import "./d";\n',
      "d.ts": "",
    });
    const result = trace(investigation, "a.ts", "imports", "static-value");
    expect(result.distance["d.ts"]).toBe(1);
    expect(result.predecessor["d.ts"]).toBe("a.ts");
    expect(result.direct).toEqual(["b.ts", "d.ts"]);
    expect(result.indirect).toEqual(["c.ts"]);
  });

  it("gives the same JSON text twice", async () => {
    const investigation = await fixture("diamond");
    const run = (): string => JSON.stringify(trace(investigation, "base.ts", "imported-by", "static-value"));
    expect(run()).toBe(run());
  });
});
