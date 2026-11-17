import fc from "fast-check";
import { DEFAULT_ANALYSIS_OPTIONS } from "../../src/analysis";
import type { ImportRecord, Investigation, ModuleRecord } from "../../src/contracts/types";
import { boundaryRelationIdFor, occurrenceId, relationIdFor } from "./ids";

// Generators for the comparison tests. `makeInvestigation` is seeded (mulberry32), so every run of a
// seed gives the same investigation. Mutations are plain data; `expectedDiff` is derived from the
// mutation list and the base alone, with plain set operations and no call to `compare.ts`.

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface GenSpec {
  modules: number;
  wings: number;
  relationsPerModule: number;
  /** Share of relations that are external or unresolved boundaries, in [0, 1]. */
  boundaryShare: number;
  seed: number;
  /** Put `<`, `>`, `&`, quotes and backticks into IDs, specifiers and the label. */
  awkward?: boolean;
  /** `mixed` (default): about 85 % value, 10 % type and 5 % mixed imports; `value`: value imports only. */
  kinds?: "mixed" | "value";
}

const AWKWARD = ["<", ">", "&", '"', "'", "`"];
const KINDS: { kind: ImportRecord["dependencyKind"]; upTo: number }[] = [
  { kind: "value", upTo: 0.85 },
  { kind: "type", upTo: 0.95 },
  { kind: "mixed", upTo: 1 },
];

const pad = (n: number, width: number): string => String(n).padStart(width, "0");
const hex64 = (rand: () => number): string => Array.from({ length: 64 }, () => Math.floor(rand() * 16).toString(16)).join("");

function pickKind(rand: () => number): ImportRecord["dependencyKind"] {
  const r = rand();
  return (KINDS.find((k) => r < k.upTo) ?? KINDS[0])?.kind ?? "value";
}

function local(from: string, to: string, specifier: string, line: number, dependencyKind: ImportRecord["dependencyKind"] = "value"): ImportRecord {
  return {
    occurrenceId: occurrenceId(from, line, 1, specifier),
    relationId: relationIdFor(from, to, "import", dependencyKind),
    from,
    to,
    specifier,
    syntaxKind: "import",
    dependencyKind,
    resolution: "local",
    line,
    column: 1,
  };
}

function boundaryRecord(from: string, resolution: "external" | "unresolved", specifier: string, line: number): ImportRecord {
  return {
    occurrenceId: occurrenceId(from, line, 1, specifier),
    relationId: boundaryRelationIdFor(from, resolution, specifier, "import", "value"),
    from,
    to: null,
    specifier,
    syntaxKind: "import",
    dependencyKind: "value",
    resolution,
    line,
    column: 1,
    ...(resolution === "unresolved" ? { reason: "absent-file" as const } : {}),
  };
}

/** A deterministic investigation: module IDs `src/w<NN>/m<NNNN>.ts`, `relationsPerModule` distinct relations per module. */
export function makeInvestigation(spec: GenSpec): Investigation {
  const rand = mulberry32(spec.seed);
  const width = String(Math.max(spec.modules, spec.wings)).length;
  const special = (): string => (spec.awkward === true && rand() < 0.3 ? (AWKWARD[Math.floor(rand() * AWKWARD.length)] ?? "") : "");
  const ids: string[] = [];
  for (let i = 0; i < spec.modules; i++) ids.push(`src/w${pad(i % spec.wings, 2)}/m${pad(i, width)}${special()}.ts`);
  const modules: ModuleRecord[] = ids.map((id) => ({ id, sourceHash: hex64(rand), language: "ts", parseStatus: "ok" }));
  const imports: ImportRecord[] = [];
  const perModule = Math.min(spec.relationsPerModule, Math.max(0, spec.modules - 1));
  for (let i = 0; i < spec.modules; i++) {
    const from = ids[i] as string;
    const used = new Set<string>();
    for (let j = 0; j < perModule; j++) {
      if (rand() < spec.boundaryShare) {
        const external = rand() < 0.5;
        const name = `${external ? "pkg" : "./missing"}-${i}-${j}${special()}`;
        imports.push(boundaryRecord(from, external ? "external" : "unresolved", name, j + 1));
        continue;
      }
      let target = ids[Math.floor(rand() * ids.length)] as string;
      for (let guard = 0; (target === from || used.has(target)) && guard < 10_000; guard++) target = ids[Math.floor(rand() * ids.length)] as string;
      if (target === from || used.has(target)) {
        imports.push(boundaryRecord(from, "external", `pkg-${i}-${j}`, j + 1));
        continue;
      }
      used.add(target);
      imports.push(local(from, target, `./${target.slice(4)}`, j + 1, spec.kinds === "value" ? "value" : pickKind(rand)));
    }
  }
  const sortById = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return {
    schemaVersion: 1,
    resolverMode: "documented-source-subset",
    sourceLabel: spec.awkward === true ? `gen:${spec.seed}<&"'\`>` : `gen:${spec.seed}`,
    modules: modules.sort(sortById),
    imports,
    diagnostics: [],
    options: structuredClone(DEFAULT_ANALYSIS_OPTIONS),
  };
}

