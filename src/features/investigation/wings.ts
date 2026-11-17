import type { ImportRecord, Investigation, Preset } from "../../contracts/types";
import type { AnalysisApi } from "./analysisApi";

/** The wing of a module is its directory; a top-level file belongs to `(root)`. */
export function wingOf(moduleId: string): string {
  const slash = moduleId.lastIndexOf("/");
  return slash < 0 ? "(root)" : moduleId.slice(0, slash);
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Every wing with its module IDs, sorted by wing and by ID. */
export function wingsOf(investigation: Investigation): { wing: string; moduleIds: string[] }[] {
  const byWing = new Map<string, string[]>();
  for (const module of investigation.modules) {
    const wing = wingOf(module.id);
    const list = byWing.get(wing);
    if (list === undefined) byWing.set(wing, [module.id]);
    else list.push(module.id);
  }
  return [...byWing.entries()]
    .sort(([a], [b]) => compareText(a, b))
    .map(([wing, moduleIds]) => ({ wing, moduleIds: moduleIds.sort(compareText) }));
}

/** One record per relation ID: the first occurrence by line, then column. */
function firstPerRelation(records: ImportRecord[]): ImportRecord[] {
  const first = new Map<string, ImportRecord>();
  for (const record of records) {
    const known = first.get(record.relationId);
    if (known === undefined || record.line < known.line || (record.line === known.line && record.column < known.column)) {
      first.set(record.relationId, record);
    }
  }
  return [...first.values()].sort((a, b) => compareText(a.relationId, b.relationId));
}

/** Local relations the preset admits whose two ends are both modules of the investigation. */
export function drawnRelations(investigation: Investigation, preset: Preset, api: AnalysisApi): ImportRecord[] {
  const ids = new Set(investigation.modules.map((m) => m.id));
  return firstPerRelation(
    investigation.imports.filter(
      (r) => r.resolution === "local" && r.to !== null && ids.has(r.from) && ids.has(r.to) && api.inPreset(r, preset),
    ),
  );
}

/** External, unresolved and unsupported relations the preset admits, from a module of the investigation. */
export function boundaryRelations(investigation: Investigation, preset: Preset, api: AnalysisApi): ImportRecord[] {
  const ids = new Set(investigation.modules.map((m) => m.id));
  return firstPerRelation(investigation.imports.filter((r) => r.resolution !== "local" && ids.has(r.from) && api.inPreset(r, preset)));
}
