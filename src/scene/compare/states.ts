import { Graphics, Text, type Container } from "pixi.js";
import { dashedPolyline } from "../doors";
import { FONT } from "../elements";
import type { CollapsedMark } from "./collapsed";
import type { Point, Rect } from "../layout/types";
import { TOKENS } from "../styles";
import { pinText, type SceneLabel } from "../rooms";
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

export function drawComparisonMarks(layer: Container, view: ComparisonView, pin: { labels: SceneLabel[]; zoom: number }): void {
  const mark = (id: string, node: Text, size: number): Text => pinText(pin, "glyph", id, node, size);
  const g = new Graphics();
  let used = false;
  for (const room of view.drawn.rooms) {
    const c = view.marks.rooms.get(room.id);
    if (c === undefined) continue;
    const own = view.states.rooms.get(room.id) === c;
    if (c === "comparison-changed") {
      // The candle lamp of the design: 14 px, with a glow, on the top right corner of the room.
      const r = Math.min(12, Math.max(7, 7 / pin.zoom));
      const cx = room.x + room.w - r * 0.4;
      const cy = room.y + r * 0.4;
      g.circle(cx, cy, r * 2).fill({ color: TOKENS.changed, alpha: 0.14 });
      g.circle(cx, cy, r * 1.5).fill({ color: TOKENS.changed, alpha: 0.24 });
      g.circle(cx, cy, r).fill(TOKENS.changed).stroke({ width: 1.5, color: TOKENS.floor });
      used = true;
    } else if (c === "comparison-added" && !own) {
      layer.addChild(mark(room.id, plus(room.x + room.w - 10, room.y + 10), 13));
    } else if (c === "comparison-removed" && !own) {
      dashedOutline(g, { x: room.x - 3, y: room.y - 3, w: room.w + 6, h: room.h + 6 }, TOKENS.removed);
      used = true;
    }
  }
  for (const door of view.drawn.doors) {
    const c = view.marks.doors.get(door.relationId);
    if (c === "comparison-added") {
      ring(g, door, TOKENS.added, false);
      layer.addChild(mark(door.relationId, plus(door.x + door.w + 10, door.y - 8, 20), 20));
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
      layer.addChild(mark(s.relationId, plus(s.x + s.w + 10, s.y - 8, 20), 20));
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

/** The points of an arched doorway: up the left jamb, over the arch, down the right jamb. */
function archPoints(m: CollapsedMark): Point[] {
  const r = m.w / 2;
  const pts: Point[] = [{ x: m.x, y: m.y + m.h }, { x: m.x, y: m.y + r }];
  for (let i = 1; i < 12; i++) {
    const a = Math.PI + (Math.PI * i) / 12;
    pts.push({ x: m.x + r + Math.cos(a) * r, y: m.y + r + Math.sin(a) * r });
  }
  pts.push({ x: m.x + m.w, y: m.y + r }, { x: m.x + m.w, y: m.y + m.h });
  return pts;
}

/**
 * The change on a collapsed wing (item 9 of the design pass): a dashed doorway in bone for a removed relation and a
 * doorway in moss, with a `+`, for an added one, on the wall of the wing whose rooms are not drawn.
 */
export function drawCollapsedMarks(layer: Container, marks: readonly CollapsedMark[], pin: { labels: SceneLabel[]; zoom: number }): void {
  if (marks.length === 0) return;
  const g = new Graphics();
  for (const m of marks) {
    const pts = archPoints(m);
    const cx = m.x + m.w / 2;
    const cy = m.y + m.h / 2;
    if (m.kind === "removed") {
      g.circle(cx, cy, 26).fill({ color: TOKENS.removed, alpha: 0.1 });
      g.poly(pts).fill({ color: TOKENS.floor, alpha: 0.85 });
      dashedPolyline(g, pts, 6, 4);
      g.stroke({ width: 3, color: TOKENS.removed });
    } else {
      g.circle(cx, cy, 28).fill({ color: TOKENS.added, alpha: 0.14 });
      g.poly(pts).fill({ color: TOKENS.added, alpha: 0.3 });
      g.poly(pts, false).stroke({ width: 3.5, color: TOKENS.added, join: "round", cap: "round" });
    }
  }
  layer.addChild(g);
  for (const m of marks) {
    if (m.kind === "added") layer.addChild(pinText(pin, "glyph", m.relationId, plus(m.x + m.w + 12, m.y - 6, 20), 20));
  }
}