/** 1,000 modules in 40 wings of 25 and 3,000 value relations (every module imports three others), all drawn under static-value. */
export function perf1000(seed = 1000): Investigation {
  return makeInvestigation({ modules: 1000, wings: 40, relationsPerModule: 3, boundaryShare: 0, seed, kinds: "value" });
}

/** A small hand-shaped investigation: the given modules (hash placeholders) and `[from, to]` local value imports, one per line. */
export function simpleInvestigation(label: string, ids: readonly string[], edges: readonly (readonly [string, string])[] = [], hashOf: (id: string) => string = () => "c".repeat(64)): Investigation {
  const lineOf = new Map<string, number>();
  return {
    schemaVersion: 1,
    resolverMode: "documented-source-subset",
    sourceLabel: label,
    modules: [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map((id) => ({ id, sourceHash: hashOf(id), language: "ts" as const, parseStatus: "ok" as const })),
    imports: edges.map(([from, to]) => {
      const line = (lineOf.get(from) ?? 0) + 1;
      lineOf.set(from, line);
      return local(from, to, `./${to.slice(4)}`, line);
    }),
    diagnostics: [],
    options: structuredClone(DEFAULT_ANALYSIS_OPTIONS),
  };
}
// ---- mutations

export type Mutation =
  | { kind: "removeRelation"; relationId: string }
  | { kind: "addRelation"; from: string; to: string }
  | { kind: "changeHash"; id: string }
  | { kind: "shiftLines"; id: string; by: number }
  | { kind: "duplicateOccurrence"; relationId: string }
  | { kind: "dropDuplicate"; relationId: string }
  | { kind: "removeModule"; id: string }
  | { kind: "addModule"; id: string }
  | { kind: "renameModule"; id: string; to: string };

export const OCCURRENCE_KINDS = ["shiftLines", "duplicateOccurrence", "dropDuplicate", "changeHash"] as const;
export const ALL_KINDS = [
  "removeRelation",
  "addRelation",
  "changeHash",
  "shiftLines",
  "duplicateOccurrence",
  "dropDuplicate",
  "removeModule",
  "addModule",
  "renameModule",
] as const;

const maxLine = (inv: Investigation, from: string): number => inv.imports.reduce((n, r) => (r.from === from ? Math.max(n, r.line) : n), 0);

function retarget(r: ImportRecord, from: string, to: string | null): ImportRecord {
  const isLocal = r.resolution === "local" && to !== null;
  const relationId = isLocal
    ? relationIdFor(from, to, r.syntaxKind, r.dependencyKind)
    : boundaryRelationIdFor(from, r.resolution as "external", r.specifier, r.syntaxKind, r.dependencyKind);
  return { ...r, from, to: isLocal ? to : null, relationId, occurrenceId: occurrenceId(from, r.line, r.column, r.specifier) };
}

function applyOne(inv: Investigation, m: Mutation): Investigation {
  switch (m.kind) {
    case "removeRelation":
      return { ...inv, imports: inv.imports.filter((r) => r.relationId !== m.relationId) };
    case "addRelation":
      return { ...inv, imports: [...inv.imports, local(m.from, m.to, `./added/${m.to.slice(4)}`, maxLine(inv, m.from) + 1)] };
    case "changeHash":
      return {
        ...inv,
        modules: inv.modules.map((x) => (x.id === m.id ? { ...x, sourceHash: `${x.sourceHash.startsWith("f") ? "e" : "f"}${x.sourceHash.slice(1)}` } : x)),
      };
    case "shiftLines":
      return {
        ...inv,
        imports: inv.imports.map((r) =>
          r.from === m.id ? { ...r, line: r.line + m.by, occurrenceId: occurrenceId(r.from, r.line + m.by, r.column, r.specifier) } : r,
        ),
      };
    case "duplicateOccurrence": {
      const first = inv.imports.find((r) => r.relationId === m.relationId);
      if (first === undefined) return inv;
      const line = maxLine(inv, first.from) + 1;
      return { ...inv, imports: [...inv.imports, { ...first, line, occurrenceId: occurrenceId(first.from, line, first.column, first.specifier) }] };
    }
    case "dropDuplicate": {
      const same = inv.imports.filter((r) => r.relationId === m.relationId);
      const last = same[same.length - 1];
      if (same.length < 2 || last === undefined) return inv;
      return { ...inv, imports: inv.imports.filter((r) => r !== last) };
    }
    case "removeModule":
      return { ...inv, modules: inv.modules.filter((x) => x.id !== m.id), imports: inv.imports.filter((r) => r.from !== m.id && r.to !== m.id) };
    case "addModule":
      return {
        ...inv,
        modules: [...inv.modules, { id: m.id, sourceHash: `${"a".repeat(32)}${"b".repeat(32)}`, language: "ts", parseStatus: "ok" }],
      };
    case "renameModule":
      return {
        ...inv,
        modules: inv.modules.map((x) => (x.id === m.id ? { ...x, id: m.to } : x)),
        imports: inv.imports.map((r) => (r.from === m.id || r.to === m.id ? retarget(r, r.from === m.id ? m.to : r.from, r.to === m.id ? m.to : r.to) : r)),
      };
  }
}

/** The investigation after the mutations, labelled `<label>+after`. Mutations apply in order. */
export function mutate(base: Investigation, mutations: readonly Mutation[]): Investigation {
  let inv: Investigation = { ...base, sourceLabel: `${base.sourceLabel}+after` };
  for (const m of mutations) inv = applyOne(inv, m);
  return inv;
}

const codeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export interface ExpectedDiff {
  addedModules: string[];
  removedModules: string[];
  changedModules: string[];
  addedRelationIds: string[];
  removedRelationIds: string[];
}

/** What the comparison must report for `mutate(base, mutations)`, from plain set differences. */
export function expectedDiff(base: Investigation, mutations: readonly Mutation[]): ExpectedDiff {
  const after = mutate(base, mutations);
  const hashes = new Map(base.modules.map((m) => [m.id, m.sourceHash] as const));
  const afterHashes = new Map(after.modules.map((m) => [m.id, m.sourceHash] as const));
  const rels = new Set(base.imports.map((r) => r.relationId));
  const afterRels = new Set(after.imports.map((r) => r.relationId));
  return {
    addedModules: [...afterHashes.keys()].filter((id) => !hashes.has(id)).sort(codeUnit),
    removedModules: [...hashes.keys()].filter((id) => !afterHashes.has(id)).sort(codeUnit),
    changedModules: [...hashes.keys()].filter((id) => afterHashes.has(id) && afterHashes.get(id) !== hashes.get(id)).sort(codeUnit),
    addedRelationIds: [...afterRels].filter((id) => !rels.has(id)).sort(codeUnit),
    removedRelationIds: [...rels].filter((id) => !afterRels.has(id)).sort(codeUnit),
  };
}

// ---- arbitraries

/** A mutation as data that does not depend on the base: indexes are reduced modulo the working lists. */
export interface RawMutation {
  kind: (typeof ALL_KINDS)[number];
  a: number;
  b: number;
}

/** Turn raw mutations into valid concrete ones for `base`, dropping any that do not apply to the working state. */
export function resolveMutations(base: Investigation, raw: readonly (RawMutation | Mutation)[]): Mutation[] {
  const out: Mutation[] = [];
  let inv = base;
  let fresh = 0;
  for (const r of raw) {
    const concrete = "a" in r && "b" in r ? concretize(inv, r as RawMutation, () => `src/new/n${fresh++}.ts`) : (r as Mutation);
    if (concrete === null) continue;
    out.push(concrete);
    inv = applyOne(inv, concrete);
  }
  return out;
}

function concretize(inv: Investigation, r: RawMutation, freshId: () => string): Mutation | null {
  const mods = inv.modules;
  const at = <T>(list: readonly T[], n: number): T | undefined => (list.length === 0 ? undefined : list[n % list.length]);
  const relIds = [...new Set(inv.imports.map((x) => x.relationId))];
  switch (r.kind) {
    case "removeRelation": {
      const id = at(relIds, r.a);
      return id === undefined ? null : { kind: "removeRelation", relationId: id };
    }
    case "addRelation": {
      const from = at(mods, r.a);
      const to = at(mods, r.b);
      if (from === undefined || to === undefined || from.id === to.id) return null;
      if (inv.imports.some((x) => x.relationId === relationIdFor(from.id, to.id, "import", "value"))) return null;
      return { kind: "addRelation", from: from.id, to: to.id };
    }
    case "changeHash": {
      const m = at(mods, r.a);
      return m === undefined ? null : { kind: "changeHash", id: m.id };
    }
    case "shiftLines": {
      const m = at(mods, r.a);
      return m === undefined ? null : { kind: "shiftLines", id: m.id, by: 1 + (r.b % 5) };
    }
    case "duplicateOccurrence": {
      const id = at(relIds, r.a);
      return id === undefined ? null : { kind: "duplicateOccurrence", relationId: id };
    }
    case "dropDuplicate": {
      const dup = relIds.filter((id) => inv.imports.filter((x) => x.relationId === id).length > 1);
      const id = at(dup, r.a);
      return id === undefined ? null : { kind: "dropDuplicate", relationId: id };
    }
    case "removeModule": {
      const m = at(mods, r.a);
      return m === undefined || mods.length < 2 ? null : { kind: "removeModule", id: m.id };
    }
    case "addModule":
      return { kind: "addModule", id: freshId() };
    case "renameModule": {
      const m = at(mods, r.a);
      return m === undefined ? null : { kind: "renameModule", id: m.id, to: freshId() };
    }
  }
}

export interface GeneratedPair {
  before: Investigation;
  after: Investigation;
  mutations: Mutation[];
}

function pairArbitrary(kinds: readonly (typeof ALL_KINDS)[number][], maxMutations: number): fc.Arbitrary<GeneratedPair> {
  return fc
    .record({
      seed: fc.integer({ min: 1, max: 0x7fffffff }),
      modules: fc.integer({ min: 2, max: 200 }),
      wings: fc.integer({ min: 1, max: 8 }),
      relationsPerModule: fc.integer({ min: 0, max: 4 }),
      raw: fc.array(
        fc.record({ kind: fc.constantFrom(...kinds), a: fc.nat({ max: 10_000 }), b: fc.nat({ max: 10_000 }) }),
        { maxLength: maxMutations },
      ),
    })
    .map(({ seed, modules, wings, relationsPerModule, raw }) => {
      const before = makeInvestigation({ modules, wings, relationsPerModule, boundaryShare: 0.1, seed, awkward: true });
      const mutations = resolveMutations(before, raw);
      return { before, after: mutate(before, mutations), mutations };
    });
}

/** A base of 2-200 modules in 1-8 wings with 0-4 relations per module, 10 % boundaries, awkward strings, and 0-12 mutations. */
export function arbitraryPair(): fc.Arbitrary<GeneratedPair> {
  return pairArbitrary(ALL_KINDS, 12);
}

/** Mutations restricted to the ones that never change a module set or a relation ID set. */
export function arbitraryOccurrenceOnlyPair(): fc.Arbitrary<GeneratedPair> {
  return pairArbitrary(OCCURRENCE_KINDS, 12);
}
