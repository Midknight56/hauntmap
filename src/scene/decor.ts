import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import { batFlight, crackPath, fogAlphaCap, hash32, MAX_DECOR_MOVERS, spiderDrop, STILL_CLOCK_MS, webPaths, type Corner } from "./decorMath";
import { candleAlpha } from "./effects";
import { unit } from "./fx";
import { rectsOverlap, type Box } from "./labels";
import type { LayerName } from "./layers";
import type { Point, Rect, RoomBox, WingBox } from "./layout/types";
import type { State } from "./styles";
import { TOKENS } from "./styles";

// The halloween details of the map, all drawn in code: cobwebs in the corners of wings and rooms, cracks in the floors, candles on the
// wing walls, fog low over the floor, a few bats that cross the map now and then, and spiders on a thread from a wing wall. They are
// drawing only. Every one has a box in scene units; a detail whose box would cover a drawn name or title is not shown (`settle`, and
// every frame for the ones that move). Under reduced motion they stand still in a fixed pose.
//
// The cobwebs and cracks are not one object each: every kind in every layer is one shared drawing that is made again only when the set
// of details that are shown changes. That keeps the number of objects the renderer walks at each frame small.

export type DecorKind = "web" | "crack" | "candle" | "fog" | "bat" | "spider";

export interface DecorReading {
  kind: DecorKind;
  /** True when the thing moves (never under reduced motion). */
  moving: boolean;
  /** False while it rests or would cover a name. */
  visible: boolean;
  /** The box in scene units; a zero box while it rests. */
  box: Box;
}

type DecorLayers = Pick<Record<LayerName, Container>, "floor" | "rooms" | "particles">;

export interface Decor {
  /** Cobwebs and cracks (a shared drawing in the floor layer) and a candle (particle layer, so that its flicker never touches the batch of the floors) of one wing. */
  wing(wing: WingBox, layers: Pick<DecorLayers, "floor" | "particles">): void;
  /** A web and a crack of one room (a shared drawing above the rooms). */
  room(room: RoomBox, state: State): void;
  /** Fog over the floor, the bats, and the spiders: called once, after every wing. */
  sky(layers: DecorLayers, wings: readonly WingBox[]): void;
  /** Put the shared drawings of the cobwebs and cracks into their layers: called once, after every room. */
  finish(layers: DecorLayers): void;
  /** Move what moves to the pose of `clockMs`. */
  update(clockMs: number): void;
  setZoom(zoom: number): void;
  /** After the names are laid out: hide every detail whose box covers one of `labels` (scene units). */
  settle(labels: readonly Box[]): void;
  /** The things that move (they count as particles); 0 under reduced motion. */
  readonly movers: number;
  readings(): DecorReading[];
}

/** The cobwebs or the cracks of one layer, drawn together. */
interface Group {
  graphics: Graphics;
  width: number;
  color: () => string;
  alpha: number;
  members: Fixed[];
  shown: string;
}

/** A cobweb or a crack: lines in scene units that do not move. */
interface Fixed {
  kind: "web" | "crack";
  paths: Point[][];
  box: Box;
  covered: boolean;
}

/** Something that moves, or is a sprite of its own: a candle, a bat, a spider, a wisp of fog. */
interface Mover {
  kind: "candle" | "bat" | "spider" | "fog";
  moving: boolean;
  node: Container;
  box: Box;
  /** False while a bat is away or a spider is at the wall. */
  active: boolean;
  covered: boolean;
  place: (clockMs: number) => void;
}

const ZERO: Box = { x: 0, y: 0, w: 0, h: 0 };
const MAX_CANDLES = 6;
const MAX_SPIDERS = 3;
const BATS = 3;
const WISPS = 3;
/** The size of a wisp of fog on the screen, in CSS pixels. */
const FOG_W = 280;
const FOG_H = 64;

function bbox(points: readonly Point[], pad: number): Box {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y };
}

const shift = (paths: readonly (readonly Point[])[], dx: number, dy: number): Point[][] => paths.map((path) => path.map((p) => ({ x: p.x + dx, y: p.y + dy })));

