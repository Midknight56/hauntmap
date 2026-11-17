import { CanvasTextMetrics, Container, Graphics, Sprite, Text, TextStyle, type Texture } from "pixi.js";
import { DISPLAY_FONT, FONT } from "./elements";
import { fitLines, labelScale, stemOfId, TARGET_LABEL_PX, wingTitleFor } from "./labels";
import type { LayerName } from "./layers";
import type { LayoutResult, Rect } from "./layout/types";
import type { SceneStates } from "./stateMap";
import { STATE_STYLES, TOKENS, type State } from "./styles";
import type { TextureCache } from "./textures";

/** One drawn name or title. Its words and its scale follow the zoom, so that it never drops under 12 CSS pixels. */
export interface SceneLabel {
  kind: "wing" | "wing-note" | "room" | "note" | "step" | "glyph" | "count";
  id: string;
  node: Text;
  /** The font size of the text object before scaling, in scene units. */
  fontUnits: number;
  /** Choose the words and the scale for a camera zoom. */
  layout(zoom: number): void;
  /** False for a text that is not drawn: its room is outside the view (culled), or it waits for a closer view. */
  visible(): boolean;
  /** True while `layout` must run for a zoom, even when the text is hidden at the zoom now shown. Defaults to `visible`. */
  active?(): boolean;
}

/**
 * Register a text that sits in the world (a step number, a `+`, a `?`, an import count) so that it is never under 12
 * CSS pixels on screen: it grows with the zoom out, and a `hide` text is not drawn until the zoom lets it be 12.5 px
 * at its own size. A `companion` (the pill behind an import count) is shown and hidden with it. Returns the node so the
 * caller adds it to a layer.
 */
export function pinText(
  ctx: { labels: SceneLabel[]; zoom: number },
  kind: SceneLabel["kind"],
  id: string,
  node: Text,
  fontUnits: number,
  mode: "grow" | "hide" = "grow",
  companion?: { visible: boolean; destroyed: boolean },
): Text {
  const label: SceneLabel = {
    kind,
    id,
    node,
    fontUnits,
    visible: () => !node.destroyed && node.visible,
    active: () => !node.destroyed,
    layout(zoom) {
      if (node.destroyed) return;
      if (mode === "hide") {
        node.visible = zoom * fontUnits >= TARGET_LABEL_PX;
        if (companion !== undefined && !companion.destroyed) companion.visible = node.visible;
        node.scale.set(1);
      } else node.scale.set(labelScale(zoom, fontUnits));
    },
  };
  ctx.labels.push(label);
  label.layout(ctx.zoom);
  return node;
}

export interface DrawContext {
  layers: Record<LayerName, Container>;
  textures: TextureCache<Texture>;
  states: SceneStates;
  reduced: boolean;
  /** The labels drawn by this pass, for `relayoutLabels`. */
  labels: SceneLabel[];
  /** The camera zoom when the pass runs. */
  zoom: number;
  /** True in a narrow window (the phone layout): the ghost is drawn at 0.72 of its size. */
  compact?: boolean;
  /**
   * The relation IDs that stay bright while a selection, a route or a comparison is shown; every other passage
   * fades. Null when nothing is selected, so nothing fades.
   */
  related: ReadonlySet<string> | null;
}

/** `src/orders · 7 modules`; the same words as the wing tooltip. */
export function wingLabel(wing: string, moduleCount: number): string {
  return `${wing} \u00B7 ${moduleCount} ${moduleCount === 1 ? "module" : "modules"}`;
}

const metricStyles = new Map<string, TextStyle>();
const widths = new Map<string, number>();

/** The width of a string at the base size of a font, in scene units; cached because layout asks again at every zoom. */
export function measureWidth(text: string, family: string, size: number, weight: string): number {
  const key = `${family}|${size}|${weight}|${text}`;
  const known = widths.get(key);
  if (known !== undefined) return known;
  const styleKey = `${family}|${size}|${weight}`;
  let style = metricStyles.get(styleKey);
  if (style === undefined) {
    style = new TextStyle({ fontFamily: family, fontSize: size, fontWeight: weight as "400" });
    metricStyles.set(styleKey, style);
  }
  const width = CanvasTextMetrics.measureText(text, style).width;
  widths.set(key, width);
  return width;
}

