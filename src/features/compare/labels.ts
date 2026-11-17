import type { ComparisonDetail } from "../../analysis/graph/compare";
import type { RelationRef } from "../../contracts/types";

type RelationLike = Pick<RelationRef, "from" | "to" | "specifier" | "syntaxKind" | "dependencyKind" | "resolution">;

/** The wording of one list item (7.2). Plain text; the panel renders it as a text node. */
export function itemLabel(item: RelationLike | string, detail: ComparisonDetail | null): string {
  if (typeof item !== "string") {
    if (item.resolution === "local" && item.to !== null) return `${item.from} imports ${item.to} \u00b7 ${item.syntaxKind} \u00b7 ${item.dependencyKind}`;
    return `${item.from} \u2192 "${item.specifier}" \u00b7 ${item.resolution}`;
  }
  const counts = detail?.occurrenceCounts[item];
  if (counts === undefined) return item;
  let label = `${item} \u00b7 import statements ${counts.before} \u2192 ${counts.after}`;
  const changes = detail?.relationChangesByModule[item];
  if (changes !== undefined && (changes.removed > 0 || changes.added > 0)) label += ` \u00b7 ${changes.removed} relations removed, ${changes.added} added`;
  return label;
}

/** The heading of a relation: `<from> imports <to>` or `<from> → "<specifier>"`. */
export function relationHeading(item: RelationLike): string {
  return item.resolution === "local" && item.to !== null ? `${item.from} imports ${item.to}` : `${item.from} \u2192 "${item.specifier}"`;
}