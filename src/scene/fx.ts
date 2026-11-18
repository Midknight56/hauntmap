import { Container, Graphics, type Sprite } from "pixi.js";
import type { Decor } from "./decor";
import type { Point, Rect } from "./layout/types";
import { TOKENS } from "./styles";

// The handles the effects of the motion pass need. The draw functions put into a `SceneFx` the few nodes that move or fade; the
// adapter plays the effects on them. They are drawing only: nothing here reads or changes the graph, the selection or the steps.

export interface DoorOpen {
  relationId: string;
  /** How far the door has swung open, 0 to 1. */
  swing: number;
  /** How far the corridor is drawn toward its target, 0 to 1. */
  draw: number;
  setSwing(fraction: number): void;
  setDraw(fraction: number): void;
}

export interface LampFx {
  node: Graphics;
  seed: number;
  /** 0 to 1: the flicker-on of the comparison; the candle flicker is multiplied with it. */
  entrance: number;
}

export interface AddedFx {
  relationId: string | null;
  container: Container;
  /** The center the mark grows from, in scene units. */
  cx: number;
  cy: number;
  scale: number;
  pulse: Graphics;
}

/** A room of the loop: the candle glow that lights it as the ghost reaches it (0 dim, 1 lit). */
export interface RoomLight {
  setGlow(fraction: number): void;
}

/** The leaf of a door that swings for the ghost or the traveling light (0 shut, 1 open). */
export interface DoorLeaf {
  /** The width of the drawn leaf in scene units. */
  readonly widthUnits: number;
  /** How far the panel is open now, 0 shut to 1 open. */
  readonly open: number;
  /** The width of the dark opening that shows now, in scene units. */
  readonly openingUnits: number;
  setOpen(fraction: number): void;
  /** Grow the leaf to `factor` times the 16 unit door (the doorway is drawn by the same step). */
  setGrow(factor: number): void;
}

/** The effects whose update cost is measured in the dev build, in milliseconds per frame. */
export const EFFECT_NAMES = ["fog", "bats", "spiders", "motes", "doors", "loopLights", "candles", "ghost"] as const;
export type EffectName = (typeof EFFECT_NAMES)[number];
/** Where an update adds the time it took; absent in the release build, so that nothing is timed there. */
export type CostSink = (name: EffectName, ms: number) => void;

export interface SceneFx {
  /** The window of each room that is lit (selected, on a route, added): by module ID. */
  glows: Map<string, Container>;
  /** The sprite of each drawn door by relation ID. */
  doorSprites: Map<string, Sprite>;
  lamps: LampFx[];
  added: AddedFx[];
  /** The dashed ghost outlines of removed doors, rooms and doorways. */
  removedOutlines: (Graphics | Container)[];
  /** The solid corridors that the removed outlines replace (a copy that fades out). */
  removedSolid: Container | null;
  openDoor: DoorOpen | null;
  /** The rooms of the loops shown, by module ID. */
  loopRooms: Map<string, RoomLight>;
  /** The leaf of each door that swings, by relation ID. */
  leaves: Map<string, DoorLeaf>;
  /** How many dark doorways are drawn behind the swinging leaves. */
  doorways: number;
  /** How many times the frames and doorways were drawn again since the map was drawn (a camera step does; a swing never does). */
  doorDraws: number;
  /** Called at every zoom: the doorways and leaves follow it in steps. */
  setDoorZoom: ((zoom: number) => void) | null;
  /** The cobwebs, candles, cracks, fog, bats and spiders. */
  decor: Decor | null;
}

export function newFx(): SceneFx {
  return { glows: new Map(), doorSprites: new Map(), lamps: [], added: [], removedOutlines: [], removedSolid: null, openDoor: null, loopRooms: new Map(), leaves: new Map(), doorways: 0, doorDraws: 0, setDoorZoom: null, decor: null };
}

/** A pure pseudo-random number in [0, 1) from two integers, so that the motes start in the same places on every run. */
export function unit(i: number, k: number): number {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** The most motes the map draws; the ghost's dust and the motes together stay inside the 40 particles of the steering file. */
export const MAX_MOTES = 10;

export interface Motes {
  readonly count: number;
  update(clockMs: number): void;
  setZoom(zoom: number): void;
  positions(): Point[];
}

/**
 * A few faint dust motes drifting in the light of the map. Each is one small circle; their positions are computed from the clock
 * (no texture, no layout, no allocation per frame). They drift up and sideways slowly and wrap inside the bounds of the manor.
 */
export function createMotes(parent: Container, bounds: Rect, count: number, zoom: number): Motes {
  const nodes: Graphics[] = [];
  const spread = { x: bounds.w + 160, y: bounds.h + 160 };
  const origin = { x: bounds.x - 80, y: bounds.y - 80 };
  const here: Point[] = [];
  const layer = new Container();
  layer.label = "motes";
  for (let i = 0; i < count; i++) {
    const mote = new Graphics();
    mote.circle(0, 0, 2.6).fill({ color: TOKENS.light, alpha: 0.12 });
    mote.circle(0, 0, 1.3).fill({ color: TOKENS.light, alpha: 0.32 });
    layer.addChild(mote);
    nodes.push(mote);
    here.push({ x: 0, y: 0 });
  }
  parent.addChild(layer);
  const mod = (a: number, n: number): number => ((a % n) + n) % n;
  const update = (clockMs: number): void => {
    const t = clockMs / 1000;
    for (let i = 0; i < nodes.length; i++) {
      const vx = (unit(i, 3) - 0.5) * 9;
      const vy = -(2.5 + unit(i, 4) * 5);
      const x = origin.x + mod(unit(i, 1) * spread.x + vx * t + Math.sin(t / (2.2 + unit(i, 5) * 2) + i) * 6, spread.x);
      const y = origin.y + mod(unit(i, 2) * spread.y + vy * t, spread.y);
      (nodes[i] as Graphics).position.set(x, y);
      (here[i] as Point).x = x;
      (here[i] as Point).y = y;
      (nodes[i] as Graphics).alpha = 0.55 + 0.45 * Math.sin(t * (0.6 + unit(i, 6)) + i * 1.7);
    }
  };
  const setZoom = (z: number): void => {
    const s = 1 / Math.max(z, 0.0001);
    for (const n of nodes) n.scale.set(s);
  };
  setZoom(zoom);
  update(0);
  return { count, update, setZoom, positions: () => here.map((p) => ({ x: p.x, y: p.y })) };
}
