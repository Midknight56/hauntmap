import { Graphics, Sprite, Text } from "pixi.js";
import { FONT } from "./elements";
import { pinText, type DrawContext } from "./rooms";
import type { LayoutResult, Point } from "./layout/types";
import { REMOVED_ALPHA, SEALED_GLYPH, TOKENS, removedStrokeWidth, type State } from "./styles";
import { polylineLength, polylinePrefix } from "./walk";

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
    const removed = info.state === "comparison-removed";
    const width = removed ? removedStrokeWidth(ctx.zoom) : info.state === "default" ? 2 : info.state === "comparison-added" ? 4.5 : 3;
    const points = door.arrow;
    const shared = info.state === "default";
    const line = shared ? (faded ? dim : plain) : new Graphics();
    /** Stroke the path (or the part of it that is drawn) and, when it is complete, the arrow head. */
    const paint = (g: Graphics, pts: readonly Point[], withHead: boolean): void => {
      const first = pts[0] as Point;
      const to = pts[pts.length - 1] as Point;
      if (info.state === "comparison-removed") {
        dashedPolyline(g, pts, Math.max(7, width * 2.2), Math.max(5, width * 1.4));
        g.stroke({ width, color, alpha: REMOVED_ALPHA, join: "round", cap: "butt" });
      } else {
        g.moveTo(first.x, first.y);
        for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
        g.stroke({ width, color, alpha: faded ? FADED_PASSAGE_ALPHA : info.state === "default" ? 0.85 : 1, join: "round", cap: "round" });
      }
      if (!withHead) return;
      // The head follows the last segment that has a direction.
      let before: Point = first;
      for (let i = pts.length - 2; i >= 0; i--) {
        const p = pts[i] as Point;
        if (Math.hypot(to.x - p.x, to.y - p.y) > 0.5) {
          before = p;
          break;
        }
      }
      const angle = Math.atan2(to.y - before.y, to.x - before.x);
      const head = info.state === "default" ? 6 : 8;
      g.poly([
        to.x,
        to.y,
        to.x - head * Math.cos(angle - 0.45),
        to.y - head * Math.sin(angle - 0.45),
        to.x - head * Math.cos(angle + 0.45),
        to.y - head * Math.sin(angle + 0.45),
      ]).fill({ color, alpha: faded ? FADED_PASSAGE_ALPHA : 1 });
    };
    paint(line, points, true);
    if (info.state === "comparison-removed") ctx.fx?.removedOutlines.push(line);    if (!shared) layer.addChild(line);
    const sprite = new Sprite(ctx.textures.get("door", info.state));
    sprite.position.set(door.x, door.y);
    sprite.width = door.w;
    sprite.height = door.h;
    if (faded) sprite.alpha = FADED_DOOR_ALPHA;
    layer.addChild(sprite);
    if (ctx.fx !== undefined) {
      ctx.fx.doorSprites.set(door.relationId, sprite);
      if (info.state === "selected") {
        // The door of the selected relation opens: it swings from its left jamb, and its corridor draws toward the target.
        const state = { swing: 1, draw: 1 };
        const total = polylineLength(points);
        ctx.fx.openDoor = {
          relationId: door.relationId,
          get swing() {
            return state.swing;
          },
          get draw() {
            return state.draw;
          },
          setSwing(fraction) {
            state.swing = fraction;
            // A redraw may have destroyed the door while its effect still runs.
            if (sprite.destroyed) return;
            sprite.width = Math.max(1, door.w * (0.15 + 0.85 * fraction));
          },
          setDraw(fraction) {
            state.draw = fraction;
            if (line.destroyed) return;
            line.clear();
            paint(line, fraction >= 1 ? points : polylinePrefix(points, total * fraction), fraction >= 1);
          },
        };
      }
    }
    if (info.step !== null) layer.addChild(pinText(ctx, "step", String(info.step), stepMark(info.step, door.x + door.w / 2, door.y + door.h / 2 - 14), STEP_FONT));
  }
  for (const sealed of layout.sealed) {
    const state = ctx.states.sealed.get(sealed.relationId) ?? "default";
    const sprite = new Sprite(ctx.textures.get("sealed", state));
    sprite.position.set(sealed.x, sealed.y);
    sprite.width = sealed.w;
    sprite.height = sealed.h;
    if (ctx.related !== null && state === "default" && !ctx.related.has(sealed.relationId)) sprite.alpha = FADED_DOOR_ALPHA;
    const layer = state === "default" ? ctx.layers.rooms : ctx.layers.selected;
    layer.addChild(sprite);
    // The `?` that marks the sealed doorway is a text of the scene, so that it keeps 12 CSS pixels at every zoom.
    const mark = new Text({ text: SEALED_GLYPH, style: { fontFamily: FONT, fontSize: 12, fill: TOKENS.sealed, fontWeight: "700" } });
    mark.anchor.set(0.5);
    mark.position.set(sealed.x + sealed.w / 2, sealed.y + sealed.h * 0.42);
    if (sprite.alpha < 1) mark.alpha = sprite.alpha;
    layer.addChild(pinText(ctx, "glyph", sealed.relationId, mark, 12));
  }
}

/** A step number: the number itself is the companion to the route color. */
export const STEP_FONT = 13;
export function stepMark(step: number, x: number, y: number): Text {
  const text = new Text({ text: String(step), style: { fontFamily: FONT, fontSize: STEP_FONT, fill: TOKENS.ink, fontWeight: "700", stroke: { color: TOKENS.panel, width: 4 } } });
  text.anchor.set(0.5);
  text.position.set(x, y);
  return text;
}
