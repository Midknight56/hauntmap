import type { LayoutResult } from "../layout/types";
import { comparisonStateOf, type ComparisonStyle } from "./index";

// Where a removed or an added relation shows on a wing that is collapsed. Its door is not drawn then (the rooms are
// behind the wall), so the wing carries the change itself: a dashed doorway for a removed relation and a doorway in
// moss for an added one, on the right wall. Pure, no PixiJS.

export interface CollapsedMark {
  wing: string;
  kind: "removed" | "added";
  relationId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const MARK_W = 28;
export const MARK_H = 34;

/** The wing of a module ID: its folder, or `(root)`. The same rule as the layout. */
function wingOfModule(id: string): string {
  const cut = id.lastIndexOf("/");
  return cut > 0 ? id.slice(0, cut) : "(root)";
}

/** The modules a relation ID names: the importer and, for a local relation, the target. Empty for an ID that cannot be read. */
function modulesOf(relationId: string): string[] {
  try {
    const parsed: unknown = JSON.parse(relationId);
    if (!Array.isArray(parsed) || typeof parsed[0] !== "string") return [];
    const target: unknown = parsed[1];
    const out = [parsed[0]];
    if (Array.isArray(target) && target[0] === "local" && typeof target[1] === "string") out.push(target[1]);
    return out;
  } catch {
    return [];
  }
}

export function collapsedWingMarks(layout: Pick<LayoutResult, "wings" | "doors" | "sealed">, style: ComparisonStyle | null): CollapsedMark[] {
  if (style === null || style.shown !== "after") return [];
  const drawn = new Set([...layout.doors.map((d) => d.relationId), ...layout.sealed.map((s) => s.relationId)]);
  const lists = [
    { kind: "removed" as const, ids: style.removedRelationIds, state: "comparison-removed", at: 0.35 },
    { kind: "added" as const, ids: style.addedRelationIds, state: "comparison-added", at: 0.68 },
  ];
  const out: CollapsedMark[] = [];
  for (const wing of layout.wings) {
    if (wing.expanded) continue;
    for (const list of lists) {
      const hit = list.ids.find(
        (id) => !drawn.has(id) && comparisonStateOf(style, { kind: "door", id }) === list.state && modulesOf(id).some((m) => wingOfModule(m) === wing.wing),
      );
      if (hit === undefined) continue;
      out.push({ wing: wing.wing, kind: list.kind, relationId: hit, x: wing.x + wing.w - MARK_W / 2, y: wing.y + wing.h * list.at - MARK_H / 2, w: MARK_W, h: MARK_H });
    }
  }
  return out;
}