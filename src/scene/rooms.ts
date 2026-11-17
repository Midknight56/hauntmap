import { Container, NineSliceSprite, Sprite, Text, type Texture } from "pixi.js";
import { FONT } from "./elements";
import type { LayerName } from "./layers";
import type { LayoutResult, Rect } from "./layout/types";
import type { SceneStates } from "./stateMap";
import { STATE_STYLES, TOKENS } from "./styles";
import type { TextureCache } from "./textures";

export interface DrawContext {
  layers: Record<LayerName, Container>;
  textures: TextureCache<Texture>;
  states: SceneStates;
  reduced: boolean;
}

/** `src/orders · 7 modules`; the same words as the wing tooltip. */
export function wingLabel(wing: string, moduleCount: number): string {
  return `${wing} \u00B7 ${moduleCount} ${moduleCount === 1 ? "module" : "modules"}`;
}

function label(text: string, size: number, color: string, wrapWidth: number): Text {
  return new Text({ text, style: { fontFamily: FONT, fontSize: size, fill: color, wordWrap: true, wordWrapWidth: wrapWidth, breakWords: true } });
}

export function drawWings(ctx: DrawContext, layout: LayoutResult): void {
  for (const wing of layout.wings) {
    const state = ctx.states.wings.get(wing.wing) ?? "default";
    const sprite = new NineSliceSprite({ texture: ctx.textures.get("wing", state), leftWidth: 14, topHeight: 14, rightWidth: 14, bottomHeight: 14 });
    sprite.position.set(wing.x, wing.y);
    sprite.width = wing.w;
    sprite.height = wing.h;
    ctx.layers.floor.addChild(sprite);
    const text = label(wingLabel(wing.wing, wing.moduleCount), 11, TOKENS.wingInk, Math.max(40, wing.w - 20));
    text.position.set(wing.x + 10, wing.y + 8);
    ctx.layers.floor.addChild(text);
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
    const name = label(room.label, 11, subdued ? TOKENS.roomSubduedInk : TOKENS.roomInk, room.w - 12);
    name.position.set(6, 12);
    node.addChild(name);
    const words = STATE_STYLES[state].label;
    if (subdued && words !== null) {
      const note = label(words, 8, TOKENS.roomSubduedInk, room.w - 12);
      note.position.set(6, room.h - 16);
      node.addChild(note);
    }
    ctx.layers.rooms.addChild(node);
    nodes.set(room.id, node);
  }
  for (const group of layout.grouped) {
    const node = new Container();
    node.position.set(group.x, group.y);
    node.addChild(new Sprite(ctx.textures.get("grouped", "default")));
    const text = label(group.label, 11, TOKENS.wingInk, group.w - 12);
    text.position.set(6, 12);
    node.addChild(text);
    ctx.layers.rooms.addChild(node);
  }
  return nodes;
}

export function haloRect(layout: LayoutResult, id: string): Rect | null {
  const room = layout.rooms.find((r) => r.id === id);
  return room === undefined ? null : { x: room.x, y: room.y, w: room.w, h: room.h };
}