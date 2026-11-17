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

function plus(x: number, y: number, size = 13): Text {
  const text = new Text({ text: "+", style: { fontFamily: FONT, fontSize: size, fill: TOKENS.added, fontWeight: "700", stroke: { color: TOKENS.floor, width: 3 } } });
  text.anchor.set(0.5);
  text.position.set(x, y);
  return text;
}

/**
 * The marks the textures do not carry: the amber lamp on the north edge of a changed room, the `+` of an added
 * door or sealed doorway, and, where a fleet state kept its own texture, the `+` of an added room and the dashed
 * ghost outline of a removed element.
 */
/** A wide ring around a removed (dashed ghost) or added (solid) door, so that the two changes are the first things the eye finds. */
function ring(g: Graphics, rect: Rect, color: string, dashed: boolean): void {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  g.circle(cx, cy, 28).fill({ color, alpha: 0.14 });
  if (!dashed) {
    g.circle(cx, cy, 24).stroke({ width: 3, color });
    return;
  }
  const dashes = 14;
  for (let i = 0; i < dashes; i++) {
    const a0 = (i / dashes) * Math.PI * 2;
    const a1 = a0 + (Math.PI * 2) / dashes / 1.7;
    g.moveTo(cx + Math.cos(a0) * 24, cy + Math.sin(a0) * 24).arc(cx, cy, 24, a0, a1);
  }
  g.stroke({ width: 3, color });
}

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
    if (c === "comparison-added") {
      ring(g, door, TOKENS.added, false);
      layer.addChild(plus(door.x + door.w + 10, door.y - 8, 20));
      used = true;
    } else if (c === "comparison-removed") {
      ring(g, door, TOKENS.removed, true);
      if (view.states.doors.get(door.relationId)?.state !== c) dashedOutline(g, { x: door.x - 3, y: door.y - 3, w: door.w + 6, h: door.h + 6 }, TOKENS.removed);
      used = true;
    }
  }
  for (const s of view.drawn.sealed) {
    const c = view.marks.sealed.get(s.relationId);
    if (c === "comparison-added") {
      ring(g, s, TOKENS.added, false);
      layer.addChild(plus(s.x + s.w + 10, s.y - 8, 20));
      used = true;
    } else if (c === "comparison-removed") {
      ring(g, s, TOKENS.removed, true);
      if (view.states.sealed.get(s.relationId) !== c) dashedOutline(g, { x: s.x - 3, y: s.y - 3, w: s.w + 6, h: s.h + 6 }, TOKENS.removed);
      used = true;
    }
  }
  if (used) layer.addChild(g);
  else g.destroy();
}