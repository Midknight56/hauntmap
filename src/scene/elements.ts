import { Container, Graphics, Rectangle, type Renderer, type Texture } from "pixi.js";
import { drawCritter } from "./critters";
import { FRAME } from "./doorLook";
import { STATE_STYLES, TOKENS, type State } from "./styles";
import type { TextureRenderer } from "./textures";

// The texture of one element kind in one state. Each is drawn once and reused (see textures.ts), and drawn in
// code: stone floors, walls and lit arches come from rectangles, lines and a fixed pattern, never from an image.
// Wings and corridors are drawn as shapes of the scene (rooms.ts, corridors.ts), not as textures.
// Labels that depend on the module (names, counts) are separate Text objects, not part of a texture.

export const FONT = "'Spline Sans Mono', ui-monospace, Consolas, monospace";
/** The display face of the wing title plaques (Almendra SC, SIL Open Font License, committed in src/styles/fonts). */
export const DISPLAY_FONT = "'Almendra SC', Georgia, serif";

export const ROOM_W = 96;
export const ROOM_H = 64;
const DOOR_BASE = 16;
const BADGE_W = 84;
const BADGE_H = 24;

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
    case "comparison-added":
      return TOKENS.added;
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

/** A dashed rectangle outline (the removed-in-the-newer-snapshot ghost). */
function dashedRect(g: Graphics, x: number, y: number, w: number, h: number, width: number, color: string, dash = 6, gap = 4): void {
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

/** The border of a room: 1.5 units in the wall colour of the design; the states of `STATE_STYLES` widen it or change its colour. */
const ROOM_BORDER = 1.5;

function fillOf(state: State): string {
  return state === "selected" || state === "focusHalo" ? TOKENS.selectedFill : STATE_STYLES[state].fill;
}

/**
 * A room seen from above, as the design draws it: a flat fill with a thin wall border (candle and a lit fill when
 * selected, ecto on a loop, moss when added). The glow around a lit room is drawn by the scene (rooms.ts), outside the
 * 96 by 64 frame of the texture.
 */
function chamber(width: number, height: number, state: State, baseOutline: string, fill: string = fillOf(state)): Graphics {
  const style = STATE_STYLES[state];
  const g = new Graphics();
  const line = Math.max(ROOM_BORDER, style.outlineWidth);
  const half = line / 2;
  const w = width - line;
  const h = height - line;
  if (state === "comparison-removed") {
    // A ghost: no floor, and a dashed outline.
    dashedRect(g, half, half, w, h, line, TOKENS.removed);
    return g;
  }
  g.roundRect(half, half, w, h, 3).fill(fill);
  g.roundRect(half, half, w, h, 3).stroke({ width: line, color: outlineColor(state, baseOutline) });
  // A subdued room also has a dotted inner rail, so that it differs from a lit room by shape when its words are not drawn.
  if (state === "subdued") dashedRect(g, line + 3, line + 3, width - 2 * line - 6, height - 2 * line - 6, 1.5, TOKENS.edge, 1, 4);
  return g;
}

/** A small lit arch: the opening of a door in a wall. */
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
    dashedRect(g, width / 2, width / 2, DOOR_BASE - width, DOOR_BASE - width, width, TOKENS.removed);
    return g;
  }
  g.circle(8, 8, 8).fill({ color: fill, alpha: state === "default" ? 0.12 : 0.1 });
  draw();
  g.fill(fill);
  g.moveTo(5, 15).lineTo(5, 8).arc(8, 8, 3, Math.PI, 0).lineTo(11, 15).closePath();
  g.fill({ color: shade(fill, 0.55), alpha: 0.9 });
  draw();
  g.stroke({ width: Math.min(width, 2.5), color: outlineColor(state, baseOutline) });
  if (mark !== null) g.moveTo(2, 15).lineTo(14, 15).stroke({ width: 1, color: mark });
  return g;
}

/** The outer edge of a door frame (two jambs and an arched lintel) in the 16 unit grid. */
export function framePath(g: Graphics, outer: boolean): void {
  const left = outer ? FRAME.outerLeft : FRAME.innerLeft;
  const right = outer ? FRAME.outerRight : FRAME.innerRight;
  const cy = outer ? FRAME.outerArchCenterY : FRAME.innerArchCenterY;
  const r = outer ? FRAME.outerArchRadius : FRAME.innerArchRadius;
  g.moveTo(left, FRAME.bottom).lineTo(left, cy).arc(8, cy, r, Math.PI, 0).lineTo(right, FRAME.bottom).closePath();
}

/**
 * The closed panel inside the opening of a door: wood, one plank seam, two hinge plates on the left jamb and a knob on the right.
 * The scene draws the same panel as a separate node for the doors that swing (doors.ts), so that it can turn on its hinge.
 */
