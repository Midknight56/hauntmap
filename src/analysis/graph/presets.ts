import type { ImportRecord, Investigation, Preset } from "../../contracts/types";

type RelationShape = Pick<ImportRecord, "syntaxKind" | "dependencyKind" | "resolution">;

/**
 * Whether a preset takes a relation. Only resolved local relations enter the graph.
 * `static-value`: `import` and `re-export` syntax with `value` or `mixed` kind.
 * `type-inclusive`: those, and every `import` or `re-export` relation of `type` kind.
 * `dynamic-inclusive`: the `static-value` relations, and `dynamic-literal` syntax.
 * The two larger presets are siblings: neither takes the other's addition.
 */
export function includesRelation(preset: Preset, relation: RelationShape): boolean {
  if (relation.resolution !== "local") return false;
  if (relation.syntaxKind === "dynamic-literal") return preset === "dynamic-inclusive";
  if (relation.dependencyKind === "type") return preset === "type-inclusive";
  return true;
}

/**
 * The resolved local relations a preset includes, one record for each `relationId` (repeated
 * imports collapse to the first occurrence), sorted by `relationId` in UTF-16 code unit order.
 */
export function presetRelations(investigation: Investigation, preset: Preset): ImportRecord[] {
  const byId = new Map<string, ImportRecord>();
  for (const record of investigation.imports) {
    if (record.to === null || !includesRelation(preset, record)) continue;
    if (!byId.has(record.relationId)) byId.set(record.relationId, record);
  }
  return [...byId.values()].sort((a, b) => (a.relationId < b.relationId ? -1 : a.relationId > b.relationId ? 1 : 0));
}
