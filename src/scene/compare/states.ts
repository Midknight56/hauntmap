import { Graphics, Text, type Container } from "pixi.js";
import { FONT } from "../elements";
import type { Rect } from "../layout/types";
import { TOKENS } from "../styles";
import type { ComparisonView } from "./view";

// The comparison marks that the element textures do not carry. PixiJS; called by the scene adapter.
function dashedOutline(g: Graphics, r: Rect, color: string): void {
  const dash = 6;
  const gap = 4;
  const edge = (x1: number, y1: number, x2: number, y2: number): void => {
    const length = Math.hypot(x2 - x1, y2 - y1);
    for (let t = 0; t < length; t += dash + gap) {
      const end = Math.min(t + dash, length);
      g.moveTo(x1 + ((x2 - x1) * t) / length, y1 + ((y2 - y1) * t) / length).lineTo(x1 + ((x2 - x1) * end) / length, y1 + ((y2 - y1) * end) / length);
    }
  };
  edge(r.x, r.y, r.x + r.w, r.y);
  edge(r.x + r.w, r.y, r.x + r.w, r.y + r.h);
  edge(r.x + r.w, r.y + r.h, r.x, r.y + r.h);
  edge(r.x, r.y + r.h, r.x, r.y);
  g.stroke({ width: 2, color });
}

function plus(x: number, y: number): Text {
  const text = new Text({ text: "+", style: { fontFamily: FONT, fontSize: 13, fill: TOKENS.added, fontWeight: "700", stroke: { color: TOKENS.floor, width: 3 } } });
  text.anchor.set(0.5);
  text.position.set(x, y);
  return text;
}

/**
 * The marks the textures do not carry: the amber lamp on the north edge of a changed room, the `+` of an added
 * door or sealed doorway, and, where a fleet state kept its own texture, the `+` of an added room and the dashed
 * ghost outline of a removed element.
 */
export function drawComparisonMarks(layer: Container, view: ComparisonView): void {
  const g = new Graphics();
  let used = false;
  for (const room of view.drawn.rooms) {
    const c = view.marks.rooms.get(room.id);
    if (c === undefined) continue;
    const own = view.states.rooms.get(room.id) === c;
    if (c === "comparison-changed") {
      const cx = room.x + room.w / 2;
      g.circle(cx, room.y, 6).fill(TOKENS.changed).stroke({ width: 1.5, color: TOKENS.floor });
      g.rect(cx - 3, room.y + 5, 6, 3).fill(TOKENS.changed);
      used = true;
    } else if (c === "comparison-added" && !own) {
      layer.addChild(plus(room.x + room.w - 10, room.y + 10));
    } else if (c === "comparison-removed" && !own) {
      dashedOutline(g, { x: room.x - 3, y: room.y - 3, w: room.w + 6, h: room.h + 6 }, TOKENS.removed);
      used = true;
    }
  }
  for (const door of view.drawn.doors) {
    const c = view.marks.doors.get(door.relationId);
    if (c === "comparison-added") layer.addChild(plus(door.x + door.w + 6, door.y - 4));
    else if (c === "comparison-removed" && view.states.doors.get(door.relationId)?.state !== c) {
      dashedOutline(g, { x: door.x - 3, y: door.y - 3, w: door.w + 6, h: door.h + 6 }, TOKENS.removed);
      used = true;
    }
  }
  for (const s of view.drawn.sealed) {
    const c = view.marks.sealed.get(s.relationId);
    if (c === "comparison-added") layer.addChild(plus(s.x + s.w + 6, s.y - 4));
    else if (c === "comparison-removed" && view.states.sealed.get(s.relationId) !== c) {
      dashedOutline(g, { x: s.x - 3, y: s.y - 3, w: s.w + 6, h: s.h + 6 }, TOKENS.removed);
      used = true;
    }
  }
  if (used) layer.addChild(g);
  else g.destroy();
}