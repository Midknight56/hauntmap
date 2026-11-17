import type { LegendEntry } from "./registry";

/** The legend of requirement 5.1: the real concept first, the costume word second. */
export const LEGEND_ENTRIES: LegendEntry[] = [
  { concept: "Module", costume: "room" },
  { concept: "Folder", costume: "wing" },
  { concept: "Import or re-export", costume: "door and arrow" },
  { concept: "Dependency cycle", costume: "looping corridor" },
  { concept: "Unresolved or external import", costume: "sealed doorway with ?" },
  { concept: "Not in this traversal", costume: "subdued room" },
  { concept: "Dependency path", costume: "traveling light" },
];

export const LEGEND_FOOTER = "Rooms show files and doors show imports found in the source. The map does not show runtime behaviour, test coverage or risk.";

export function legendText(entry: LegendEntry): string {
  return `${entry.concept}: ${entry.costume}`;
}

const BY_CONCEPT = new Map(LEGEND_ENTRIES.map((e) => [e.concept, legendText(e)]));

/** The wording of one of the seven entries, by concept. */
export function legendWording(concept: string): string {
  return BY_CONCEPT.get(concept) ?? concept;
}