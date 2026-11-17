import { Container, Graphics, Rectangle, Text, type Renderer, type Texture } from "pixi.js";
import { SEALED_GLYPH, STATE_STYLES, TOKENS, type State } from "./styles";
import type { TextureRenderer } from "./textures";

// The texture of one element kind in one state. Each is drawn once and reused (see textures.ts), and drawn in
// code: stone floors, walls and lit arches come from rectangles, lines and a fixed pattern, never from an image.
// Labels that depend on the module (names, counts) are separate Text objects, not part of a texture.

export const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";
/** The display face of the wing title plates (Cinzel, SIL Open Font License, committed in src/styles/fonts). */
export const DISPLAY_FONT = "'Cinzel', 'Palatino Linotype', Georgia, serif";

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

/** Mix a `#rrggbb` color toward white (amount > 0) or black (amount < 0). */
export function shade(hex: string, amount: number): string {
  const target = amount >= 0 ? 255 : 0;
  const k = Math.min(1, Math.abs(amount));
  const channel = (offset: number): string => {
    const v = parseInt(hex.slice(offset, offset + 2), 16);
    return Math.round(v + (target - v) * k)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

/** A fixed pseudo-random number in [0, 1) for a stone, so that every texture draws the same floor. */
function noise(row: number, col: number): number {
  const n = Math.sin(row * 127.1 + col * 311.7) * 43758.5453;
  return n - Math.floor(n);
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

/** Flagstones in running bond across a rectangle: rows 16 units high, stones 24 wide, every other row shifted by half a stone. */
function flagstones(g: Graphics, x: number, y: number, w: number, h: number, base: string, spread: number): void {
  const rowH = 16;
  const stoneW = 24;
  const rows = Math.ceil(h / rowH);
  for (let row = 0; row < rows; row++) {
    const top = y + row * rowH;
    const height = Math.min(rowH, y + h - top);
    const shift = row % 2 === 0 ? 0 : -stoneW / 2;
    for (let col = 0; col * stoneW + shift < w; col++) {
      const left = Math.max(x, x + col * stoneW + shift);
      const right = Math.min(x + w, x + (col + 1) * stoneW + shift);
      if (right - left < 1) continue;
      g.rect(left, top, right - left, height).fill(shade(base, (noise(row, col) - 0.5) * spread));
    }
  }
  // Joints between the stones.
  for (let row = 1; row < rows; row++) g.moveTo(x, y + row * rowH).lineTo(x + w, y + row * rowH);
  for (let row = 0; row < rows; row++) {
    const top = y + row * rowH;
    const shift = row % 2 === 0 ? 0 : -stoneW / 2;
    for (let col = 1; col * stoneW + shift < w; col++) {
      const at = x + col * stoneW + shift;
      if (at > x && at < x + w) g.moveTo(at, top).lineTo(at, Math.min(top + rowH, y + h));
    }
  }
  g.stroke({ width: 1, color: TOKENS.joint, alpha: 0.7 });
}

/** A chamber seen from above: a stone floor, a shadow along the inside of the wall, and the wall line (the state's outline). */
function chamber(width: number, height: number, fill: string, state: State, baseOutline: string): Graphics {
  const style = STATE_STYLES[state];
  const g = new Graphics();
  const half = style.outlineWidth / 2;
  const inner = { x: half + 1, y: half + 1, w: width - style.outlineWidth - 2, h: height - style.outlineWidth - 2 };
  if (state === "comparison-removed") {
    // A ghost: the floor is faint and the wall is a dashed line.
    g.roundRect(half, half, width - style.outlineWidth, height - style.outlineWidth, 4).fill({ color: fill, alpha: 0.35 });
    dashedRect(g, half, half, width - style.outlineWidth, height - style.outlineWidth, style.outlineWidth, TOKENS.ink);
    return g;
  }
  g.roundRect(half, half, width - style.outlineWidth, height - style.outlineWidth, 4).fill(fill);
  flagstones(g, inner.x, inner.y, inner.w, inner.h, fill, state === "subdued" ? 0.1 : 0.22);
  // The shadow the wall throws on the floor.
  g.roundRect(half + 1, half + 1, width - style.outlineWidth - 2, height - style.outlineWidth - 2, 3).stroke({ width: 3, color: TOKENS.floor, alpha: 0.45 });
  g.roundRect(half, half, width - style.outlineWidth, height - style.outlineWidth, 4).stroke({ width: style.outlineWidth, color: outlineColor(state, baseOutline) });
  return g;
}

/** A hall: a wall of two lines around a floor, with a post at every corner. The nine slices keep the corners. */
function hall(width: number, height: number, state: State): Graphics {
  const style = STATE_STYLES[state];
  const g = new Graphics();
  const half = style.outlineWidth / 2;
  g.roundRect(half, half, width - style.outlineWidth, height - style.outlineWidth, 6).fill(TOKENS.wing);
  g.roundRect(half + 2, half + 2, width - style.outlineWidth - 4, height - style.outlineWidth - 4, 4).stroke({ width: 3, color: TOKENS.wall, alpha: 0.55 });
  g.roundRect(half + 6, half + 6, width - style.outlineWidth - 12, height - style.outlineWidth - 12, 2).stroke({ width: 1, color: TOKENS.joint, alpha: 0.9 });
  for (const [x, y] of [
    [3, 3],
    [width - 9, 3],
    [3, height - 9],
    [width - 9, height - 9],
  ] as const) {
    g.rect(x, y, 6, 6).fill(TOKENS.wall).stroke({ width: 1, color: TOKENS.floor });
  }
  g.roundRect(half, half, width - style.outlineWidth, height - style.outlineWidth, 6).stroke({ width: style.outlineWidth, color: outlineColor(state, TOKENS.wall) });
  return g;
}

/** A small lit arch: the opening of a door in a wall. Its light spills as a faint disc behind it. */
function arch(fill: string, state: State, baseOutline: string, mark: string | null): Graphics {
  const style = STATE_STYLES[state];
  const g = new Graphics();
  const width = Math.max(1, style.outlineWidth);
  const draw = (): void => {
    g.moveTo(2, 15).lineTo(2, 7).arc(8, 7, 6, Math.PI, 0).lineTo(14, 15).closePath();
  };
  if (state === "comparison-removed") {
    // A ghost: a faint arch inside a dashed box.
    draw();
    g.fill({ color: fill, alpha: 0.3 });
    dashedRect(g, width / 2, width / 2, DOOR_BASE - width, DOOR_BASE - width, width, TOKENS.ink);
    return g;
  }
  g.circle(8, 8, 8).fill({ color: fill, alpha: state === "default" ? 0.16 : 0.1 });
  draw();
  g.fill(fill);
  g.moveTo(5, 15).lineTo(5, 8).arc(8, 8, 3, Math.PI, 0).lineTo(11, 15).closePath();
  g.fill({ color: shade(fill, 0.55), alpha: 0.9 });
  draw();
  g.stroke({ width: Math.min(width, 2.5), color: outlineColor(state, baseOutline) });
  if (mark !== null) g.moveTo(2, 15).lineTo(14, 15).stroke({ width: 1, color: mark });
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
      node.addChild(chamber(ROOM_W, ROOM_H, style.fill, state, TOKENS.wall));
      if (style.glyph !== null) {
        const glyph = glyphText(style.glyph, 14, TOKENS.roomInk);
        glyph.position.set(ROOM_W - glyph.width - 6, 4);
        node.addChild(glyph);
      }
      return { node, frame: new Rectangle(0, 0, ROOM_W, ROOM_H) };
    }
    case "grouped": {
      node.addChild(chamber(ROOM_W, ROOM_H, TOKENS.wing, state, TOKENS.wingInk));
      return { node, frame: new Rectangle(0, 0, ROOM_W, ROOM_H) };
    }
    case "wing": {
      node.addChild(hall(WING_BASE, WING_BASE, state));
      return { node, frame: new Rectangle(0, 0, WING_BASE, WING_BASE) };
    }
    case "door": {
      const fill = state === "witness" ? TOKENS.corridor : state === "trace" ? TOKENS.light : TOKENS.door;
      node.addChild(arch(fill, state, TOKENS.floor, null));
      return { node, frame: new Rectangle(0, 0, DOOR_BASE, DOOR_BASE) };
    }
    case "sealed": {
      node.addChild(arch(TOKENS.panel, state, TOKENS.sealed, TOKENS.sealed));
      const mark = glyphText(SEALED_GLYPH, 10, TOKENS.sealed);
      mark.position.set((DOOR_BASE - mark.width) / 2, 5);
      node.addChild(mark);
      return { node, frame: new Rectangle(0, 0, DOOR_BASE, DOOR_BASE) };
    }
    default: {
      // corridor: the pill behind an import count.
      const g = new Graphics();
      g.roundRect(0.5, 0.5, BADGE_W - 1, BADGE_H - 1, 10).fill(TOKENS.panel).stroke({ width: 1, color: TOKENS.passage });
      node.addChild(g);
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
