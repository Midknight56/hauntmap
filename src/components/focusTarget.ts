import type { Investigation } from "../contracts/types";
import { wingOf } from "../features/investigation/wings";
import type { Selection } from "../features/investigation/selection";
import type { LayoutResult } from "../scene/layout/types";
import type { HitKind } from "../scene/types";

export interface FocusTarget {
  kind: HitKind;
  id: string;
}

/**
 * What the camera centers on for a selection (requirement 6.7): the room of a module, the door of
 * a relation, the importer's room when the door is not drawn, or the importer's wing when that room
 * is not drawn either. Null when there is nothing to center on.
 */
export function focusTargetOf(selection: Selection, layout: LayoutResult, investigation: Investigation | null): FocusTarget | null {
  const roomDrawn = (id: string): boolean => layout.rooms.some((r) => r.id === id);
  const wingDrawn = (wing: string): boolean => layout.wings.some((w) => w.wing === wing);
  const roomOrWing = (id: string): FocusTarget | null => {
    if (roomDrawn(id)) return { kind: "room", id };
    const wing = wingOf(id);
    return wingDrawn(wing) ? { kind: "wing", id: wing } : null;
  };
  switch (selection.kind) {
    case "none":
      return null;
    case "wing":
      return wingDrawn(selection.wing) ? { kind: "wing", id: selection.wing } : null;
    case "module":
      return roomOrWing(selection.id);
    case "relation": {
      if (layout.doors.some((d) => d.relationId === selection.relationId)) return { kind: "door", id: selection.relationId };
      if (layout.sealed.some((s) => s.relationId === selection.relationId)) return { kind: "sealed", id: selection.relationId };
      const record = investigation?.imports.find((r) => r.relationId === selection.relationId);
      return record === undefined ? null : roomOrWing(record.from);
    }
  }
}