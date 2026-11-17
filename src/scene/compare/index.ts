// The comparison layer of the scene (snapshot-comparison). The style arrives through
// `StyleState.comparison`; labels are carried for the panel and never read when a state is chosen (5.8).

export type Side = "before" | "after";

export interface ComparisonStyle {
  comparisonStyleVersion: 1;
  shown: Side;
  changedModules: string[];
  removedModules: string[];
  addedModules: string[];
  removedRelationIds: string[];
  addedRelationIds: string[];
  /** Removed relation IDs the dropped witness held; the scene closes their corridor when this set changes. */
  closingRelationIds: string[];
  earlierLabel: string;
  newerLabel: string;
}

export type ComparisonState = "default" | "comparison-changed" | "comparison-removed" | "comparison-added" | "hidden";

/** The non-color companion of each comparison state (5.4). */
export const COMPANIONS = {
  "comparison-changed": "lamp",
  "comparison-removed": "dashed outline",
  "comparison-added": "+",
} as const;

/** The closing-corridor fade, in milliseconds. */
export const CLOSING_MS = 600;

/** What development builds add to `scene.debug()`: the comparison state of every room (module ID) and door or sealed doorway (relation ID). */
export interface ComparisonDebug {
  states: Record<string, ComparisonState>;
}

/**
 * Rooms: a changed module is `comparison-changed` in both views; a removed one is a ghost in the newer view and
 * ordinary in the earlier one; an added one is `comparison-added` in the newer view and hidden in the earlier
 * one. Doors and sealed doorways follow the relation lists the same way.
 */
export function comparisonStateOf(style: ComparisonStyle | null, target: { kind: "room" | "door" | "sealed"; id: string }): ComparisonState {
  if (style === null) return "default";
  const newer = style.shown === "after";
  if (target.kind === "room") {
    if (style.changedModules.includes(target.id)) return "comparison-changed";
    if (style.removedModules.includes(target.id)) return newer ? "comparison-removed" : "default";
    if (style.addedModules.includes(target.id)) return newer ? "comparison-added" : "hidden";
    return "default";
  }
  if (style.removedRelationIds.includes(target.id)) return newer ? "comparison-removed" : "default";
  if (style.addedRelationIds.includes(target.id)) return newer ? "comparison-added" : "hidden";
  return "default";
}

// Pure parts only, so that tests and the panel can import this file without PixiJS. The adapter imports
// `./states` (the marks) and `./transition` (the closing corridor) directly.
export { applyComparison, type ComparisonView } from "./view";
export { closingKey, shouldClose } from "./closing";