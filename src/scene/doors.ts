import { Container, Graphics, Sprite, Text } from "pixi.js";
import { easeInOut } from "./effects";
import { FONT, shade } from "./elements";
import { pinText, type DrawContext } from "./rooms";
import type { DoorLeaf } from "./fx";
import type { DoorBox, LayoutResult, Point } from "./layout/types";
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

/** A door of a loop, a route or the selected relation is drawn so that its leaf is this wide on the screen at the zoom of the draw (the stated look is 10 to 14 px). */
export const LEAF_TARGET_PX = 12;
/** The most the leaf and its doorway grow past the 16 unit door of the layout. */
const LEAF_MAX_GROW = 2.2;

/** The corners of the arch of the door in the 16 unit grid of its texture. */
function archPath(g: Graphics): void {
  g.moveTo(3, 14.5).lineTo(3, 7).arc(8, 7, 5, Math.PI, 0).lineTo(13, 14.5).closePath();
}

/**
 * The doorway of a door that swings: a dark arch with a stone frame, drawn at the size of the leaf, into one Graphics shared by every
 * door of the map (one draw call). The leaf swings in front of it. Drawing only.
 */
function drawDoorway(g: Graphics, door: DoorBox, grow: number, color: string): void {
  const sx = (door.w / 16) * grow;
  const sy = (door.h / 16) * grow;
  const ox = door.x + door.w / 2 - 8 * sx;
  const oy = door.y + door.h / 2 - 8 * sy;
  const at = (gx: number, gy: number): Point => ({ x: ox + gx * sx, y: oy + gy * sy });
  const pts: Point[] = [at(3, 14.5), at(3, 7)];
  for (let i = 1; i <= 8; i++) {
    const a = Math.PI + (Math.PI * i) / 8;
    pts.push(at(8 + 5 * Math.cos(a), 7 + 5 * Math.sin(a)));
  }
  pts.push(at(13, 14.5));
  const flat = pts.flatMap((p) => [p.x, p.y]);
  g.poly(flat).fill({ color: shade(TOKENS.floor, -0.6), alpha: 0.96 });
  g.poly(flat).stroke({ width: 1.4, color, alpha: 0.9 });
}

/**
 * The leaf of a door that swings for the ghost or the traveling light: a closed wooden leaf inside the arch, hinged at the left jamb.
 * It is drawn at the size of the 16 unit arch texture, grown so that it is about 12 px wide on the screen, and scaled to the door.
 * Open (1) it is a thin edge at the jamb; shut (0) it fills the arch. Drawing only.
 */
function makeLeaf(door: DoorBox, color: string, grow: number): { node: Graphics; leaf: DoorLeaf } {
  const g = new Graphics();
  const frame = (): void => archPath(g);
  frame();
  g.fill(shade(TOKENS.room, -0.45));
  g.moveTo(8, 2.4).lineTo(8, 14.5).stroke({ width: 0.7, color: TOKENS.wallLine, alpha: 0.8 });
  frame();
  g.stroke({ width: 1.2, color });
  g.circle(11, 10.5, 0.9).fill(TOKENS.focus);
  let sx = (door.w / 16) * grow;
  let sy = (door.h / 16) * grow;
  let open = 0;
  g.pivot.set(3, 0);
  const apply = (): void => {
    if (g.destroyed) return;
    g.position.set(door.x + door.w / 2 + (3 - 8) * sx, door.y + door.h / 2 - 8 * sy);
    g.scale.set(sx * (1 - 0.88 * easeInOut(open)), sy);
  };
  const leaf: DoorLeaf = {
    get widthUnits() {
      return 10 * sx;
    },
    setOpen(fraction) {
      open = Math.min(1, Math.max(0, fraction));
      apply();
    },
    setGrow(next) {
      sx = (door.w / 16) * next;
      sy = (door.h / 16) * next;
      apply();
    },
  };
  leaf.setOpen(0);
  return { node: g, leaf };
}
/** Doors with arrows, sealed doorways with `?`, and the step numbers of a witness or trace route. */
export function drawDoors(ctx: DrawContext, layout: LayoutResult): void {
  // Every door in the default state shares two Graphics (bright and faded): one draw call each instead of one per door.
  const plain = new Graphics();
  const dim = new Graphics();
  ctx.layers.rooms.addChild(plain, dim);
  // The doorways and leaves of the doors that swing go on top of every door texture of their layer, and the step numbers over them.
  const swinging: { layer: Container; door: DoorBox; color: string }[] = [];
  const late: (() => void)[] = [];
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
    if (ctx.fx !== undefined && (info.state === "witness" || info.state === "selected" || info.state === "trace")) {
      // The doors of a loop, of a route and of the selected relation have a leaf that swings; the route handle drives it.
      swinging.push({ layer, door, color });
    }
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
    const step = info.step;
    if (step !== null) late.push(() => layer.addChild(pinText(ctx, "step", String(step), stepMark(step, door.x + door.w / 2, door.y + door.h / 2 - 14), STEP_FONT)));
  }
  if (ctx.fx !== undefined && swinging.length > 0) {
    // One shared Graphics for each layer that holds swinging doors (in practice, one).
    const byLayer = new Map<Container, Graphics>();
    for (const s of swinging) {
      if (byLayer.has(s.layer)) continue;
      const shared = new Graphics();
      byLayer.set(s.layer, shared);
      s.layer.addChild(shared);
    }
    ctx.fx.doorways = swinging.length;
    let shownGrow = 0;
    // The leaves and doorways follow the zoom in steps of a tenth, so that a door is about 12 px wide on the screen. The doorways are drawn again
    // only when that step changes (a camera move), never at a frame of the swing.
    const setZoom = (zoom: number): void => {
      const grow = Math.round(Math.min(LEAF_MAX_GROW, Math.max(1, LEAF_TARGET_PX / Math.max(zoom, 0.0001) / 10)) * 10) / 10;
      if (grow === shownGrow) return;
      shownGrow = grow;
      for (const g of byLayer.values()) g.clear();
      for (const s of swinging) drawDoorway(byLayer.get(s.layer) as Graphics, s.door, grow, s.color);
      for (const s of swinging) ctx.fx?.leaves.get(s.door.relationId)?.setGrow(grow);
    };
    for (const s of swinging) {
      const made = makeLeaf(s.door, s.color, 1);
      s.layer.addChild(made.node);
      ctx.fx.leaves.set(s.door.relationId, made.leaf);
    }
    ctx.fx.setDoorZoom = setZoom;
    setZoom(ctx.zoom);
  }
  for (const add of late) add();
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
