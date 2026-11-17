import type { ImportRecord } from "../contracts/types";
import type { InvestigationStore } from "../features/investigation/store";
import { wingOf } from "../features/investigation/wings";

// The selecting actions of the DOM controls. A DOM selection of a module also expands its wing so
// that the room is drawn (requirement 4.2); a relation never expands anything (6.7).

export function selectModule(store: InvestigationStore, id: string): void {
  store.actions.select({ kind: "module", id }, { from: "dom" });
  store.actions.expandWing(wingOf(id), id);
}

export function selectRelation(store: InvestigationStore, record: Pick<ImportRecord, "relationId" | "occurrenceId">): void {
  store.actions.select({ kind: "relation", relationId: record.relationId, occurrenceId: record.occurrenceId }, { from: "dom" });
}

export function selectWing(store: InvestigationStore, wing: string): void {
  store.actions.select({ kind: "wing", wing }, { from: "dom" });
}

/** Attributes that make an item show the tooltip of a map element when it has focus (5.2). */
export function tipProps(kind: "room" | "door" | "sealed" | "wing", id: string): { "data-tip-kind": string; "data-tip-id": string } {
  return { "data-tip-kind": kind, "data-tip-id": id };
}

export function relationTip(record: Pick<ImportRecord, "relationId" | "to">): { "data-tip-kind": string; "data-tip-id": string } {
  return tipProps(record.to === null ? "sealed" : "door", record.relationId);
}
