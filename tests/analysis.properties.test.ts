import { createHash } from "node:crypto";
import fc from "fast-check";
import { describe, it } from "vitest";
import { findCycles } from "../src/analysis/graph/cycles";
import { presetRelations } from "../src/analysis/graph/presets";
import { trace } from "../src/analysis/graph/trace";
import { analyze } from "../src/analysis/parser/analyze";
import { selectSources } from "../src/analysis/parser/select";
import { DEFAULT_ANALYSIS_OPTIONS } from "../src/contracts/options";
import type { Investigation, Preset, SourceFile } from "../src/contracts/types";

const nodeHash = (text: string): Promise<string> => Promise.resolve(createHash("sha256").update(text, "utf8").digest("hex"));
const PRESETS: Preset[] = ["static-value", "type-inclusive", "dynamic-inclusive"];
const RUNS = 100;

// ---- generators: small sets of files with known imports ----

type Form = "value" | "type" | "mixed" | "side-effect" | "re-export" | "re-export-type" | "star" | "star-type";
type Target = { kind: "module"; index: number } | { kind: "external" } | { kind: "absent" };
interface Statement {
  form: Form;
  target: Target;
}
interface Project {
  moduleCount: number;
  statements: Statement[][];
}

const formArb: fc.Arbitrary<Form> = fc.constantFrom<Form>(
  "value",
  "type",
  "mixed",
  "side-effect",
  "re-export",
  "re-export-type",
  "star",
  "star-type",
);

const projectArb: fc.Arbitrary<Project> = fc.integer({ min: 1, max: 7 }).chain((moduleCount) => {
  const targetArb: fc.Arbitrary<Target> = fc.oneof(
    { weight: 8, arbitrary: fc.integer({ min: 0, max: moduleCount - 1 }).map((index): Target => ({ kind: "module", index })) },
    { weight: 1, arbitrary: fc.constant<Target>({ kind: "external" }) },
    { weight: 1, arbitrary: fc.constant<Target>({ kind: "absent" }) },
  );
  const statementArb = fc.record({ form: formArb, target: targetArb });
  return fc
    .array(fc.array(statementArb, { maxLength: 6 }), { minLength: moduleCount, maxLength: moduleCount })
    .map((statements) => ({ moduleCount, statements }));
});

const moduleName = (index: number): string => `m${index}.ts`;

function specifierOf(target: Target): string {
  if (target.kind === "module") return `./m${target.index}`;
  return target.kind === "external" ? "some-package" : "./absent";
}

function statementText(statement: Statement, position: number): string {
  const from = JSON.stringify(specifierOf(statement.target));
  switch (statement.form) {
    case "value":
      return `import { v${position} } from ${from};`;
    case "type":
      return `import type { T${position} } from ${from};`;
    case "mixed":
      return `import { v${position}, type T${position} } from ${from};`;
    case "side-effect":
      return `import ${from};`;
    case "re-export":
      return `export { v${position} } from ${from};`;
    case "re-export-type":
      return `export type { T${position} } from ${from};`;
    case "star":
      return `export * from ${from};`;
    case "star-type":
      return `export type * from ${from};`;
  }
}

function filesOf(project: Project): SourceFile[] {
  return project.statements.map((statements, index) => {
    const text = statements.map((s, position) => statementText(s, position)).join("\n") + "\nexport const own = 1;\n";
    return { path: moduleName(index), text, bytes: Buffer.byteLength(text, "utf8") };
  });
}

async function investigate(files: SourceFile[]): Promise<Investigation> {
  const selected = selectSources(files, "property", DEFAULT_ANALYSIS_OPTIONS);
  if (!selected.ok) throw new Error("selection failed");
  return analyze(selected.sourceSet, DEFAULT_ANALYSIS_OPTIONS, nodeHash, undefined, selected.diagnostics);
}

function shuffled<T>(items: T[], seed: number): T[] {
  const copy = [...items];
  let state = seed;
  for (let i = copy.length - 1; i > 0; i--) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const j = state % (i + 1);
    const held = copy[i] as T;
    copy[i] = copy[j] as T;
    copy[j] = held;
  }
  return copy;
}

