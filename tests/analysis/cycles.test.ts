import { createHash } from "node:crypto";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findCycles } from "../../src/analysis/graph/cycles";
import { includesRelation, presetRelations } from "../../src/analysis/graph/presets";
import { analyze } from "../../src/analysis/parser/analyze";
import { selectSources } from "../../src/analysis/parser/select";
import { DEFAULT_ANALYSIS_OPTIONS } from "../../src/contracts/options";
import type { AnalysisOptions, CyclicComponent, Investigation, Preset, SourceFile } from "../../src/contracts/types";
import { FIXTURES_ROOT, loadFixtureFiles, readExpected } from "../fixtures/load";

const nodeHash = (text: string): Promise<string> => Promise.resolve(createHash("sha256").update(text, "utf8").digest("hex"));

async function investigate(files: SourceFile[], options: AnalysisOptions = DEFAULT_ANALYSIS_OPTIONS): Promise<Investigation> {
  const selected = selectSources(files, "test", options);
  if (!selected.ok) throw new Error("selection failed");
  return analyze(selected.sourceSet, options, nodeHash, undefined, selected.diagnostics);
}

function inline(entries: Record<string, string>, options: AnalysisOptions = DEFAULT_ANALYSIS_OPTIONS): Promise<Investigation> {
  return investigate(
    Object.entries(entries).map(([path, text]) => ({ path, text, bytes: Buffer.byteLength(text, "utf8") })),
    options,
  );
}

const PRESETS: Preset[] = ["static-value", "type-inclusive", "dynamic-inclusive"];

describe("findCycles against the fixtures' expected.json", () => {
  for (const name of ["self-loop", "two-cycles", "type-cycle", "dynamic"]) {
    for (const preset of PRESETS) {
      it(`${name} under ${preset}: members and witness equal expected.json`, async () => {
        const dir = join(FIXTURES_ROOT, name);
        const investigation = await investigate(loadFixtureFiles(dir));
        const expected = (readExpected(dir) as unknown as { cycles: Record<Preset, CyclicComponent[]> }).cycles[preset];
        const report = findCycles(investigation, preset);
        expect(report.preset).toBe(preset);
        expect(report.components).toEqual(expected);
      });
    }
  }
});

describe("presets", () => {
  it("static-value takes import and re-export syntax with value or mixed kind", async () => {
    const investigation = await inline({
      "a.ts":
        'import { v } from "./b";\nimport type { T } from "./b";\nimport { w, type U } from "./c";\nexport { x } from "./d";\nexport type { Y } from "./d";\nimport "./e";\n',
      "b.ts": "",
      "c.ts": "",
      "d.ts": "",
      "e.ts": "",
    });
    const kinds = presetRelations(investigation, "static-value").map((r) => `${r.syntaxKind}/${r.dependencyKind}/${r.to}`);
    expect([...kinds].sort()).toEqual(["import/mixed/c.ts", "import/value/b.ts", "import/value/e.ts", "re-export/value/d.ts"]);
  });

  it("type-inclusive adds the type relations and nothing else", async () => {
    const investigation = await inline({
      "a.ts": 'import type { T } from "./b";\nexport type { Y } from "./b";\nimport { v } from "./b";\nawait import("./b");\n',
      "b.ts": "",
    });
    const kinds = presetRelations(investigation, "type-inclusive").map((r) => `${r.syntaxKind}/${r.dependencyKind}`);
    expect([...kinds].sort()).toEqual(["import/type", "import/value", "re-export/type"]);
  });

  it("includesRelation never admits a dynamic literal under static-value or type-inclusive", () => {
    const base = { syntaxKind: "dynamic-literal", dependencyKind: "value", resolution: "local" } as const;
    expect(includesRelation("static-value", base)).toBe(false);
    expect(includesRelation("type-inclusive", base)).toBe(false);
    expect(includesRelation("dynamic-inclusive", base)).toBe(true);
  });

  it("never includes external, unresolved or unsupported relations", () => {
    for (const resolution of ["external", "unresolved", "unsupported"] as const) {
      for (const preset of PRESETS) {
        expect(includesRelation(preset, { syntaxKind: "import", dependencyKind: "value", resolution })).toBe(false);
      }
    }
  });

  it("takes a literal dynamic import only under dynamic-inclusive, and never a non literal one", async () => {
    const investigation = await inline({
      "a.ts": "export const f = (n: string) => [import(\"./b\"), import(n)];\n",
      "b.ts": "",
    });
    expect(presetRelations(investigation, "static-value")).toEqual([]);
    expect(presetRelations(investigation, "type-inclusive")).toEqual([]);
    expect(presetRelations(investigation, "dynamic-inclusive").map((r) => [r.syntaxKind, r.to])).toEqual([["dynamic-literal", "b.ts"]]);
  });

  it("collapses repeated imports of one relation to one", async () => {
    const investigation = await inline({
      "a.ts": 'import { x } from "./b";\nimport { y } from "./b";\n',
      "b.ts": "",
    });
    expect(investigation.imports).toHaveLength(2);
    expect(presetRelations(investigation, "static-value")).toHaveLength(1);
  });

  it("static-value relations are a subset of the other two presets", async () => {
    const investigation = await inline({
      "a.ts": 'import type { T } from "./b";\nimport { v } from "./b";\nawait import("./c");\n',
      "b.ts": "",
      "c.ts": "",
    });
    const base = new Set(presetRelations(investigation, "static-value").map((r) => r.relationId));
    for (const preset of ["type-inclusive", "dynamic-inclusive"] as const) {
      const other = new Set(presetRelations(investigation, preset).map((r) => r.relationId));
      for (const id of base) expect(other.has(id)).toBe(true);
    }
  });
});