export function drawPanel(g: Graphics): void {
  framePath(g, false);
  g.fill(shade(TOKENS.room, -0.45));
  g.moveTo(8, FRAME.innerArchCenterY - FRAME.innerArchRadius + 0.6).lineTo(8, FRAME.bottom).stroke({ width: 0.6, color: TOKENS.wallLine, alpha: 0.85 });
  g.rect(FRAME.innerLeft, 8.4, 1.3, 1.5).fill(TOKENS.wallLine);
  g.rect(FRAME.innerLeft, 12.2, 1.3, 1.5).fill(TOKENS.wallLine);
  g.circle(11.3, 11.3, 1).fill(TOKENS.focus);
}

/**
 * A door seen from the front: a stone frame (two jambs and an arched lintel) in the color of its state, the dark opening, and the closed
 * panel with its knob and hinge plates. Drawn once into the texture of its state and reused by every door.
 */
function doorFrame(fill: string, state: State, baseOutline: string): Graphics {
  const style = STATE_STYLES[state];
  const g = new Graphics();
  const width = Math.max(1, style.outlineWidth);
  if (state === "comparison-removed") {
    // A ghost: a faint frame inside a dashed box.
    framePath(g, true);
    g.fill({ color: fill, alpha: 0.3 });
    dashedRect(g, width / 2, width / 2, DOOR_BASE - width, DOOR_BASE - width, width, TOKENS.removed);
    return g;
  }
  framePath(g, true);
  g.fill(fill);
  framePath(g, false);
  g.fill(shade(TOKENS.floor, -0.6));
  drawPanel(g);
  framePath(g, true);
  g.stroke({ width: Math.min(width, 2.5), color: outlineColor(state, baseOutline) });
  return g;
}
/** The display object to render into the texture of `(kind, state)`, and its pixel frame. */
function draw(kind: string, stateName: string): { node: Container; frame: Rectangle } {
  const state = stateOf(stateName);
  const node = new Container();
  switch (kind) {
    case "room": {
      node.addChild(chamber(ROOM_W, ROOM_H, state, TOKENS.wallLine));
      // The `+` of an added room is a text of the scene (rooms.ts), so that it keeps 12 CSS pixels at every zoom.
      return { node, frame: new Rectangle(0, 0, ROOM_W, ROOM_H) };
    }
    case "grouped": {
      node.addChild(chamber(ROOM_W, ROOM_H, state, TOKENS.wallLine, TOKENS.wing));
      return { node, frame: new Rectangle(0, 0, ROOM_W, ROOM_H) };
    }
    case "door": {
      const fill = state === "witness" ? TOKENS.corridor : state === "trace" ? TOKENS.light : TOKENS.door;
      node.addChild(doorFrame(fill, state, TOKENS.floor));
      return { node, frame: new Rectangle(0, 0, DOOR_BASE, DOOR_BASE) };
    }
    case "sealed": {
      node.addChild(arch(TOKENS.panel, state, TOKENS.sealed, TOKENS.sealed));
      // The `?` is a text of the scene (doors.ts), so that it keeps 12 CSS pixels at every zoom.
      return { node, frame: new Rectangle(0, 0, DOOR_BASE, DOOR_BASE) };
    }
    case "critter": {
      // The bat and the cat of the haunt (`stateName` is the kind): drawn once, a dark silhouette with a thin light rim.
      const critter = drawCritter(stateName);
      return { node: critter.node, frame: new Rectangle(0, 0, critter.w, critter.h) };
    }
    case "fog": {
      // A soft round cloud: white rings, each a little smaller and a little more opaque in the middle. The scene tints and thins it.
      const g = new Graphics();
      const rings = 24;
      for (let k = 0; k < rings; k++) g.circle(64, 64, 64 * (1 - k / rings)).fill({ color: "#ffffff", alpha: 0.09 });
      node.addChild(g);
      return { node, frame: new Rectangle(0, 0, 128, 128) };
    }
    default: {
      // corridor: the pill behind an import count.
      const g = new Graphics();
      g.roundRect(0.5, 0.5, BADGE_W - 1, BADGE_H - 1, BADGE_H / 2 - 0.5).fill(TOKENS.floor).stroke({ width: 1, color: TOKENS.wallLine });
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
      // A door and a sealed doorway are small and seen close up: they get a finer texture than the rooms.
      const texture = renderer.generateTexture({ target: node, frame, resolution: kind === "door" || kind === "sealed" || kind === "critter" ? 4 : 2 });
      node.destroy({ children: true });
      return texture;
    },
  };
}
