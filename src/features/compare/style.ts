import type { ComparisonStyle } from "../../scene/compare";
import type { CompareState } from "./store";

/** The comparison style for the scene, or null when no comparison is active. Pure. */
export function styleOf(state: CompareState): ComparisonStyle | null {
  if (state.status !== "active" || state.result === null || state.before === null || state.after === null) return null;
  const { result } = state;
  return {
    comparisonStyleVersion: 1,
    shown: state.shown,
    changedModules: [...result.changedModules],
    removedModules: [...result.removedModules],
    addedModules: [...result.addedModules],
    removedRelationIds: result.removedRelations.map((r) => r.relationId),
    addedRelationIds: result.addedRelations.map((r) => r.relationId),
    closingRelationIds: [...state.closingRelationIds],
    earlierLabel: state.before.label,
    newerLabel: state.after.label,
  };
}