import { CanvasTextMetrics, Container, Graphics, NineSliceSprite, Sprite, Text, TextStyle, type Texture } from "pixi.js";
import { DISPLAY_FONT, FONT } from "./elements";
import { fitLines, labelScale, stemOfId, wingTitleFor } from "./labels";
import type { LayerName } from "./layers";
import type { LayoutResult, Rect } from "./layout/types";
import type { SceneStates } from "./stateMap";
import { STATE_STYLES, TOKENS } from "./styles";
import type { TextureCache } from "./textures";

/** One drawn name or title. Its words and its scale follow the zoom, so that it never drops under 11 CSS pixels. */
export interface SceneLabel {
  kind: "wing" | "wing-note" | "room" | "note";
  id: string;
  node: Text;
  /** The font size of the text object before scaling, in scene units. */
  fontUnits: number;
  /** Choose the words and the scale for a camera zoom. */
  layout(zoom: number): void;
  /** False for a room that is outside the view (culled). */
  visible(): boolean;
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
const ROOM_FONT = 11;
const WING_FONT = 12;
const NOTE_FONT = 8;
/** The note `Not in this traversal` is drawn at about 7 CSS pixels at the first view; it is a companion of the subdued room, not a name. */
const NOTE_PX = 7;
/** The plate is 30 units high; a title may grow to 34 units so it still sits between the top edge and the first row. */
const WING_FONT_CAP = 34;
const PLATE_TOP = 6;
const PLATE_H = 30;

function makeText(text: string, family: string, size: number, color: string, weight: string): Text {
  return new Text({ text, resolution: 2, style: { fontFamily: family, fontSize: size, fill: color, fontWeight: weight as "400" } });
}

export function drawWings(ctx: DrawContext, layout: LayoutResult): void {
  for (const wing of layout.wings) {
    const state = ctx.states.wings.get(wing.wing) ?? "default";
    const sprite = new NineSliceSprite({ texture: ctx.textures.get("wing", state), leftWidth: 14, topHeight: 14, rightWidth: 14, bottomHeight: 14 });
    sprite.position.set(wing.x, wing.y);
    sprite.width = wing.w;
    sprite.height = wing.h;
    ctx.layers.floor.addChild(sprite);

    // The title plate: above the rooms, in the top strip the layout keeps free, and drawn over everything else.
    const plate = new Graphics();
    const plateW = wing.w - 12;
    plate.roundRect(wing.x + 6, wing.y + PLATE_TOP, plateW, PLATE_H, 5).fill(TOKENS.plate).stroke({ width: 1.5, color: TOKENS.wall });
    for (const x of [wing.x + 11, wing.x + 6 + plateW - 5]) plate.circle(x, wing.y + PLATE_TOP + PLATE_H / 2, 1.6).fill(TOKENS.wall);
    ctx.layers.overlay.addChild(plate);
    const title = makeText(wingLabel(wing.wing, wing.moduleCount), DISPLAY_FONT, WING_FONT, TOKENS.plateInk, "700");
    title.anchor.set(0.5);
    title.position.set(wing.x + wing.w / 2, wing.y + PLATE_TOP + PLATE_H / 2);
    ctx.layers.overlay.addChild(title);
    ctx.labels.push({
      kind: "wing",
      id: wing.wing,
      node: title,
      fontUnits: WING_FONT,
      visible: () => true,
      layout(zoom) {
        const s = Math.min(labelScale(zoom, WING_FONT), WING_FONT_CAP / WING_FONT);
        const words = wingTitleFor(wing.wing, wing.moduleCount, (plateW - 12) / s, (t) => measureWidth(t, DISPLAY_FONT, WING_FONT, "700"));
        if (title.text !== words) title.text = words;
        title.scale.set(s);
      },
    });

    if (!wing.expanded) {
      // A closed hall: a gate under the plate and the number of rooms behind it.
      const gate = new Graphics();
      const cx = wing.x + wing.w / 2;
      const base = wing.y + wing.h - 18;
      gate.moveTo(cx - 14, base).lineTo(cx - 14, base - 22).arc(cx, base - 22, 14, Math.PI, 0).lineTo(cx + 14, base).closePath();
      gate.fill({ color: TOKENS.floor, alpha: 0.85 }).stroke({ width: 2, color: TOKENS.wall });
      ctx.layers.floor.addChild(gate);
      const note = makeText(`${wing.moduleCount} ${wing.moduleCount === 1 ? "module" : "modules"}`, FONT, ROOM_FONT, TOKENS.wingInk, "400");
      note.anchor.set(0.5);
      note.position.set(cx, wing.y + PLATE_TOP + PLATE_H + 14);
      ctx.layers.overlay.addChild(note);
      ctx.labels.push({
        kind: "wing-note",
        id: wing.wing,
        node: note,
        fontUnits: ROOM_FONT,
        visible: () => true,
        layout(zoom) {
          const s = labelScale(zoom, ROOM_FONT);
          const full = `${wing.moduleCount} ${wing.moduleCount === 1 ? "module" : "modules"}`;
          const words = fitLines([full, String(wing.moduleCount)], (wing.w - 16) / s, (t) => measureWidth(t, FONT, ROOM_FONT, "400"), 1)[0] as string;
          if (note.text !== words) note.text = words;
          note.scale.set(s);
        },
      });
    }
  }
}

/** Draw every room (body, name and, when subdued, the words `Not in this traversal`). Returns the nodes by module ID for culling. */
export function drawRooms(ctx: DrawContext, layout: LayoutResult): Map<string, Container> {
  const nodes = new Map<string, Container>();
  for (const room of layout.rooms) {
    const state = ctx.states.rooms.get(room.id) ?? "default";
    const node = new Container();
    node.position.set(room.x, room.y);
    node.addChild(new Sprite(ctx.textures.get("room", state)));
    const subdued = state === "subdued";
    const ink = subdued ? TOKENS.roomSubduedInk : TOKENS.roomInk;
    const name = makeText(room.label, FONT, ROOM_FONT, ink, "400");
    name.position.set(6, 7);
    node.addChild(name);
    const stem = stemOfId(room.id);
    // Where the name ends, so that the note under it never overlaps it.
    let nameBottom = 7 + ROOM_FONT * LINE;
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
        const words = fitLines([room.label, stem], (room.w - 12) / s, (t) => measureWidth(t, FONT, ROOM_FONT, "400"), maxLines).join("\n");
        if (name.text !== words) name.text = words;
        name.scale.set(s);
        nameBottom = 7 + words.split("\n").length * lineH;
      },
    });
    const words = STATE_STYLES[state].label;
    if (subdued && words !== null) {
      const note = makeText(words, FONT, NOTE_FONT, TOKENS.roomSubduedInk, "400");
      note.anchor.set(0, 1);
      note.position.set(6, room.h - 4);
      node.addChild(note);
      ctx.labels.push({
        kind: "note",
        id: room.id,
        node: note,
        fontUnits: NOTE_FONT,
        visible: () => node.visible,
        layout(zoom) {
          const wanted = Math.max(1, NOTE_PX / (NOTE_FONT * Math.max(zoom, 0.0001)));
          const lines = fitLines([words], (room.w - 12) / wanted, (t) => measureWidth(t, FONT, NOTE_FONT, "400"), 2);
          // The note takes the space the name leaves; it shrinks before it would touch the name.
          const room_left = room.h - 4 - nameBottom - 2;
          const s = Math.max(0.8, Math.min(wanted, room_left / (lines.length * NOTE_FONT * LINE)));
          const text = lines.join("\n");
          if (note.text !== text) note.text = text;
          note.scale.set(s);
        },
      });
    }    ctx.layers.rooms.addChild(node);
    nodes.set(room.id, node);
  }
  for (const group of layout.grouped) {
    const node = new Container();
    node.position.set(group.x, group.y);
    node.addChild(new Sprite(ctx.textures.get("grouped", "default")));
    const text = makeText(group.label, FONT, ROOM_FONT, TOKENS.wingInk, "400");
    text.position.set(6, 7);
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
        const words = fitLines([group.label, `+${count} more`, `+${count}`], (group.w - 12) / s, (t) => measureWidth(t, FONT, ROOM_FONT, "400"), 2).join("\n");
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