describe("findCycles", () => {
  it("returns no component for an acyclic graph", async () => {
    const investigation = await inline({ "a.ts": 'import "./b";\n', "b.ts": "" });
    expect(findCycles(investigation, "static-value")).toEqual({ preset: "static-value", components: [] });
  });

  it("does not report a one module component without a self import", async () => {
    const investigation = await inline({ "a.ts": "export const a = 1;\n" });
    expect(findCycles(investigation, "static-value").components).toEqual([]);
  });

  it("starts the witness at the smallest member and takes the smallest next member first", async () => {
    const investigation = await inline({
      "a.ts": 'import "./c";\nimport "./b";\n',
      "b.ts": 'import "./a";\n',
      "c.ts": 'import "./a";\n',
    });
    const [component] = findCycles(investigation, "static-value").components;
    expect(component?.members).toEqual(["a.ts", "b.ts", "c.ts"]);
    expect(component?.witness.modules).toEqual(["a.ts", "b.ts"]);
    expect(component?.witness.relationIds).toEqual([
      JSON.stringify(["a.ts", ["local", "b.ts"], "import", "value"]),
      JSON.stringify(["b.ts", ["local", "a.ts"], "import", "value"]),
    ]);
  });

  it("leaves a dead end branch out of the witness", async () => {
    // a to b; b to c and e; c back to b only; e back to a. The walk visits c, backs out, then takes e.
    const investigation = await inline({
      "a.ts": 'import "./b";\n',
      "b.ts": 'import "./c";\nimport "./e";\n',
      "c.ts": 'import "./b";\n',
      "e.ts": 'import "./a";\n',
    });
    const [component] = findCycles(investigation, "static-value").components;
    expect(component?.members).toEqual(["a.ts", "b.ts", "c.ts", "e.ts"]);
    expect(component?.witness.modules).toEqual(["a.ts", "b.ts", "e.ts"]);
    expect(component?.witness.relationIds).toHaveLength(3);
  });

  it("reports components that share no module, ordered by their smallest member", async () => {
    const investigation = await inline({
      "z.ts": 'import "./y";\n',
      "y.ts": 'import "./z";\n',
      "b.ts": 'import "./b";\n',
      "m.ts": 'import "./n";\n',
      "n.ts": 'import "./o";\n',
      "o.ts": 'import "./m";\n',
    });
    const components = findCycles(investigation, "static-value").components;
    expect(components.map((c) => c.members)).toEqual([["b.ts"], ["m.ts", "n.ts", "o.ts"], ["y.ts", "z.ts"]]);
  });

  it("walks a mixed relation once and picks the smallest relation id when several reach one module", async () => {
    const investigation = await inline({
      "a.ts": 'import type { T } from "./b";\nimport { v } from "./b";\nimport { w, type U } from "./b";\n',
      "b.ts": 'import "./a";\n',
    });
    const staticReport = findCycles(investigation, "static-value");
    expect(staticReport.components[0]?.witness.relationIds[0]).toBe(JSON.stringify(["a.ts", ["local", "b.ts"], "import", "mixed"]));
    const typeReport = findCycles(investigation, "type-inclusive");
    // "mixed" < "type" < "value" in code unit order, so the smallest relation id is the mixed one.
    expect(typeReport.components[0]?.witness.relationIds[0]).toBe(JSON.stringify(["a.ts", ["local", "b.ts"], "import", "mixed"]));
    expect(typeReport.components[0]?.witness.relationIds).toHaveLength(2);
  });

  it("gives the same JSON text for the same investigation twice", async () => {
    const investigation = await inline({ "a.ts": 'import "./b";\n', "b.ts": 'import "./a";\n' });
    expect(JSON.stringify(findCycles(investigation, "static-value"))).toBe(JSON.stringify(findCycles(investigation, "static-value")));
  });

  it("copes with a long chain closed into one loop without recursion", async () => {
    const entries: Record<string, string> = {};
    const count = 20000;
    const name = (i: number): string => `m${String(i).padStart(6, "0")}.ts`;
    for (let i = 0; i < count; i++) entries[name(i)] = `import "./${name((i + 1) % count).replace(".ts", "")}";\n`;
    const investigation = await inline(entries, { ...DEFAULT_ANALYSIS_OPTIONS, maxFiles: 30000 });
    const [component] = findCycles(investigation, "static-value").components;
    expect(component?.members).toHaveLength(count);
    expect(component?.witness.modules).toHaveLength(count);
  }, 60000);
});
