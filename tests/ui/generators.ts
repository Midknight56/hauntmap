import { DEFAULT_ANALYSIS_OPTIONS } from "../../src/contracts/options";
import type { ImportRecord, Investigation, ModuleRecord } from "../../src/contracts/types";
import { occurrenceId, relationId, relationIdFor } from "./ids";

/** mulberry32: a small deterministic PRNG. Returns numbers in [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface MakeInvestigationOptions {
  /** Wing path to module count, for example `{ "src/big": 120, "src/small": 5 }`. */
  wings: Record<string, number>;
  relationsPerModule: number;
  seed: number;
  /** Chance that a module also has one boundary import (external, absent or alias). Default 0. */
  boundaryRatio?: number;
  sourceLabel?: string;
}

function pad3(n: number): string {
  return String(n).padStart(3, "0");
}

function hashOf(id: string): string {
  // A stable 64-digit hexadecimal string; the UI never reads it.
  let out = "";
  let h = 2166136261;
  for (let i = 0; out.length < 64; i++) {
    h = Math.imul(h ^ (id.charCodeAt(i % id.length) + i), 16777619) >>> 0;
    out += h.toString(16).padStart(8, "0");
  }
  return out.slice(0, 64);
}

function specifierBetween(from: string, to: string): string {
  const fromDir = from.slice(0, from.lastIndexOf("/")).split("/");
  const toDir = to.slice(0, to.lastIndexOf("/")).split("/");
  let shared = 0;
  while (shared < fromDir.length && shared < toDir.length && fromDir[shared] === toDir[shared]) shared++;
  const up = fromDir.length - shared;
  const down = toDir.slice(shared);
  const file = to.slice(to.lastIndexOf("/") + 1).replace(/\.ts$/, "");
  const prefix = up === 0 ? "./" : "../".repeat(up);
  return `${prefix}${[...down, file].join("/")}`;
}

/**
 * A deterministic investigation. Module IDs are `<wing>/m<NNN>.ts` with a zero-padded three-digit
 * index per wing, so lexical order equals numeric order. Each module imports exactly
 * `relationsPerModule` distinct other modules, so the relation count is `modules * relationsPerModule`.
 */
export function makeInvestigation(options: MakeInvestigationOptions): Investigation {
  const random = mulberry32(options.seed);
  const ratio = options.boundaryRatio ?? 0;
  const modules: ModuleRecord[] = [];
  for (const wing of Object.keys(options.wings).sort()) {
    const count = options.wings[wing] ?? 0;
    for (let i = 0; i < count; i++) {
      const id = `${wing}/m${pad3(i)}.ts`;
      modules.push({ id, sourceHash: hashOf(id), language: "ts", parseStatus: "ok" });
    }
  }
  modules.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (options.relationsPerModule > modules.length - 1) {
    throw new Error("relationsPerModule needs at least relationsPerModule + 1 modules");
  }
  const imports: ImportRecord[] = [];
  for (const from of modules) {
    const targets = new Set<string>();
    while (targets.size < options.relationsPerModule) {
      const pick = modules[Math.floor(random() * modules.length)];
      if (pick !== undefined && pick.id !== from.id) targets.add(pick.id);
    }
    let line = 1;
    for (const to of [...targets].sort()) {
      const specifier = specifierBetween(from.id, to);
      imports.push({
        occurrenceId: occurrenceId(from.id, line, 1, specifier),
        relationId: relationIdFor(from.id, to, "import", "value"),
        from: from.id,
        to,
        specifier,
        syntaxKind: "import",
        dependencyKind: "value",
        resolution: "local",
        line,
        column: 1,
      });
      line++;
    }
    if (ratio > 0 && random() < ratio) {
      const pick = Math.floor(random() * 3);
      const specifier = pick === 0 ? `pkg-${from.id.length}` : pick === 1 ? `./missing/${from.id.length}` : `@/lib/${from.id.length}`;
      const resolution = pick === 0 ? "external" : "unresolved";
      const reason = pick === 1 ? "absent-file" : pick === 2 ? "alias-not-configured" : undefined;
      imports.push({
        occurrenceId: occurrenceId(from.id, line, 1, specifier),
        relationId: relationId(from.id, [resolution, specifier], "import", "value"),
        from: from.id,
        to: null,
        specifier,
        syntaxKind: "import",
        dependencyKind: "value",
        resolution,
        line,
        column: 1,
        ...(reason === undefined ? {} : { reason }),
      });
    }
  }
  return {
    schemaVersion: 1,
    resolverMode: "documented-source-subset",
    sourceLabel: options.sourceLabel ?? "generated",
    modules,
    imports,
    diagnostics: [],
    options: { ...DEFAULT_ANALYSIS_OPTIONS },
  };
}

function eightWings(count: number): Record<string, number> {
  const wings: Record<string, number> = {};
  for (let i = 0; i < count; i++) wings[`src/w${String(i).padStart(2, "0")}`] = 0;
  return wings;
}

function spread(wingCount: number, modules: number): Record<string, number> {
  const wings = eightWings(wingCount);
  const each = modules / wingCount;
  for (const wing of Object.keys(wings)) wings[wing] = each;
  return wings;
}

/** 120 modules in `src/big` (m000 to m119) and 5 in `src/small`, two relations per module. */
export const wide: Investigation = makeInvestigation({
  wings: { "src/big": 120, "src/small": 5 },
  relationsPerModule: 2,
  seed: 1,
  sourceLabel: "wide",
});

/** 200 modules in 8 wings, 600 relations. */
export const perf200: Investigation = makeInvestigation({
  wings: spread(8, 200),
  relationsPerModule: 3,
  seed: 2,
  sourceLabel: "perf200",
});

/** 1,000 modules in 40 wings, 3,000 relations. */
export const perf1000: Investigation = makeInvestigation({
  wings: spread(40, 1000),
  relationsPerModule: 3,
  seed: 3,
  sourceLabel: "perf1000",
});
