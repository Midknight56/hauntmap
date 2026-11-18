import { CanvasTextMetrics, Container, Graphics, Sprite, Text, TextStyle, type Texture } from "pixi.js";
import { restingRoomAlpha, SUBDUED_ROOM_ALPHA } from "./effects";
import { DISPLAY_FONT, FONT } from "./elements";
import type { RoomLight, SceneFx } from "./fx";
import { DIM_BRIGHTNESS } from "./loopLights";
import { fitLines, firstPlateFit, labelScale, plateCandidates, plateRect, rectsOverlap, roomNameFor, stemOfId, TARGET_LABEL_PX, wingTitleFor, type Box } from "./labels";
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
  /** The area the drawn text covers in scene units (its plate when it has one); null when it is not drawn. */
  box?(): Box | null;
  /** The plate behind a name that is drawn on one (scene units); null when the name is not on a plate. */
  plate?(): Box | null;
  /** Run after every label has been laid out: a plate that would cover one of `others` is shortened, or not drawn. */
  settle?(others: readonly Box[]): void;
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
  /** The handles that the effects of the motion pass play on; absent in tests that draw without effects. */
  fx?: SceneFx;
  /** The module ID of the selected room, or null: the other rooms rest at 60 percent while one is selected. */
  selectedRoom?: string | null;
  /** The particles of the 40 that the decor already uses (what moves in it); the dust of the loops takes what is left. */
  particlesTaken?: number;
}