/** Forget the cached widths (after a font arrives or the palette changes the weights). */
export function clearMeasureCache(): void {
  widths.clear();
}

/** Height of a line of text as a multiple of its font size. */
const LINE = 1.25;
/** Room names are mono 500 (13 px in the design, whose rooms are wider than the 96 unit rooms of the layout); 12 units let `checkout.ts` fit a room, and the scene scales names up, never down, to keep 12.5 px on screen. */
const ROOM_FONT = 12;
/** Plaques on the top wall of a wing: Almendra SC, 17 px in the design. */
const WING_FONT = 17;
const NOTE_FONT = 12;
/** A plaque may grow to this many units of text height (it is 12.5 px on screen down to a zoom of about 0.31), so that it still fits the strip the layout keeps free above the rooms. */
const WING_FONT_CAP = 40;
/** The plaque sits on the top wall: its bottom edge is this far under the top of the wing, so that it stays in the strip above the rooms (40 units) however large it grows. */
const PLATE_BOTTOM = 38;
/** Rooms that are not in the current traversal are shown at this opacity (the design asks for 45 to 55 percent; text stays above 4.5:1). */
export const SUBDUED_ALPHA = 0.55;

function makeText(text: string, family: string, size: number, color: string, weight: string): Text {
  return new Text({ text, resolution: 2, style: { fontFamily: family, fontSize: size, fill: color, fontWeight: weight as "400" } });
}

/** Faint 45 degree hatch lines inside a rectangle: the lines x + y = c, clipped to it. */
function hatch(g: Graphics, x0: number, y0: number, x1: number, y1: number, step: number): void {
  for (let c = x0 + y0 + step; c < x1 + y1; c += step) {
    const lo = Math.max(x0, c - y1);
    const hi = Math.min(x1, c - y0);
    if (hi - lo < 1) continue;
    g.moveTo(lo, c - lo).lineTo(hi, c - hi);
  }
  g.stroke({ width: 1, color: TOKENS.wallLine, alpha: 0.4 });
}

/** A soft glow around a rectangle: three wider and fainter outlines (no blur filter). */
export function glowAround(rect: Rect, color: string, strength = 1, radius = 4): Graphics {
  const g = new Graphics();
  for (const [grow, alpha] of [
    [9, 0.07],
    [5, 0.12],
    [2, 0.2],
  ] as const) {
    g.roundRect(rect.x - grow, rect.y - grow, rect.w + grow * 2, rect.h + grow * 2, radius + grow).stroke({ width: grow * 1.4, color, alpha: alpha * strength });
  }
  return g;
}

