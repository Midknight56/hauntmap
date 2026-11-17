import { wingOf } from "../features/investigation/wings";
import type { HitKind } from "./types";
import type { LayoutResult, Rect } from "./layout/types";

function rectOf(box: Rect): Rect {
  return { x: box.x, y: box.y, w: box.w, h: box.h };
}

/** The importer of a relation ID (`JSON.stringify([from, targetKey, syntaxKind, dependencyKind])`), or null. */
function importerOf(relationId: string): string | null {
  try {
    const parsed: unknown = JSON.parse(relationId);
    if (Array.isArray(parsed) && typeof parsed[0] === "string") return parsed[0];
  } catch {
    // Not a relation ID.
  }
  return null;
}

/**
 * The rectangle of a target in scene units. A door or sealed doorway that is not drawn (an end room is
 * not drawn) falls back to the importer's room, then to the importer's wing region.
 */
export function rectOfTarget(layout: LayoutResult, target: { kind: HitKind; id: string }): Rect | null {
  switch (target.kind) {
    case "room": {
      const room = layout.rooms.find((r) => r.id === target.id);
      return room === undefined ? null : rectOf(room);
    }
    case "wing": {
      const wing = layout.wings.find((w) => w.wing === target.id);
      return wing === undefined ? null : rectOf(wing);
    }
    case "grouped": {
      const grouped = layout.grouped.find((g) => g.wing === target.id);
      return grouped === undefined ? null : rectOf(grouped);
    }
    case "door":
    case "sealed": {
      const list = target.kind === "door" ? layout.doors : layout.sealed;
      const own = list.find((d) => d.relationId === target.id);
      if (own !== undefined) return rectOf(own);
      const from = importerOf(target.id);
      if (from === null) return null;
      const room = layout.rooms.find((r) => r.id === from);
      if (room !== undefined) return rectOf(room);
      const wing = layout.wings.find((w) => w.wing === wingOf(from));
      return wing === undefined ? null : rectOf(wing);
    }
  }
}