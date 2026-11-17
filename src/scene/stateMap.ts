import type { LayoutResult } from "./layout/types";
import type { State } from "./styles";
import type { StyleState } from "./types";

// Which state every drawn element is in, derived from the selection and the route filter. Pure.

export interface DoorState {
  state: State;
  /** One-based step number for a relation on a witness or trace route. */
  step: number | null;
}

export interface SceneStates {
  rooms: Map<string, State>;
  wings: Map<string, State>;
  doors: Map<string, DoorState>;
  sealed: Map<string, State>;
  haloRoom: string | null;
  route: { kind: "witness" | "trace" | "focus"; modules: string[]; relationIds: string[] } | null;
}

export function deriveStates(layout: LayoutResult, style: StyleState): SceneStates {
  const { selection, routeFilter } = style;
  const route = routeFilter === null ? null : { kind: routeFilter.kind, modules: routeFilter.modules, relationIds: routeFilter.relationIds };
  const inRoute = route === null ? null : new Set(route.modules);
  const stepOf = new Map<string, number>();
  if (route !== null && route.kind !== "focus") route.relationIds.forEach((id, i) => stepOf.set(id, i + 1));
  const routeState: State = route?.kind === "trace" ? "trace" : route?.kind === "witness" ? "witness" : "default";

  const rooms = new Map<string, State>();
  for (const room of layout.rooms) {
    if (selection.kind === "module" && selection.id === room.id) rooms.set(room.id, "selected");
    else if (inRoute !== null) rooms.set(room.id, inRoute.has(room.id) ? routeState : "subdued");
    else rooms.set(room.id, "default");
  }

  const wings = new Map<string, State>();
  for (const wing of layout.wings) wings.set(wing.wing, selection.kind === "wing" && selection.wing === wing.wing ? "selected" : "default");

  const selectedRelation = selection.kind === "relation" ? selection.relationId : null;
  const doors = new Map<string, DoorState>();
  for (const door of layout.doors) {
    const step = stepOf.get(door.relationId) ?? null;
    if (door.relationId === selectedRelation) doors.set(door.relationId, { state: "selected", step });
    else if (step !== null) doors.set(door.relationId, { state: routeState, step });
    else doors.set(door.relationId, { state: "default", step: null });
  }

  const sealed = new Map<string, State>();
  for (const s of layout.sealed) sealed.set(s.relationId, s.relationId === selectedRelation ? "selected" : "default");

  return { rooms, wings, doors, sealed, haloRoom: selection.kind === "module" && rooms.has(selection.id) ? selection.id : null, route };
}