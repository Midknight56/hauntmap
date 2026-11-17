import { Graphics, Sprite, Text } from "pixi.js";
import { FONT } from "./elements";
import type { DrawContext } from "./rooms";
import type { LayoutResult, Point } from "./layout/types";
import { TOKENS, type State } from "./styles";

/** The color of a passage: dim by default, so that only the passages of a selection, a loop or a comparison stand out. */
function passageColor(state: State): string {
  switch (state) {
    case "witness":
      return TOKENS.corridor;
    case "trace":
      return TOKENS.light;
    case "selected":
      return TOKENS.focus;
    case "comparison-removed":
      return TOKENS.removed;
    case "comparison-added":
      return TOKENS.added;
    default:
      return TOKENS.passage;
  }
}

/** Passages that are not part of the selection, the route or the comparison are drawn at this opacity. */
export const FADED_PASSAGE_ALPHA = 0.22;
export const FADED_DOOR_ALPHA = 0.55;

/** Draw a polyline as dashes (the ghost of a removed passage). */
export function dashedPolyline(g: Graphics, points: readonly Point[], dash: number, gap: number): void {
  let carry = 0;
  let drawing = true;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Point;
    const b = points[i] as Point;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length === 0) continue;
    const dx = (b.x - a.x) / length;
    const dy = (b.y - a.y) / length;
    let t = 0;
    while (t < length) {
      const run = (drawing ? dash : gap) - carry;
      const end = Math.min(length, t + run);
      if (drawing) g.moveTo(a.x + dx * t, a.y + dy * t).lineTo(a.x + dx * end, a.y + dy * end);
      carry += end - t;
      t = end;
      if (carry >= (drawing ? dash : gap) - 1e-9) {
        drawing = !drawing;
        carry = 0;
      }
    }
  }
}

/** Doors with arrows, sealed doorways with `?`, and the step numbers of a witness or trace route. */
export function drawDoors(ctx: DrawContext, layout: LayoutResult): void {
  // Every door in the default state shares two Graphics (bright and faded): one draw call each instead of one per door.
  const plain = new Graphics();
  const dim = new Graphics();
  ctx.layers.rooms.addChild(plain, dim);
  for (const door of layout.doors) {
    const info = ctx.states.doors.get(door.relationId) ?? { state: "default" as State, step: null };
    const layer = info.state === "default" ? ctx.layers.rooms : ctx.layers.selected;
    const faded = ctx.related !== null && info.state === "default" && !ctx.related.has(door.relationId);
    const color = passageColor(info.state);
    const width = info.state === "default" ? 2 : info.state === "comparison-added" ? 4.5 : 3;
    const points = door.arrow;
    const shared = info.state === "default";
    const line = shared ? (faded ? dim : plain) : new Graphics();
    const first = points[0] as Point;
    const to = points[points.length - 1] as Point;
    if (info.state === "comparison-removed") {
      dashedPolyline(line, points, 7, 5);
      line.stroke({ width, color, alpha: 1, join: "round", cap: "round" });
    } else {
      line.moveTo(first.x, first.y);
      for (const p of points.slice(1)) line.lineTo(p.x, p.y);
      line.stroke({ width, color, alpha: faded ? FADED_PASSAGE_ALPHA : info.state === "default" ? 0.85 : 1, join: "round", cap: "round" });
    }
    // The head follows the last segment that has a direction.
    let before: Point = first;
    for (let i = points.length - 2; i >= 0; i--) {
      const p = points[i] as Point;
      if (Math.hypot(to.x - p.x, to.y - p.y) > 0.5) {
        before = p;
        break;
      }
    }
    const angle = Math.atan2(to.y - before.y, to.x - before.x);
    const head = info.state === "default" ? 6 : 8;
    line
      .poly([
        to.x,
        to.y,
        to.x - head * Math.cos(angle - 0.45),
        to.y - head * Math.sin(angle - 0.45),
        to.x - head * Math.cos(angle + 0.45),
        to.y - head * Math.sin(angle + 0.45),
      ])
      .fill({ color, alpha: faded ? FADED_PASSAGE_ALPHA : 1 });
    if (!shared) layer.addChild(line);
    const sprite = new Sprite(ctx.textures.get("door", info.state));
    sprite.position.set(door.x, door.y);
    sprite.width = door.w;
    sprite.height = door.h;
    if (faded) sprite.alpha = FADED_DOOR_ALPHA;
    layer.addChild(sprite);
    if (info.step !== null) layer.addChild(stepMark(info.step, door.x + door.w / 2, door.y + door.h / 2 - 14));
  }
  for (const sealed of layout.sealed) {
    const state = ctx.states.sealed.get(sealed.relationId) ?? "default";
    const sprite = new Sprite(ctx.textures.get("sealed", state));
    sprite.position.set(sealed.x, sealed.y);
    sprite.width = sealed.w;
    sprite.height = sealed.h;
    if (ctx.related !== null && state === "default" && !ctx.related.has(sealed.relationId)) sprite.alpha = FADED_DOOR_ALPHA;
    (state === "default" ? ctx.layers.rooms : ctx.layers.selected).addChild(sprite);
  }
}

/** A step number: the number itself is the companion to the route color. */
export function stepMark(step: number, x: number, y: number): Text {
  const text = new Text({ text: String(step), style: { fontFamily: FONT, fontSize: 13, fill: TOKENS.ink, fontWeight: "700", stroke: { color: TOKENS.panel, width: 4 } } });
  text.anchor.set(0.5);
  text.position.set(x, y);
  return text;
}