describe("analysis properties", () => {
  it("P1 same input, same bytes: across runs and file order", async () => {
    await fc.assert(
      fc.asyncProperty(projectArb, fc.integer({ min: 1, max: 1_000_000 }), async (project, seed) => {
        const files = filesOf(project);
        const first = await investigate(files);
        const again = await investigate(files);
        const other = await investigate(shuffled(files, seed));
        const text = JSON.stringify(first);
        if (JSON.stringify(again) !== text || JSON.stringify(other) !== text) return false;
        for (const preset of PRESETS) {
          if (JSON.stringify(findCycles(other, preset)) !== JSON.stringify(findCycles(first, preset))) return false;
        }
        return true;
      }),
      { numRuns: RUNS },
    );
  });

  it("P2 every import is accounted for: one record for each statement written", async () => {
    await fc.assert(
      fc.asyncProperty(projectArb, async (project) => {
        const investigation = await investigate(filesOf(project));
        const written = project.statements.reduce((sum, list) => sum + list.length, 0);
        if (investigation.imports.length !== written) return false;
        const ids = new Set(investigation.imports.map((i) => i.occurrenceId));
        return ids.size === written && investigation.modules.every((m) => m.parseStatus === "ok");
      }),
      { numRuns: RUNS },
    );
  });

  it("P3 a local edge has a real target", async () => {
    await fc.assert(
      fc.asyncProperty(projectArb, async (project) => {
        const investigation = await investigate(filesOf(project));
        const ids = new Set(investigation.modules.map((m) => m.id));
        return investigation.imports.every((i) =>
          i.resolution === "local" ? i.to !== null && ids.has(i.to) : i.to === null,
        );
      }),
      { numRuns: RUNS },
    );
  });

  it("P4 the witness is a real loop that starts at the smallest member", async () => {
    await fc.assert(
      fc.asyncProperty(projectArb, async (project) => {
        const investigation = await investigate(filesOf(project));
        for (const preset of PRESETS) {
          const relations = new Map(presetRelations(investigation, preset).map((r) => [r.relationId, r]));
          for (const component of findCycles(investigation, preset).components) {
            const { modules, relationIds } = component.witness;
            if (modules.length !== relationIds.length || modules.length === 0) return false;
            if (modules[0] !== component.members[0]) return false;
            if (new Set(modules).size !== modules.length) return false;
            if (!modules.every((m) => component.members.includes(m))) return false;
            for (let i = 0; i < modules.length; i++) {
              const relation = relations.get(relationIds[i] as string);
              if (relation === undefined) return false;
              if (relation.from !== modules[i] || relation.to !== modules[(i + 1) % modules.length]) return false;
            }
          }
        }
        return true;
      }),
      { numRuns: RUNS },
    );
  });

  it("P5 components do not overlap and every member reaches every other member", async () => {
    await fc.assert(
      fc.asyncProperty(projectArb, async (project) => {
        const investigation = await investigate(filesOf(project));
        for (const preset of PRESETS) {
          const components = findCycles(investigation, preset).components;
          const seen = new Set<string>();
          for (const component of components) {
            for (const member of component.members) {
              if (seen.has(member)) return false;
              seen.add(member);
              const reached = new Set(trace(investigation, member, "imports", preset).visited);
              if (!component.members.every((other) => reached.has(other))) return false;
            }
          }
          // A module outside every component that imports itself would be a missed self-loop.
          const selfLoops = presetRelations(investigation, preset).filter((r) => r.from === r.to);
          if (!selfLoops.every((r) => seen.has(r.from))) return false;
        }
        return true;
      }),
      { numRuns: RUNS },
    );
  });

  it("P6 trace distances are shortest", async () => {
    await fc.assert(
      fc.asyncProperty(projectArb, fc.constantFrom("imports", "imported-by"), fc.constantFrom(...PRESETS), fc.nat(), async (project, direction, preset, pick) => {
        const investigation = await investigate(filesOf(project));
        const origin = moduleName(pick % project.moduleCount);
        const result = trace(investigation, origin, direction, preset);
        if (result.distance[origin] !== 0 || origin in result.predecessor) return false;
        for (const id of result.visited) {
          let steps = 0;
          let at = id;
          while (at !== origin) {
            const before = result.predecessor[at];
            if (before === undefined) return false;
            at = before;
            steps += 1;
            if (steps > result.visited.length) return false;
          }
          if (steps !== result.distance[id]) return false;
        }
        for (const relation of presetRelations(investigation, preset)) {
          const [u, v] = direction === "imports" ? [relation.from, relation.to as string] : [relation.to as string, relation.from];
          const du = result.distance[u];
          if (du === undefined) continue;
          const dv = result.distance[v];
          if (dv === undefined || dv > du + 1) return false;
        }
        return true;
      }),
      { numRuns: RUNS },
    );
  });

  it("P7 preset order: static-value relations are a subset of the other two presets", async () => {
    await fc.assert(
      fc.asyncProperty(projectArb, async (project) => {
        const investigation = await investigate(filesOf(project));
        const base = presetRelations(investigation, "static-value").map((r) => r.relationId);
        for (const preset of ["type-inclusive", "dynamic-inclusive"] as const) {
          const other = new Set(presetRelations(investigation, preset).map((r) => r.relationId));
          if (!base.every((id) => other.has(id))) return false;
        }
        return true;
      }),
      { numRuns: RUNS },
    );
  });
});
