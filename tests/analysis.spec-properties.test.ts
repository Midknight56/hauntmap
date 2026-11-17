import { createHash } from "node:crypto";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { findCycles } from "../src/analysis/graph/cycles";
import { presetRelations } from "../src/analysis/graph/presets";
import { trace } from "../src/analysis/graph/trace";
import { analyze } from "../src/analysis/parser/analyze";
import { selectSources } from "../src/analysis/parser/select";
import { DEFAULT_ANALYSIS_OPTIONS } from "../src/contracts/options";
import type { Diagnostic, Investigation, Preset, SourceFile } from "../src/contracts/types";

// analysis-core task 11: properties written by hand from acceptance criteria 4.4, 5.3 and 6.2 of
// .kiro/specs/analysis-core/requirements.md (the Kiro CLI has no spec correctness feature). They add to the seven
// properties of tests/analysis.properties.test.ts, which stay as they are. The oracles here are written from the
// criteria, not from the code: a plain code-unit comparison, the walk rules of 5.3 and the predecessor rules of 6.2.

const nodeHash = (text: string): Promise<string> => Promise.resolve(createHash("sha256").update(text, "utf8").digest("hex"));
const PRESETS: Preset[] = ["static-value", "type-inclusive", "dynamic-inclusive"];
const RUNS = 100;

/** UTF-16 code unit order, written out so that no `localeCompare` is involved. */
function codeUnitCompare(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = a.charCodeAt(i) - b.charCodeAt(i);
    if (d !== 0) return d;
  }
  return a.length - b.length;
}

function isSorted<T>(items: readonly T[], compare: (a: T, b: T) => number): boolean {
  for (let i = 1; i < items.length; i++) if (compare(items[i - 1] as T, items[i] as T) > 0) return false;
  return true;
}

// ---- generators: modules with names that sort differently by locale and by code unit ----

/** Names where locale order and code-unit order disagree: capitals before lowercase, accents after `z`, `_` and `-`. */
const NAMES = ["a", "B", "Z", "b", "\u00e9", "_x", "a-b", "aB", "ab", "z", "\u00c9t\u00e9", "Zed"];

type Form = "value" | "type" | "mixed" | "side-effect" | "re-export" | "re-export-type" | "star" | "dynamic";
type Target = { kind: "module"; index: number } | { kind: "external" } | { kind: "absent" };
interface Statement {
  form: Form;
  target: Target;
}
interface Project {
  names: string[];
  /** Folder of each module: diagnostics sort by module path first. */
  folders: string[];
  statements: Statement[][];
}

const formArb = fc.constantFrom<Form>("value", "type", "mixed", "side-effect", "re-export", "re-export-type", "star", "dynamic");

const projectArb: fc.Arbitrary<Project> = fc
  .uniqueArray(fc.constantFrom(...NAMES), { minLength: 1, maxLength: 7 })
  .chain((names) => {
    const count = names.length;
    const targetArb: fc.Arbitrary<Target> = fc.oneof(
      { weight: 7, arbitrary: fc.integer({ min: 0, max: count - 1 }).map((index): Target => ({ kind: "module", index })) },
      { weight: 1, arbitrary: fc.constant<Target>({ kind: "external" }) },
      { weight: 2, arbitrary: fc.constant<Target>({ kind: "absent" }) },
    );
    return fc.record({
      names: fc.constant(names),
      folders: fc.array(fc.constantFrom("", "src/", "Src/"), { minLength: count, maxLength: count }),
      statements: fc.array(fc.array(fc.record({ form: formArb, target: targetArb }), { maxLength: 5 }), { minLength: count, maxLength: count }),
    });
  })
  // Two modules whose paths differ only in case would be a case collision, which is not what these properties test.
  .filter((p) => new Set(p.names.map((n, i) => `${p.folders[i]}${n}`.toLowerCase())).size === p.names.length);

const pathOf = (p: Project, i: number): string => `${p.folders[i]}${p.names[i]}.ts`;

function specifierOf(p: Project, from: number, target: Target): string {
  if (target.kind === "external") return "some-package";
  if (target.kind === "absent") return "./absent-file";
  const fromFolder = p.folders[from] as string;
  const toFolder = p.folders[target.index] as string;
  const up = fromFolder === "" ? "./" : "../";
  return fromFolder === toFolder ? `./${p.names[target.index]}` : `${up}${toFolder}${p.names[target.index]}`;
}

function statementText(p: Project, from: number, s: Statement, position: number): string {
  const spec = JSON.stringify(specifierOf(p, from, s.target));
  switch (s.form) {
    case "value":
      return `import { v${position} } from ${spec};`;
    case "type":
      return `import type { T${position} } from ${spec};`;
    case "mixed":
      return `import { v${position}, type T${position} } from ${spec};`;
    case "side-effect":
      return `import ${spec};`;
    case "re-export":
      return `export { v${position} } from ${spec};`;
    case "re-export-type":
      return `export type { T${position} } from ${spec};`;
    case "star":
      return `export * from ${spec};`;
    case "dynamic":
      return `const d${position} = import(${spec});`;
  }
}

function filesOf(p: Project): SourceFile[] {
  return p.names.map((_, i) => {
    const text = (p.statements[i] ?? []).map((s, k) => statementText(p, i, s, k)).join("\n") + "\nexport const own = 1;\n";
    return { path: pathOf(p, i), text, bytes: Buffer.byteLength(text, "utf8") };
  });
}

async function investigate(files: SourceFile[]): Promise<Investigation> {
  const selected = selectSources(files, "spec-properties", DEFAULT_ANALYSIS_OPTIONS);
  if (!selected.ok) throw new Error("selection failed");
  return analyze(selected.sourceSet, DEFAULT_ANALYSIS_OPTIONS, nodeHash, undefined, selected.diagnostics);
}