/** `src/orders Ãƒâ€šÃ‚Â· 7 modules`; the same words as the wing tooltip. */
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
/** How far, in scene units, the name plate of a loop room may reach past each side of the room before it moves under the room. */
export const PLATE_OVERHANG = 12;
/** Rooms that are not in the current traversal are shown at this opacity (the design asks for 45 to 55 percent; text stays above 4.5:1). */
export const SUBDUED_ALPHA = SUBDUED_ROOM_ALPHA;

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
  // Every hall is drawn into one shared Graphics, and every closed-hall gate into another: the renderer makes one draw call for each
  // Graphics, and the software renderer of the headless browsers pays for each call (the frame rate test of design pass 4).
  const hall = new Graphics();
  const gates = new Graphics();
  ctx.layers.floor.addChild(hall);
  for (const wing of layout.wings) {
    const state = ctx.states.wings.get(wing.wing) ?? "default";
    const selected = state === "selected";
    // The hall: a floor with a faint hatch, a wall of two lines (the double wall of the design) and, when selected, a candle wall.
    hall.roundRect(wing.x + 1, wing.y + 1, wing.w - 2, wing.h - 2, 4).fill(TOKENS.wing);
    hatch(hall, wing.x + 7, wing.y + 7, wing.x + wing.w - 7, wing.y + wing.h - 7, 14);
    hall.roundRect(wing.x + 1, wing.y + 1, wing.w - 2, wing.h - 2, 4).stroke({ width: 2, color: TOKENS.wallLine });
    hall.roundRect(wing.x + 6, wing.y + 6, wing.w - 12, wing.h - 12, 2).stroke({ width: 1, color: TOKENS.wallLine, alpha: 0.85 });
    if (selected) hall.roundRect(wing.x + 1.5, wing.y + 1.5, wing.w - 3, wing.h - 3, 4).stroke({ width: STATE_STYLES.selected.outlineWidth, color: TOKENS.focus });
    ctx.fx?.decor?.wing(wing, ctx.layers);

    // The plaque on the top wall: above the rooms, in the top strip the layout keeps free, drawn over everything else.
    const plate = new Graphics();
    ctx.layers.overlay.addChild(plate);
    const title = makeText(wingLabel(wing.wing, wing.moduleCount), DISPLAY_FONT, WING_FONT, TOKENS.plateInk, "400");
    title.anchor.set(0, 0.5);
    ctx.layers.overlay.addChild(title);
    let titleBox: Box = { x: wing.x, y: wing.y, w: 0, h: 0 };
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
        titleBox = { x: wing.x + 12, y: wing.y + PLATE_BOTTOM - plateH, w: textW + 20, h: plateH };
      },
      box: () => (title.visible ? titleBox : null),
      plate: () => (title.visible ? titleBox : null),
    });

    if (!wing.expanded) {
      // A closed hall: a small arched door under the plaque and the number of rooms behind it.
      const cx = wing.x + wing.w / 2;
      const base = wing.y + wing.h - 14;
      gates.moveTo(cx - 12, base).lineTo(cx - 12, base - 20).arc(cx, base - 20, 12, Math.PI, 0).lineTo(cx + 12, base);
      gates.stroke({ width: 2, color: TOKENS.wallLine });
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
  ctx.layers.floor.addChild(gates);
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

/**
 * The candle light of a room on a loop. The room starts each lap dim (a veil of the floor color over it, so that it shows at 45 percent)
 * and, when the ghost reaches its door, a warm glow comes around it and a pool of candle light on its floor, and the veil goes. The veil
 * is under the name, and the pool lies under the line of the name, so that the name keeps its contrast. Drawing only.
 */
function addLoopLight(ctx: DrawContext, room: { w: number; h: number; id: string }, node: Container): void {
  const fx = ctx.fx as SceneFx;
  // One drawing for the whole light of the room, made again when the glow changes (a few times in the 200 ms of a lighting, never at rest).
  const g = new Graphics();
  node.addChild(g);
  let shown = -1;
  const light: RoomLight = {
    setGlow(fraction) {
      if (g.destroyed) return;
      const f = Math.round(Math.min(1, Math.max(0, fraction)) * 20) / 20;
      if (f === shown) return;
      shown = f;
      g.clear();
      // The veil: the floor color over the room, so that it shows at 45 percent until the ghost has come.
      if (f < 1) g.roundRect(0, 0, room.w, room.h, 3).fill({ color: TOKENS.floor, alpha: (1 - DIM_BRIGHTNESS) * (1 - f) });
      if (f <= 0) return;
      // The pool of candle light on the floor of the room, under the line of the name.
      g.ellipse(room.w / 2, room.h * 0.82, room.w * 0.42, room.h * 0.15).fill({ color: TOKENS.light, alpha: 0.2 * f });
      g.ellipse(room.w / 2, room.h * 0.82, room.w * 0.26, room.h * 0.09).fill({ color: TOKENS.light, alpha: 0.24 * f });
      // The warm candle halo: five wider and fainter outlines around the walls, no blur.
      for (const [grow, alpha] of [
        [16, 0.1],
        [11, 0.16],
        [7, 0.24],
        [4, 0.4],
        [2, 0.6],
      ] as const) {
        g.roundRect(-grow, -grow, room.w + grow * 2, room.h + grow * 2, 3 + grow).stroke({ width: grow * 1.4, color: TOKENS.light, alpha: alpha * f });
      }
    },
  };
  light.setGlow(ctx.reduced ? 1 : 0);
  fx.loopRooms.set(room.id, light);
}

/** Draw every room (body and name; a subdued room is shown by its opacity and its dotted rail, not by words). Returns the nodes by module ID for culling. */
export function drawRooms(ctx: DrawContext, layout: LayoutResult): Map<string, Container> {
  const nodes = new Map<string, Container>();
  for (const room of layout.rooms) {
    const state = ctx.states.rooms.get(room.id) ?? "default";
    const node = new Container();
    node.position.set(room.x, room.y);
    const glow = glowOf(state);
    if (glow !== null) {
      const lit = glowAround({ x: 0, y: 0, w: room.w, h: room.h }, glow.color, glow.strength, 3);
      node.addChild(lit);
      ctx.fx?.glows.set(room.id, lit);
    }
    node.addChild(new Sprite(ctx.textures.get("room", state)));
    ctx.fx?.decor?.room(room, state);
    if (state === "witness" && ctx.fx !== undefined) addLoopLight(ctx, room, node);
    const subdued = state === "subdued";
    node.alpha = restingRoomAlpha({ roomSelected: (ctx.selectedRoom ?? null) !== null, isSelected: ctx.selectedRoom === room.id, subdued });
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
    // A room on the loop, on a route or selected always shows its full file name (design pass 2, items 1 and 7). When the name is
    // wider than the room, it is drawn on a small plate over the top of the room (a little wider than the room), or, when it is far
    // wider (a phone view of the whole loop), on a plate under the room. Any other room shows the full name, the name without its
    // extension, a cut of 4 letters or more, or nothing (item 2).
    const plated = state === "witness" || state === "trace" || state === "selected" || state === "focusHalo";
    const plate = new Graphics();
    plate.visible = false;
    // The name of such a room is drawn above the corridors, the doors and the ghost, so that its plate is never crossed by a line.
    const holder = plated ? new Container() : null;
    if (holder !== null) {
      holder.position.set(room.x, room.y);
      node.removeChild(name);
      holder.addChild(plate, name);
      ctx.layers.overlay.addChild(holder);
    } else node.addChildAt(plate, node.getChildIndex(name));
    const roomBox: Box = { x: room.x, y: room.y, w: room.w, h: room.h };
    const measureName = (t: string): number => measureWidth(t, FONT, ROOM_FONT, "500");
    // Where the name or its plate lies now (scene units), for the labels that must not cover it and for the plate check.
    let covered: Box | null = null;
    let onPlate: Box | null = null;
    let scaleNow = 1;
    let zoomNow = ctx.zoom;
    /** Draw the name on its plate: over the top of the room, or under it when the plate is far wider than the room. */
    const showOnPlate = (words: string): void => {
      if (name.text !== words) name.text = words;
      name.visible = true;
      name.anchor.set(0.5, 0);
      const pad = 3 / zoomNow;
      const rect = plateRect(roomBox, zoomNow, scaleNow, measureName(words) * scaleNow);
      name.position.set(room.w / 2, rect.y + pad - room.y);
      plate.clear();
      plate.roundRect(rect.x - room.x, rect.y - room.y, rect.w, rect.h, 3 / zoomNow).fill(TOKENS.plate).stroke({ width: 1 / zoomNow, color: TOKENS.wallLine });
      plate.visible = true;
      onPlate = rect;
      covered = rect;
    };
    ctx.labels.push({
      kind: "room",
      id: room.id,
      node: name,
      fontUnits: ROOM_FONT,
      visible: () => node.visible && name.visible,
      active: () => node.visible,
      box: () => (node.visible ? covered : null),
      plate: () => (node.visible && name.visible ? onPlate : null),
      layout(zoom) {
        if (holder !== null) holder.visible = node.visible;
        const s = labelScale(zoom, ROOM_FONT);
        zoomNow = zoom;
        scaleNow = s;
        name.scale.set(s);
        plate.clear();
        plate.visible = false;
        onPlate = null;
        covered = null;
        const inside = (room.w - 10) / s;
        const words = plated ? (measureName(room.label) <= inside ? room.label : null) : roomNameFor([room.label, stem], inside, measureName);
        if (words !== null) {
          name.visible = true;
          name.anchor.set(0, 0);
          name.position.set(5, 8);
          if (name.text !== words) name.text = words;
          covered = { x: room.x + 5, y: room.y + 8, w: measureName(words) * s, h: ROOM_FONT * LINE * s };
          return;
        }
        if (!plated) {
          name.visible = false;
          return;
        }
        showOnPlate(room.label);
      },
      settle(others) {
        if (onPlate === null) return;
        // A plate never covers another drawn name: shorten it by the label rule, or do not draw it.
        const fits = (words: string): boolean => {
          const rect = plateRect(roomBox, zoomNow, scaleNow, measureName(words) * scaleNow);
          return !others.some((o) => rectsOverlap(rect, o));
        };
        const chosen = firstPlateFit(plateCandidates(room.label, stem), fits);
        if (chosen === null) {
          name.visible = false;
          plate.visible = false;
          plate.clear();
          onPlate = null;
          covered = null;
        } else if (chosen !== name.text) showOnPlate(chosen);
      },    });    ctx.layers.rooms.addChild(node);
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

/** After every label is laid out, let each plate that would cover another drawn name shorten itself or go (design pass 3, 12b). */
export function settleLabels(labels: readonly SceneLabel[]): void {
  for (const label of labels) {
    if (label.settle === undefined) continue;
    const others: Box[] = [];
    for (const other of labels) {
      if (other === label) continue;
      const box = other.box?.();
      if (box !== null && box !== undefined) others.push(box);
    }
    label.settle(others);
  }
}

export function haloRect(layout: LayoutResult, id: string): Rect | null {
  const room = layout.rooms.find((r) => r.id === id);
  return room === undefined ? null : { x: room.x, y: room.y, w: room.w, h: room.h };
}
