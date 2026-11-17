import { Container, Graphics, Rectangle, Text, type Renderer, type Texture } from "pixi.js";
import { SEALED_GLYPH, STATE_STYLES, TOKENS, type State } from "./styles";
import type { TextureRenderer } from "./textures";

// The texture of one element kind in one state. Each is drawn once and reused (see textures.ts).
// Labels that depend on the module (names, counts) are separate Text objects, not part of a texture.

export const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";

export const ROOM_W = 96;
export const ROOM_H = 64;
const WING_BASE = 48;
const DOOR_BASE = 16;
const BADGE_W = 72;
const BADGE_H = 20;

function stateOf(state: string): State {
  return state in STATE_STYLES ? (state as State) : "default";
}

function outlineColor(state: State, base: string): string {
  switch (state) {
    case "selected":
    case "focusHalo":
      return TOKENS.focus;
    case "witness":
      return TOKENS.corridor;
    case "trace":
      return TOKENS.light;
    default:
      return base;
  }
}

/** A dashed rectangle outline (the removed-in-the-newer-snapshot ghost). */
function dashedRect(g: Graphics, x: number, y: number, w: number, h: number, width: number, color: string): void {
  const dash = 6;
  const gap = 4;
  const edge = (x1: number, y1: number, x2: number, y2: number): void => {
    const length = Math.hypot(x2 - x1, y2 - y1);
    const dx = (x2 - x1) / length;
    const dy = (y2 - y1) / length;
    for (let t = 0; t < length; t += dash + gap) {
      const end = Math.min(t + dash, length);
      g.moveTo(x1 + dx * t, y1 + dy * t).lineTo(x1 + dx * end, y1 + dy * end);
    }
  };
  edge(x, y, x + w, y);
  edge(x + w, y, x + w, y + h);
  edge(x + w, y + h, x, y + h);
  edge(x, y + h, x, y);
  g.stroke({ width, color });
}

function body(width: number, height: number, radius: number, fill: string, state: State, baseOutline: string): Graphics {
  const style = STATE_STYLES[state];
  const g = new Graphics();
  const half = style.outlineWidth / 2;
  if (state === "comparison-removed") {
    g.roundRect(half, half, width - style.outlineWidth, height - style.outlineWidth, radius).fill({ color: fill, alpha: 0.35 });
    dashedRect(g, half, half, width - style.outlineWidth, height - style.outlineWidth, style.outlineWidth, TOKENS.ink);
    return g;
  }
  g.roundRect(half, half, width - style.outlineWidth, height - style.outlineWidth, radius)
    .fill(fill)
    .stroke({ width: style.outlineWidth, color: outlineColor(state, baseOutline) });
  return g;
}

function glyphText(glyph: string, size: number, color: string): Text {
  return new Text({ text: glyph, style: { fontFamily: FONT, fontSize: size, fill: color, fontWeight: "700" } });
}

/** The display object to render into the texture of `(kind, state)`, and its pixel frame. */
function draw(kind: string, stateName: string): { node: Container; frame: Rectangle } {
  const state = stateOf(stateName);
  const style = STATE_STYLES[state];
  const node = new Container();
  switch (kind) {
    case "room": {
      node.addChild(body(ROOM_W, ROOM_H, 8, style.fill, state, TOKENS.inkMuted));
      if (style.glyph !== null) {
        const glyph = glyphText(style.glyph, 14, TOKENS.roomInk);
        glyph.position.set(ROOM_W - glyph.width - 6, 4);
        node.addChild(glyph);
      }
      return { node, frame: new Rectangle(0, 0, ROOM_W, ROOM_H) };
    }
    case "grouped": {
      node.addChild(body(ROOM_W, ROOM_H, 8, TOKENS.wing, state, TOKENS.wingInk));
      return { node, frame: new Rectangle(0, 0, ROOM_W, ROOM_H) };
    }
    case "wing": {
      node.addChild(body(WING_BASE, WING_BASE, 12, TOKENS.wing, state, TOKENS.wingInk));
      return { node, frame: new Rectangle(0, 0, WING_BASE, WING_BASE) };
    }
    case "door": {
      const fill = state === "witness" ? TOKENS.corridor : state === "trace" ? TOKENS.light : TOKENS.door;
      node.addChild(body(DOOR_BASE, DOOR_BASE, 3, fill, state, TOKENS.ink));
      return { node, frame: new Rectangle(0, 0, DOOR_BASE, DOOR_BASE) };
    }
    case "sealed": {
      node.addChild(body(DOOR_BASE, DOOR_BASE, 8, TOKENS.panel, state, TOKENS.sealed));
      const mark = glyphText(SEALED_GLYPH, 12, TOKENS.sealed);
      mark.position.set((DOOR_BASE - mark.width) / 2, (DOOR_BASE - mark.height) / 2);
      node.addChild(mark);
      return { node, frame: new Rectangle(0, 0, DOOR_BASE, DOOR_BASE) };
    }
    default: {
      // corridor: the pill behind an import count.
      node.addChild(body(BADGE_W, BADGE_H, 10, TOKENS.panel, state, TOKENS.inkMuted));
      return { node, frame: new Rectangle(0, 0, BADGE_W, BADGE_H) };
    }
  }
}

/** The texture factory over the live renderer. */
export function createElementTextures(renderer: Renderer): TextureRenderer<Texture> {
  return {
    create(kind, state) {
      const { node, frame } = draw(kind, state);
      const texture = renderer.generateTexture({ target: node, frame, resolution: 2 });
      node.destroy({ children: true });
      return texture;
    },
  };
}