export function createDecor(opts: { reduced: boolean; zoom: number; bounds: Rect; clockMs: number; fog: Texture }): Decor {
  const { reduced, bounds } = opts;
  let zoom = Math.max(opts.zoom, 0.0001);
  let clock = reduced ? STILL_CLOCK_MS : opts.clockMs;
  let labelBoxes: readonly Box[] = [];
  let candles = 0;
  let spiders = 0;
  const movers: Mover[] = [];

  const group = (width: number, color: () => string, alpha: number): Group => ({ graphics: new Graphics(), width, color, alpha, members: [], shown: "" });
  const floorWebs = group(0.8, () => TOKENS.ink, 0.34);
  const floorCracks = group(0.9, () => TOKENS.wallLine, 0.46);
  const roomWebs = group(0.8, () => TOKENS.ink, 0.34);
  const roomCracks = group(0.9, () => TOKENS.wallLine, 0.5);
  const groups = [floorWebs, floorCracks, roomWebs, roomCracks];

  const covers = (box: Box): boolean => labelBoxes.some((l) => rectsOverlap(box, l));

  /** Make the drawing of a group again when the set of members that are shown has changed. */
  const redraw = (g: Group): void => {
    const shown = g.members.map((m) => (m.covered ? "0" : "1")).join("");
    if (shown === g.shown) return;
    g.shown = shown;
    g.graphics.clear();
    let any = false;
    for (const m of g.members) {
      if (m.covered) continue;
      for (const path of m.paths) {
        const first = path[0] as Point;
        g.graphics.moveTo(first.x, first.y);
        for (const p of path.slice(1)) g.graphics.lineTo(p.x, p.y);
        any = true;
      }
    }
    if (any) g.graphics.stroke({ width: g.width, color: g.color(), alpha: g.alpha, cap: "butt", join: "miter" });
  };

  const addWeb = (into: Group, corner: Corner, r: number, at: Point): void => {
    into.members.push({ kind: "web", paths: shift(webPaths(corner, r, 5), at.x, at.y), box: { x: at.x, y: at.y, w: r, h: r }, covered: false });
  };

  const addCrack = (into: Group, seed: number, at: Box): void => {
    const points = crackPath(seed, at.w, at.h);
    // A short branch off the third point.
    const from = points[2] as Point;
    const branch: Point[] = [from, { x: Math.min(at.w, from.x + at.w * 0.14), y: Math.min(at.h, from.y + at.h * 0.35) }];
    const box = bbox(points.concat(branch), 0.5);
    into.members.push({ kind: "crack", paths: shift([points, branch], at.x, at.y), box: { x: at.x + box.x, y: at.y + box.y, w: box.w, h: box.h }, covered: false });
  };

  const addCandle = (parent: Container, x: number, y: number, seed: number): void => {
    const node = new Container();
    const stick = new Graphics();
    stick.roundRect(-1.8, -9, 3.6, 9, 0.8).fill({ color: TOKENS.ink, alpha: 0.82 });
    stick.rect(-0.3, -11, 0.6, 2).fill({ color: TOKENS.wallLine });
    node.addChild(stick);
    const flame = new Container();
    const glow = new Graphics();
    glow.circle(0, -13, 9).fill({ color: TOKENS.light, alpha: 0.1 });
    glow.circle(0, -13, 5.5).fill({ color: TOKENS.light, alpha: 0.16 });
    flame.addChild(glow);
    const fire = new Graphics();
    fire.ellipse(0, -13.2, 2.2, 3.6).fill({ color: TOKENS.focus, alpha: 0.95 });
    fire.ellipse(0, -12.6, 1.1, 2).fill({ color: TOKENS.light });
    flame.addChild(fire);
    node.addChild(flame);
    node.position.set(x, y);
    parent.addChild(node);
    candles++;
    const mover: Mover = {
      kind: "candle",
      moving: !reduced,
      node,
      box: { x: x - 9, y: y - 22, w: 18, h: 23 },
      active: true,
      covered: false,
      place: (t) => {
        const a = candleAlpha(t, seed, reduced);
        flame.alpha = a;
        flame.scale.set(1, 0.9 + 0.1 * a);
      },
    };
    movers.push(mover);
    mover.place(clock);
  };

  const hideIfCovering = (m: Mover): void => {
    m.covered = m.active && covers(m.box);
    m.node.visible = m.active && !m.covered;
  };

  const decor: Decor = {
    wing(wing, layers) {
      const key = hash32(wing.wing);
      const w = wing.w;
      const h = wing.h;
      const r = Math.min(26, Math.max(14, w * 0.07));
      const bottom = wing.y + h - 7 - r;
      if ((key >>> 2) % 100 < 80) addWeb(floorWebs, "bl", r, { x: wing.x + 7, y: bottom });
      if ((key >>> 6) % 100 < 65) addWeb(floorWebs, "br", r, { x: wing.x + w - 7 - r, y: bottom });
      // A candle on the top wall, right of the plaque; a wing without one gets a web in that corner.
      if (candles < MAX_CANDLES && key % 3 !== 0 && w >= 150) addCandle(layers.particles, wing.x + w - 30, wing.y + 30, (key >>> 3) % 97);
      else if ((key >>> 9) % 100 < 70) addWeb(floorWebs, "tr", Math.min(22, r), { x: wing.x + w - 7 - Math.min(22, r), y: wing.y + 7 });
      if (w >= 120 && h >= 90) {
        addCrack(floorCracks, key % 1000, { x: wing.x + 24, y: wing.y + h - 40, w: Math.min(56, w * 0.3), h: 22 });
        addCrack(floorCracks, (key >>> 5) % 1000, { x: wing.x + w * 0.58, y: wing.y + 44, w: Math.min(60, w * 0.3), h: 22 });
      }
    },

    room(room, state) {
      if (state !== "default" && state !== "witness" && state !== "subdued") return;
      const key = hash32(room.id);
      const r = 13;
      if (key % 100 < 28) addWeb(roomWebs, "br", r, { x: room.x + room.w - 1.5 - r, y: room.y + room.h - 1.5 - r });
      else if ((key >>> 8) % 100 < 22) addWeb(roomWebs, "bl", r, { x: room.x + 1.5, y: room.y + room.h - 1.5 - r });
      if ((key >>> 4) % 100 < 40) addCrack(roomCracks, (key >>> 11) % 1000, { x: room.x + 12 + (key % 18), y: room.y + 36, w: 40, h: 18 });
    },

    sky(layers, wings) {
      // Fog: a few wisps, low over the floor, in the floor layer above the wing halls and under everything else. Each is one sprite of a
      // soft texture, the size of the screen (so that the work to draw it never grows with the zoom). Their opacity is capped so that every
      // ink of the map keeps its contrast on the wing floor under the fog.
      const cap = fogAlphaCap({ wing: TOKENS.wing, fog: TOKENS.edge, inks: [TOKENS.ink, TOKENS.inkMuted, TOKENS.roomInk, TOKENS.plateInk] });
      const span = bounds.w + 2 * 300;
      for (let i = 0; i < WISPS; i++) {
        const fog = new Sprite(opts.fog);
        fog.anchor.set(0.5);
        fog.tint = TOKENS.edge;
        fog.alpha = cap;
        const baseX = bounds.x - 300 + unit(i, 61) * span;
        const y = bounds.y + bounds.h * (0.5 + 0.2 * i) + (unit(i, 62) - 0.5) * 40;
        const speed = 5 + unit(i, 63) * 5;
        layers.floor.addChild(fog);
        const mover: Mover = {
          kind: "fog",
          moving: !reduced,
          node: fog,
          box: ZERO,
          active: true,
          covered: false,
          place: (t) => {
            const s = 1 / zoom;
            const x = bounds.x - 300 + ((((baseX - (bounds.x - 300) + speed * (t / 1000)) % span) + span) % span);
            fog.position.set(x, y + Math.sin(t / 6000 + i * 2) * 8);
            fog.width = FOG_W * s;
            fog.height = FOG_H * s;
            mover.box = { x: x - (FOG_W * s) / 2, y: y - (FOG_H * s) / 2, w: FOG_W * s, h: FOG_H * s };
          },
        };
        movers.push(mover);
        mover.place(clock);
      }

      // Bats: small, drawn at the size of the screen (like the ghost), above the floor and under the names.
      for (let i = 0; i < BATS; i++) {
        const bat = new Container();
        const wingsG = new Graphics();
        for (const side of [-1, 1]) {
          wingsG.moveTo(0, 0).bezierCurveTo(side * 3, -5, side * 8, -5, side * 9.5, -1).lineTo(side * 7.2, 0.5).lineTo(side * 5.2, -0.5).lineTo(side * 3.2, 1.6).lineTo(side * 1.4, 0.6).closePath();
        }
        wingsG.fill({ color: TOKENS.inkMuted, alpha: 0.82 });
        bat.addChild(wingsG);
        const body = new Graphics();
        body.ellipse(0, 0.6, 1.5, 2.6).fill({ color: TOKENS.inkMuted, alpha: 0.9 });
        body.poly([-1.3, -1.6, -1, -3.6, -0.1, -1.9, 0.1, -1.9, 1, -3.6, 1.3, -1.6]).fill({ color: TOKENS.inkMuted, alpha: 0.9 });
        bat.addChild(body);
        layers.particles.addChild(bat);
        const perch = wings[i % Math.max(1, wings.length)];
        const mover: Mover = {
          kind: "bat",
          moving: !reduced,
          node: bat,
          box: ZERO,
          active: false,
          covered: false,
          place: (t) => {
            const s = 1 / zoom;
            bat.scale.set(s);
            if (reduced) {
              // Hanging from the top wall of a wing, wings folded.
              const x = perch === undefined ? bounds.x + 40 + i * 60 : perch.x + perch.w * (0.55 + 0.08 * i);
              const y = perch === undefined ? bounds.y + 10 : perch.y + 14;
              bat.position.set(x, y);
              wingsG.scale.set(1, 0.35);
              mover.active = true;
              mover.box = { x: x - 10 * s, y: y - 4 * s, w: 20 * s, h: 9 * s };
              return;
            }
            const f = batFlight(t, i, bounds);
            mover.active = f.active;
            if (!f.active) {
              mover.box = ZERO;
              return;
            }
            bat.position.set(f.x, f.y);
            wingsG.scale.set(1, 0.3 + 0.7 * f.flap);
            mover.box = { x: f.x - 10 * s, y: f.y - 5 * s, w: 20 * s, h: 10 * s };
          },
        };
        movers.push(mover);
        mover.place(clock);
      }

      // Spiders: each hangs from the top wall of a wing, on a thread of at most 30 units, drops and climbs back.
      for (const wing of wings) {
        if (spiders >= MAX_SPIDERS) break;
        if (wing.w < 170) continue;
        const seed = (hash32(wing.wing) >>> 4) % 89;
        const x = wing.x + wing.w - 11;
        const wall = wing.y + 7;
        const reach = 30;
        const thread = new Graphics();
        thread.moveTo(0, 0).lineTo(0, 1).stroke({ width: 0.7, color: TOKENS.inkMuted, alpha: 0.65 });
        const body = new Graphics();
        body.circle(0, 0, 2.6).fill({ color: TOKENS.inkMuted, alpha: 0.92 });
        for (const side of [-1, 1]) for (const k of [-1.6, -0.5, 0.6, 1.7]) body.moveTo(0, 0).lineTo(side * 4.6, k * 1.8);
        body.stroke({ width: 0.6, color: TOKENS.inkMuted, alpha: 0.8 });
        const node = new Container();
        node.addChild(thread, body);
        node.position.set(x, wall);
        layers.particles.addChild(node);
        spiders++;
        const mover: Mover = {
          kind: "spider",
          moving: !reduced,
          node,
          box: ZERO,
          active: true,
          covered: false,
          place: (t) => {
            const drop = reduced ? 0.6 : spiderDrop(t, seed);
            const len = drop * reach;
            mover.active = len > 0.5;
            thread.scale.y = Math.max(len, 0.0001);
            body.position.set(0, len);
            mover.box = mover.active ? { x: x - 5, y: wall, w: 10, h: len + 5 } : ZERO;
          },
        };
        movers.push(mover);
        mover.place(clock);
      }
    },

    finish(layers) {
      layers.floor.addChild(floorWebs.graphics, floorCracks.graphics);
      layers.rooms.addChild(roomWebs.graphics, roomCracks.graphics);
      for (const g of groups) redraw(g);
    },

    update(t) {
      clock = reduced ? STILL_CLOCK_MS : t;
      if (reduced) return;
      for (const m of movers) {
        if (m.moving) m.place(clock);
        // What moves is checked again at every step against the names, so that it never crosses one.
        if (m.kind === "bat" || m.kind === "spider") hideIfCovering(m);
      }
    },

    setZoom(z) {
      zoom = Math.max(z, 0.0001);
      for (const m of movers) if (m.kind === "bat" || m.kind === "fog") m.place(clock);
    },

    settle(labels) {
      labelBoxes = labels;
      for (const g of groups) {
        for (const m of g.members) m.covered = covers(m.box);
        redraw(g);
      }
      for (const m of movers) if (m.kind !== "fog") hideIfCovering(m);
    },

    get movers() {
      return reduced ? 0 : Math.min(MAX_DECOR_MOVERS, movers.filter((m) => m.moving).length);
    },

    readings() {
      const out: DecorReading[] = [];
      for (const g of groups) for (const m of g.members) out.push({ kind: m.kind, moving: false, visible: !m.covered, box: m.box });
      for (const m of movers) out.push({ kind: m.kind, moving: m.moving, visible: m.node.visible && m.active && !m.covered, box: m.box });
      return out;
    },
  };
  return decor;
}