/** The diagnostic order of 4.4: module, line, column, code; a missing module, line or column comes first. */
function diagnosticCompare(a: Diagnostic, b: Diagnostic): number {
  return (
    codeUnitCompare(a.module ?? "", b.module ?? "") ||
    (a.line ?? 0) - (b.line ?? 0) ||
    (a.column ?? 0) - (b.column ?? 0) ||
    codeUnitCompare(a.code, b.code)
  );
}

describe("analysis spec properties (task 11, written by hand)", () => {
  it("S1 (4.4) modules by id, imports by occurrenceId and diagnostics by module, line, column, code, all in UTF-16 code unit order", async () => {
    await fc.assert(
      fc.asyncProperty(projectArb, async (project) => {
        const inv = await investigate(filesOf(project));
        expect(inv.modules).toHaveLength(project.names.length);
        expect(isSorted(inv.modules, (a, b) => codeUnitCompare(a.id, b.id)), "modules").toBe(true);
        expect(isSorted(inv.imports, (a, b) => codeUnitCompare(a.occurrenceId, b.occurrenceId)), "imports").toBe(true);
        expect(isSorted(inv.diagnostics, diagnosticCompare), JSON.stringify(inv.diagnostics)).toBe(true);
        // Each absent target is one unresolved diagnostic, so the diagnostic list is never trivially empty here.
        const absent = project.statements.flat().filter((s) => s.target.kind === "absent").length;
        expect(inv.diagnostics.filter((d) => d.code === "unresolved").length).toBe(absent);
      }),
      { numRuns: RUNS },
    );
  });

  it("S2 (4.4) the same files in any order give the same bytes", async () => {
    await fc.assert(
      fc.asyncProperty(projectArb, fc.integer({ min: 0, max: 1000 }), async (project, seed) => {
        const files = filesOf(project);
        const reversed = [...files].reverse();
        const rotated = files.map((_, i) => files[(i + seed) % files.length] as SourceFile);
        const text = JSON.stringify(await investigate(files));
        expect(JSON.stringify(await investigate(reversed))).toBe(text);
        expect(JSON.stringify(await investigate(rotated))).toBe(text);
      }),
      { numRuns: RUNS },
    );
  });

  it("S3 (5.3) each component: members sorted, one witness that starts at the smallest member, visits each member once, and step i is a relation of the preset from modules[i] to modules[(i + 1) % n]", async () => {
    await fc.assert(
      fc.asyncProperty(projectArb, fc.constantFrom(...PRESETS), async (project, preset) => {
        const inv = await investigate(filesOf(project));
        const relations = new Map(presetRelations(inv, preset).map((r) => [r.relationId, r] as const));
        for (const component of findCycles(inv, preset).components) {
          const { members, witness } = component;
          expect(isSorted(members, codeUnitCompare), "members sorted").toBe(true);
          expect(new Set(members).size).toBe(members.length);
          expect(witness.modules[0]).toBe(members[0]);
          expect(witness.modules).toHaveLength(witness.relationIds.length);
          expect(new Set(witness.modules).size, "each module of the walk once").toBe(witness.modules.length);
          for (const id of witness.modules) expect(members).toContain(id);
          const n = witness.modules.length;
          witness.relationIds.forEach((relationId, i) => {
            const relation = relations.get(relationId);
            expect(relation, `step ${i} names a relation of ${preset}`).toBeDefined();
            expect(relation?.from).toBe(witness.modules[i]);
            expect(relation?.to).toBe(witness.modules[(i + 1) % n]);
          });
        }
      }),
      { numRuns: RUNS },
    );
  });

  it("S4 (6.2) visited is the origin and every reached module, sorted; distance of the origin is 0 and it has no predecessor; every other visited module has a predecessor one step nearer, joined to it by a relation of the preset in the traced direction", async () => {
    await fc.assert(
      fc.asyncProperty(projectArb, fc.constantFrom("imports" as const, "imported-by" as const), fc.constantFrom(...PRESETS), fc.nat(), async (project, direction, preset, pick) => {
        const inv = await investigate(filesOf(project));
        const origin = inv.modules[pick % inv.modules.length]?.id as string;
        const result = trace(inv, origin, direction, preset);
        expect(result.visited).toEqual([origin, ...result.direct, ...result.indirect].sort(codeUnitCompare));
        expect(isSorted(result.visited, codeUnitCompare)).toBe(true);
        expect(result.distance[origin]).toBe(0);
        expect(Object.prototype.hasOwnProperty.call(result.predecessor, origin)).toBe(false);
        expect(Object.keys(result.distance).sort(codeUnitCompare)).toEqual(result.visited);
        expect(Object.keys(result.predecessor).sort(codeUnitCompare)).toEqual(result.visited.filter((id) => id !== origin));
        const edges = new Set(presetRelations(inv, preset).map((r) => JSON.stringify(direction === "imports" ? [r.from, r.to] : [r.to, r.from])));
        for (const id of result.visited) {
          if (id === origin) continue;
          const before = result.predecessor[id] as string;
          expect(result.visited).toContain(before);
          expect(result.distance[id]).toBe((result.distance[before] as number) + 1);
          expect(edges.has(JSON.stringify([before, id])), `${before} to ${id} is a relation of ${preset}`).toBe(true);
        }
        for (const id of result.direct) expect(result.distance[id]).toBe(1);
        for (const id of result.indirect) expect(result.distance[id]).toBeGreaterThan(1);
      }),
      { numRuns: RUNS },
    );
  });
});