export function drawWings(ctx: DrawContext, layout: LayoutResult): void {
  for (const wing of layout.wings) {
    const state = ctx.states.wings.get(wing.wing) ?? "default";
    const selected = state === "selected";
    // The hall: a floor with a faint hatch, a wall of two lines (the double wall of the design) and, when selected, a candle wall.
    const hall = new Graphics();
    hall.roundRect(wing.x + 1, wing.y + 1, wing.w - 2, wing.h - 2, 4).fill(TOKENS.wing);
    hatch(hall, wing.x + 7, wing.y + 7, wing.x + wing.w - 7, wing.y + wing.h - 7, 14);
    hall.roundRect(wing.x + 1, wing.y + 1, wing.w - 2, wing.h - 2, 4).stroke({ width: 2, color: TOKENS.wallLine });
    hall.roundRect(wing.x + 6, wing.y + 6, wing.w - 12, wing.h - 12, 2).stroke({ width: 1, color: TOKENS.wallLine, alpha: 0.85 });
    if (selected) hall.roundRect(wing.x + 1.5, wing.y + 1.5, wing.w - 3, wing.h - 3, 4).stroke({ width: STATE_STYLES.selected.outlineWidth, color: TOKENS.focus });
    ctx.layers.floor.addChild(hall);

    // The plaque on the top wall: above the rooms, in the top strip the layout keeps free, drawn over everything else.
    const plate = new Graphics();
    ctx.layers.overlay.addChild(plate);
    const title = makeText(wingLabel(wing.wing, wing.moduleCount), DISPLAY_FONT, WING_FONT, TOKENS.plateInk, "400");
    title.anchor.set(0, 0.5);
    ctx.layers.overlay.addChild(title);
    ctx.labels.push({
      kind: "wing",
      id: wing.wing,
      node: title,
      fontUnits: WING_FONT,
      visible: () => title.visible,
      active: () => true,
      layout(zoom) {
        const s = Math.min(labelScale(zoom, WING_FONT), WING_FONT_CAP / WING_FONT);
        const shown = WING_FONT * s * zoom >= TARGET_LABEL_PX - 0.5;
        title.visible = shown;
        plate.visible = shown;
        const room = wing.w - 24 - 20;
        const words = wingTitleFor(wing.wing, wing.moduleCount, room / s, (t) => measureWidth(t, DISPLAY_FONT, WING_FONT, "400"));
        if (title.text !== words) title.text = words;
        title.scale.set(s);
        const textW = measureWidth(words, DISPLAY_FONT, WING_FONT, "400") * s;
        const plateH = WING_FONT * s * LINE + 8;
        plate.clear();
        plate.roundRect(wing.x + 12, wing.y + PLATE_BOTTOM - plateH, textW + 20, plateH, 3).fill(TOKENS.plate).stroke({ width: 1, color: TOKENS.wallLine });
        title.position.set(wing.x + 22, wing.y + PLATE_BOTTOM - plateH / 2);
      },
    });

    if (!wing.expanded) {
      // A closed hall: a small arched door under the plaque and the number of rooms behind it.
      const gate = new Graphics();
      const cx = wing.x + wing.w / 2;
      const base = wing.y + wing.h - 14;
      gate.moveTo(cx - 12, base).lineTo(cx - 12, base - 20).arc(cx, base - 20, 12, Math.PI, 0).lineTo(cx + 12, base);
      gate.stroke({ width: 2, color: TOKENS.wallLine });
      ctx.layers.floor.addChild(gate);
      const noteWords = `${wing.moduleCount} ${wing.moduleCount === 1 ? "module" : "modules"}`;
      const note = makeText(noteWords, FONT, NOTE_FONT, TOKENS.inkMuted, "500");
      note.anchor.set(0.5);
      note.position.set(cx, wing.y + wing.h / 2 - 8);
      ctx.layers.overlay.addChild(note);
      ctx.labels.push({
        kind: "wing-note",
        id: wing.wing,
        node: note,
        fontUnits: NOTE_FONT,
        visible: () => true,
        layout(zoom) {
          const s = labelScale(zoom, NOTE_FONT);
          const words = fitLines([noteWords, String(wing.moduleCount)], (wing.w - 16) / s, (t) => measureWidth(t, FONT, NOTE_FONT, "500"), 1)[0] as string;
          if (note.text !== words) note.text = words;
          note.scale.set(s);
        },
      });
    }
  }
}

/** The states that light a room: a glow of this colour and strength is drawn around it. */
function glowOf(state: State): { color: string; strength: number } | null {
  switch (state) {
    case "selected":
    case "focusHalo":
      return { color: TOKENS.focus, strength: 1.6 };
    case "witness":
      return { color: TOKENS.corridor, strength: 1 };
    case "trace":
      return { color: TOKENS.light, strength: 1 };
    case "comparison-added":
      return { color: TOKENS.added, strength: 1.2 };
    default:
      return null;
  }
}

