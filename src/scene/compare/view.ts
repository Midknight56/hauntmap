import type { LayoutResult } from "../layout/types";
import type { DoorState, SceneStates } from "../stateMap";
import { comparisonStateOf, type ComparisonState, type ComparisonStyle } from "./index";

// Which comparison state every element is in, and the layout that is drawn and hit-tested. Pure, no PixiJS.

export interface ComparisonView {
  /** The layout to draw and hit-test: hidden rooms, doors and sealed doorways removed, every other box unchanged. */
  drawn: LayoutResult;
  /** The fleet's states with the comparison state put in wherever the fleet state is `default`. */
  states: SceneStates;
  /** Comparison states of drawn elements, for the marks drawn on top of the textures. */
  marks: { rooms: Map<string, ComparisonState>; doors: Map<string, ComparisonState>; sealed: Map<string, ComparisonState> };
  /** The comparison state of every element of the layout, for `scene.debug().states`. */
  debug: Record<string, ComparisonState>;
}

const isMark = (s: ComparisonState): boolean => s !== "default" && s !== "hidden";

/**
 * Apply a comparison style to the fleet's states. Pure. The fleet's selected, subdued, witness and trace states
 * keep their texture (outline and halo take precedence); the comparison mark is then drawn on top.
 */
export function applyComparison(layout: LayoutResult, fleet: SceneStates, style: ComparisonStyle | null): ComparisonView {
  const debug: Record<string, ComparisonState> = {};
  const marks: ComparisonView["marks"] = { rooms: new Map(), doors: new Map(), sealed: new Map() };
  if (style === null) {
    for (const r of layout.rooms) debug[r.id] = "default";
    for (const d of layout.doors) debug[d.relationId] = "default";
    for (const s of layout.sealed) debug[s.relationId] = "default";
    return { drawn: layout, states: fleet, marks, debug };
  }
  const rooms = new Map(fleet.rooms);
  const doors = new Map<string, DoorState>(fleet.doors);
  const sealed = new Map(fleet.sealed);
  const hiddenRooms = new Set<string>();
  const hiddenDoors = new Set<string>();
  const hiddenSealed = new Set<string>();

  for (const room of layout.rooms) {
    const c = comparisonStateOf(style, { kind: "room", id: room.id });
    debug[room.id] = c;
    if (c === "hidden") hiddenRooms.add(room.id);
    else if (isMark(c)) {
      marks.rooms.set(room.id, c);
      if ((rooms.get(room.id) ?? "default") === "default") rooms.set(room.id, c as never);
    }
  }
  for (const door of layout.doors) {
    const c = comparisonStateOf(style, { kind: "door", id: door.relationId });
    debug[door.relationId] = c;
    if (c === "hidden" || hiddenRooms.has(door.from) || hiddenRooms.has(door.to)) hiddenDoors.add(door.relationId);
    else if (isMark(c)) {
      marks.doors.set(door.relationId, c);
      const now = doors.get(door.relationId);
      if (now === undefined || now.state === "default") doors.set(door.relationId, { state: c as never, step: now?.step ?? null });
    }
  }
  for (const s of layout.sealed) {
    const c = comparisonStateOf(style, { kind: "sealed", id: s.relationId });
    debug[s.relationId] = c;
    if (c === "hidden" || hiddenRooms.has(s.from)) hiddenSealed.add(s.relationId);
    else if (isMark(c)) {
      marks.sealed.set(s.relationId, c);
      if ((sealed.get(s.relationId) ?? "default") === "default") sealed.set(s.relationId, c as never);
    }
  }

  const drawn: LayoutResult =
    hiddenRooms.size + hiddenDoors.size + hiddenSealed.size === 0
      ? layout
      : {
          ...layout,
          rooms: layout.rooms.filter((r) => !hiddenRooms.has(r.id)),
          doors: layout.doors.filter((d) => !hiddenDoors.has(d.relationId)),
          sealed: layout.sealed.filter((s) => !hiddenSealed.has(s.relationId)),
        };
  for (const id of hiddenRooms) rooms.delete(id);
  for (const id of hiddenDoors) doors.delete(id);
  for (const id of hiddenSealed) sealed.delete(id);
  return {
    drawn,
    states: { ...fleet, rooms, doors, sealed, haloRoom: fleet.haloRoom !== null && hiddenRooms.has(fleet.haloRoom) ? null : fleet.haloRoom },
    marks,
    debug,
  };
}
