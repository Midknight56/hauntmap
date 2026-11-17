import type { RouteFilter, Selection } from "../features/investigation/selection";
import type { ComparisonState } from "./compare";
import type { LayoutResult } from "./layout/types";

// Which passages stay bright (item 6b of the theme pass). With a selection, a route or a comparison on screen, the
// passages that belong to none of them fade, so the eye finds the ones that matter. Pure, no PixiJS.

export interface EmphasisInput {
  selection: Selection;
  routeFilter: RouteFilter | null;
  marks: { rooms: ReadonlyMap<string, ComparisonState>; doors: ReadonlyMap<string, ComparisonState>; sealed: ReadonlyMap<string, ComparisonState> };
}

/**
 * The relation IDs that stay bright, or null when nothing is selected, routed or compared (then nothing fades).
 * A selected room keeps the doors it has; a selected wing keeps the doors of its rooms; a selected relation keeps
 * itself; a route keeps its relations; a comparison keeps every removed or added door (a changed room is shown by
 * its lamp, and its doors fade with the rest, so the two changed doors are what the eye finds first).
 */
export function relatedRelations(layout: Pick<LayoutResult, "rooms" | "doors" | "sealed">, input: EmphasisInput): Set<string> | null {
  const { selection, routeFilter, marks } = input;
  const comparing = marks.rooms.size + marks.doors.size + marks.sealed.size > 0;
  if (selection.kind === "none" && routeFilter === null && !comparing) return null;
  const keep = new Set<string>();
  if (routeFilter !== null) for (const id of routeFilter.relationIds) keep.add(id);
  if (selection.kind === "relation") keep.add(selection.relationId);
  const wingOf = new Map(layout.rooms.map((r) => [r.id, r.wing] as const));
  const touches = (room: string): boolean =>
    (selection.kind === "module" && selection.id === room) ||
    (selection.kind === "wing" && wingOf.get(room) === selection.wing);
  for (const door of layout.doors) if (touches(door.from) || touches(door.to)) keep.add(door.relationId);
  for (const sealed of layout.sealed) if (touches(sealed.from)) keep.add(sealed.relationId);
  for (const id of marks.doors.keys()) keep.add(id);
  for (const id of marks.sealed.keys()) keep.add(id);
  return keep;
}