/** Draw every room (body, name and, when subdued, the words `Not in this traversal`). Returns the nodes by module ID for culling. */
export function drawRooms(ctx: DrawContext, layout: LayoutResult): Map<string, Container> {
  const nodes = new Map<string, Container>();
  for (const room of layout.rooms) {
    const state = ctx.states.rooms.get(room.id) ?? "default";
    const node = new Container();
    node.position.set(room.x, room.y);
    const glow = glowOf(state);
    if (glow !== null) node.addChild(glowAround({ x: 0, y: 0, w: room.w, h: room.h }, glow.color, glow.strength, 3));
    node.addChild(new Sprite(ctx.textures.get("room", state)));
    const subdued = state === "subdued";
    if (subdued) node.alpha = SUBDUED_ALPHA;
    const ink = subdued ? TOKENS.roomSubduedInk : TOKENS.roomInk;
    const name = makeText(room.label, FONT, ROOM_FONT, ink, "500");
    name.position.set(5, 8);
    node.addChild(name);
    const glyph = STATE_STYLES[state].glyph;
    if (glyph !== null) {
      const mark = new Text({ text: glyph, style: { fontFamily: FONT, fontSize: 14, fill: TOKENS.added, fontWeight: "700" } });
      mark.anchor.set(0.5);
      mark.position.set(room.w - 12, 11);
      node.addChild(pinText(ctx, "glyph", room.id, mark, 14));
    }
    const stem = stemOfId(room.id);
    // Where the name ends, so that the note under it never overlaps it.
    let nameBottom = 8 + ROOM_FONT * LINE;
    ctx.labels.push({
      kind: "room",
      id: room.id,
      node: name,
      fontUnits: ROOM_FONT,
      visible: () => node.visible,
      layout(zoom) {
        const s = labelScale(zoom, ROOM_FONT);
        const lineH = ROOM_FONT * LINE * s;
        const maxLines = subdued ? 1 : Math.max(1, Math.min(2, Math.floor((room.h - 14) / lineH)));
        const words = fitLines([room.label, stem], (room.w - 10) / s, (t) => measureWidth(t, FONT, ROOM_FONT, "500"), maxLines).join("\n");
        if (name.text !== words) name.text = words;
        name.scale.set(s);
        nameBottom = 8 + words.split("\n").length * lineH;
      },
    });
    const words = STATE_STYLES[state].label;
    if (subdued && words !== null) {
      const note = makeText(words, FONT, NOTE_FONT, TOKENS.roomSubduedInk, "500");
      note.anchor.set(0, 1);
      note.position.set(5, room.h - 4);
      node.addChild(note);
      ctx.labels.push({
        kind: "note",
        id: room.id,
        node: note,
        fontUnits: NOTE_FONT,
        // The note is a text like any other: 12 CSS pixels or more on screen, or not drawn at that zoom.
        visible: () => node.visible && note.visible,
        active: () => node.visible,
        layout(zoom) {
          const wanted = labelScale(zoom, NOTE_FONT);
          const lines = fitLines([words], (room.w - 10) / wanted, (t) => measureWidth(t, FONT, NOTE_FONT, "500"), 2);
          const text = lines.join("\n");
          const needed = lines.length * NOTE_FONT * LINE * wanted;
          const roomLeft = room.h - 4 - nameBottom - 2;
          // The words fit only when they are whole (no ellipsis) and leave the name its space; otherwise they wait for a closer view.
          note.visible = !text.includes("\u2026") && needed <= roomLeft;
          if (note.text !== text) note.text = text;
          note.scale.set(wanted);
        },
      });
    }
    ctx.layers.rooms.addChild(node);
    nodes.set(room.id, node);
  }
  for (const group of layout.grouped) {
    const node = new Container();
    node.position.set(group.x, group.y);
    node.addChild(new Sprite(ctx.textures.get("grouped", "default")));
    const text = makeText(group.label, FONT, ROOM_FONT, TOKENS.wingInk, "500");
    text.position.set(5, 8);
    node.addChild(text);
    ctx.labels.push({
      kind: "room",
      id: `${group.wing}#grouped`,
      node: text,
      fontUnits: ROOM_FONT,
      visible: () => node.visible,
      layout(zoom) {
        const s = labelScale(zoom, ROOM_FONT);
        const count = group.hiddenCount;
        const words = fitLines([group.label, `+${count} more`, `+${count}`], (group.w - 10) / s, (t) => measureWidth(t, FONT, ROOM_FONT, "500"), 2).join("\n");
        if (text.text !== words) text.text = words;
        text.scale.set(s);
      },
    });
    ctx.layers.rooms.addChild(node);
  }
  return nodes;
}

export function haloRect(layout: LayoutResult, id: string): Rect | null {
  const room = layout.rooms.find((r) => r.id === id);
  return room === undefined ? null : { x: room.x, y: room.y, w: room.w, h: room.h };
}
