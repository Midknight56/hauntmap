import type { AnalysisOptions, ComparisonResult, ImportRecord, Investigation, ModuleRecord, RelationRef } from "../../contracts/types";
import { findCycles } from "./cycles";

// Structural comparison of two investigations: modules by ID, relations by relation ID, files by
// source hash. Pure: no I/O, no hashing, no source text. Matching never reads a label, an occurrence
// ID, a line or a column.

export interface ComparisonDetail {
  detailVersion: 1;
  /** Sorted IDs present in both snapshots. */
  common: string[];
  /** One entry per module in `changedModules`: its import record count on each side. */
  occurrenceCounts: Record<string, { before: number; after: number }>;
  /** Keyed by `from`; only entries with a non-zero count. */
  relationChangesByModule: Record<string, { removed: number; added: number }>;
  /** Options fields whose JSON differs, in the key order of `AnalysisOptions`. */
  optionsDiffer: (keyof AnalysisOptions)[];
  /** Modules in both snapshots with `parseStatus: "failed"` on exactly that side. */
  parseFailed: { id: string; side: "before" | "after" }[];
  /** The five lists of the result are empty. */
  identical: boolean;
}

export type CompareError = { code: "incompatible-schema" | "incompatible-resolver"; message: string };

export type CompareOutcome = { ok: true; result: ComparisonResult; detail: ComparisonDetail } | { ok: false; error: CompareError };

/** UTF-16 code unit order; never `localeCompare`. */
export const codeUnitCompare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const OPTION_KEYS: (keyof AnalysisOptions)[] = [
  "preset",
  "includeExtensions",
  "excludeDirectories",
  "excludeFilePatterns",
  "maxFiles",
  "maxFileBytes",
  "maxTotalBytes",
  "jsToTsFallback",
];

/** Relation ID to its occurrences sorted by line, then column; the map's insertion order is the sorted relation ID order. */
export function relationIndex(inv: Investigation): Map<string, ImportRecord[]> {
  const grouped = new Map<string, ImportRecord[]>();
  for (const record of inv.imports) {
    const list = grouped.get(record.relationId);
    if (list === undefined) grouped.set(record.relationId, [record]);
    else list.push(record);
  }
  const index = new Map<string, ImportRecord[]>();
  for (const id of [...grouped.keys()].sort(codeUnitCompare)) {
    index.set(id, (grouped.get(id) as ImportRecord[]).sort((a, b) => a.line - b.line || a.column - b.column));
  }
  return index;
}

/** The number of distinct relation IDs. */
export function distinctRelationCount(inv: Investigation): number {
  return new Set(inv.imports.map((r) => r.relationId)).size;
}

function refOf(record: ImportRecord): RelationRef {
  return {
    relationId: record.relationId,
    from: record.from,
    to: record.to,
    specifier: record.specifier,
    syntaxKind: record.syntaxKind,
    dependencyKind: record.dependencyKind,
    resolution: record.resolution,
  };
}

function onlyIn(index: Map<string, ImportRecord[]>, other: Map<string, ImportRecord[]>): RelationRef[] {
  const refs: RelationRef[] = [];
  for (const [id, occurrences] of index) if (!other.has(id)) refs.push(refOf(occurrences[0] as ImportRecord));
  return refs.sort((a, b) => codeUnitCompare(a.relationId, b.relationId));
}

function countByFrom(inv: Investigation): Map<string, number> {
  const counts = new Map<string, number>();
  for (const record of inv.imports) counts.set(record.from, (counts.get(record.from) ?? 0) + 1);
  return counts;
}

function validate(before: Investigation, after: Investigation): CompareError | null {
  for (const inv of [before, after]) {
    if (inv.schemaVersion !== 1) return { code: "incompatible-schema", message: `schema version ${String(inv.schemaVersion)} is not 1` };
  }
  for (const inv of [before, after]) {
    if (inv.resolverMode !== "documented-source-subset") {
      return { code: "incompatible-resolver", message: `resolver mode "${String(inv.resolverMode)}" is not "documented-source-subset"` };
    }
  }
  return null;
}

export function compareInvestigations(before: Investigation, after: Investigation): CompareOutcome {
  const error = validate(before, after);
  if (error !== null) return { ok: false, error };

  const beforeModules = new Map<string, ModuleRecord>(before.modules.map((m) => [m.id, m]));
  const afterModules = new Map<string, ModuleRecord>(after.modules.map((m) => [m.id, m]));
  const common = [...beforeModules.keys()].filter((id) => afterModules.has(id)).sort(codeUnitCompare);
  const addedModules = [...afterModules.keys()].filter((id) => !beforeModules.has(id)).sort(codeUnitCompare);
  const removedModules = [...beforeModules.keys()].filter((id) => !afterModules.has(id)).sort(codeUnitCompare);
  const changedModules = common.filter((id) => (beforeModules.get(id) as ModuleRecord).sourceHash !== (afterModules.get(id) as ModuleRecord).sourceHash);

  const beforeIndex = relationIndex(before);
  const afterIndex = relationIndex(after);
  const addedRelations = onlyIn(afterIndex, beforeIndex);
  const removedRelations = onlyIn(beforeIndex, afterIndex);

  const result: ComparisonResult = {
    schemaVersion: 1,
    preset: "static-value",
    before: { label: before.sourceLabel, moduleCount: before.modules.length, relationCount: beforeIndex.size },
    after: { label: after.sourceLabel, moduleCount: after.modules.length, relationCount: afterIndex.size },
    addedModules,
    removedModules,
    changedModules,
    addedRelations,
    removedRelations,
    cyclicComponentsBefore: findCycles(before, "static-value").components.length,
    cyclicComponentsAfter: findCycles(after, "static-value").components.length,
  };

  const beforeCounts = countByFrom(before);
  const afterCounts = countByFrom(after);
  const occurrenceCounts: ComparisonDetail["occurrenceCounts"] = {};
  for (const id of changedModules) occurrenceCounts[id] = { before: beforeCounts.get(id) ?? 0, after: afterCounts.get(id) ?? 0 };

  const changes = new Map<string, { removed: number; added: number }>();
  const bump = (from: string, key: "removed" | "added"): void => {
    const entry = changes.get(from) ?? { removed: 0, added: 0 };
    entry[key] += 1;
    changes.set(from, entry);
  };
  for (const ref of removedRelations) bump(ref.from, "removed");
  for (const ref of addedRelations) bump(ref.from, "added");
  const relationChangesByModule: ComparisonDetail["relationChangesByModule"] = {};
  for (const from of [...changes.keys()].sort(codeUnitCompare)) relationChangesByModule[from] = changes.get(from) as { removed: number; added: number };

  const parseFailed: ComparisonDetail["parseFailed"] = [];
  for (const id of common) {
    const failedBefore = (beforeModules.get(id) as ModuleRecord).parseStatus === "failed";
    const failedAfter = (afterModules.get(id) as ModuleRecord).parseStatus === "failed";
    if (failedBefore !== failedAfter) parseFailed.push({ id, side: failedBefore ? "before" : "after" });
  }

  const detail: ComparisonDetail = {
    detailVersion: 1,
    common,
    occurrenceCounts,
    relationChangesByModule,
    optionsDiffer: OPTION_KEYS.filter((key) => JSON.stringify(before.options[key]) !== JSON.stringify(after.options[key])),
    parseFailed,
    identical: [addedModules, removedModules, changedModules, addedRelations, removedRelations].every((list) => list.length === 0),
  };
  return { ok: true, result, detail };
}
