import { rectsOverlap, type Box } from "./labels";

// The haunt of a door: when the ghost of a dependency loop reaches a door it goes in (it fades from view), the panel swings shut and
// the door shakes for a second or so with a few puffs of dust at its foot, then the panel bursts open and a random mix of two to five
// bats and black cats comes out. Bats fly out and up, cats run out along the floor away from the door, and all fade away. The ghost
// comes out of the door and goes on along the loop.
//
// This is drawing only. The haunt reads a time step, the door it is at and the boxes of the names; it never reads or changes the
// graph, the selection, the steps or any analysis result. Its random numbers come from a small seedable generator (`mulberry32`)
// that only this file reads, so that a test (or the development build with a fixed seed) sees the same haunt every time.

export type HauntPhase = "none" | "enter" | "shake" | "burst" | "exit";
export type CritterKind = "bat" | "cat";

export const HAUNT = {
  /** The ghost fades and shrinks into the door in this long; the panel then swings shut. */
  goInMs: 350,
  /** The whole `enter` phase: the ghost goes in and the panel finishes swinging shut (the keeper shuts it in 300 ms). */
  enterMs: 700,
  shakeMinMs: 1000,
  shakeMaxMs: 1500,
  /** The panel bursts open and the critters come out. */
  burstMs: 600,
  /** The ghost comes out of the open door. */
  exitMs: 500,
  critterMin: 2,
  critterMax: 5,
  maxCritters: 5,
  maxPuffs: 6,
  /** A rattle of this many screen pixels at most. */
  shakePx: 3,
} as const;

/** The size of each silhouette on the screen, in CSS pixels (about 14 to 20 across). */
export const CRITTER_PX: Record<CritterKind, { w: number; h: number }> = { bat: { w: 18, h: 11 }, cat: { w: 20, h: 12 } };

/** A small seedable generator (mulberry32): the same seed gives the same numbers in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The kinds that come out of one door: two to five, each a bat or a cat. */
export function rollMix(random: () => number): CritterKind[] {
  const count = HAUNT.critterMin + Math.floor(random() * (HAUNT.critterMax - HAUNT.critterMin + 1));
  const kinds: CritterKind[] = [];
  for (let i = 0; i < count; i++) kinds.push(random() < 0.5 ? "bat" : "cat");
  return kinds;
}

export interface HauntDoor {
  id: string;
  /** The center of the door and the size of its drawn box, in scene units. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CritterReading {
  id: number;
  kind: CritterKind;
  /** The center, in scene units. */
  x: number;
  y: number;
  alpha: number;
  /** 1 faces right, -1 faces left. */
  flip: 1 | -1;
  /** The wing beat of a bat (1 spread, less folded); 1 for a cat. */
  flap: number;
  box: Box;
  /** False while the critter would cover a name, a plate or a title. */
  visible: boolean;
}

export interface PuffReading {
  id: number;
  x: number;
  y: number;
  /** The radius in scene units. */
  r: number;
  alpha: number;
  box: Box;
  visible: boolean;
}

export interface HauntReading {
  phase: HauntPhase;
  door: string | null;
  /** The opacity and the scale of the ghost: it is hidden (0) from the end of its going in to the start of its coming out. */
  ghostAlpha: number;
  ghostScale: number;
  /** What the keeper of the door is asked to do: shut, open, or nothing (null: the ghost's own reach decides). */
  hold: boolean | null;
  /** The offset of the panel and the frame of the door, in scene units. */
  shake: { x: number; y: number };
  critters: CritterReading[];
  puffs: PuffReading[];
}

export interface Haunt {
  /** Begin a haunt at `door`; ignored while one runs. */
  start(door: HauntDoor): void;
  update(deltaMs: number): void;
  /** Scene units per screen pixel (1 / zoom): the pixel sizes and speeds of the haunt follow the zoom. */
  setUnit(unitsPerPx: number): void;
  /** The boxes of the names, plates and titles in scene units; a critter or puff that would cover one is hidden, and the shake keeps off them. */
  setLabels(boxes: readonly Box[]): void;
  readonly phase: HauntPhase;
  readonly active: boolean;
  /** The particles the haunt can use at most: critters and puffs. They count inside the 40 of the scene. */
  readonly slots: number;
  read(): HauntReading;
}

interface Critter {
  id: number;
  kind: CritterKind;
  age: number;
  life: number;
  /** Speed in screen pixels per second, and the direction of a cat. */
  vx: number;
  vy: number;
  dir: 1 | -1;
  phase: number;
  /** The center of the door it came out of, in scene units. */
  hx: number;
  hy: number;
}

interface Puff {
  id: number;
  age: number;
  life: number;
  ox: number;
  hx: number;
  hy: number;
}

const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);

export function createHaunt(opts: { seed: number; critterSlots: number; puffSlots: number }): Haunt {
  const critterSlots = Math.max(0, Math.min(HAUNT.maxCritters, Math.floor(opts.critterSlots)));
  const puffSlots = Math.max(0, Math.min(HAUNT.maxPuffs, Math.floor(opts.puffSlots)));
  // Two streams: the mix and the timing of the haunt are drawn at fixed points (so the same seed gives the same haunts at any frame rate);
  // the puffs of dust are drawn as the frames come, from their own stream.
  const mix = mulberry32(opts.seed);
  const dust = mulberry32((opts.seed ^ 0x9e3779b9) | 0);
  let phase: HauntPhase = "none";
  let age = 0;
  let shakeMs = HAUNT.shakeMinMs;
  let door: HauntDoor | null = null;
  let unit = 1;
  let labels: readonly Box[] = [];
  let amplitudePx = 0;
  let nextId = 1;
  let dustIn = 0;
  const critters: Critter[] = [];
  const puffs: Puff[] = [];

  const duration = (): number => {
    switch (phase) {
      case "enter":
        return HAUNT.enterMs;
      case "shake":
        return shakeMs;
      case "burst":
        return HAUNT.burstMs;
      case "exit":
        return HAUNT.exitMs;
      default:
        return Infinity;
    }
  };

  const covers = (box: Box): boolean => labels.some((l) => rectsOverlap(box, l));

  const spawn = (): void => {
    const kinds = rollMix(mix).slice(0, critterSlots);
    for (const kind of kinds) {
      const dir: 1 | -1 = mix() < 0.5 ? -1 : 1;
      const critter: Critter =
        kind === "bat"
          ? { id: nextId++, kind, age: 0, life: 1900 + mix() * 700, vx: dir * (25 + mix() * 45), vy: -(55 + mix() * 40), dir, phase: mix() * Math.PI * 2, hx: door?.x ?? 0, hy: door?.y ?? 0 }
          : { id: nextId++, kind, age: 0, life: 1600 + mix() * 800, vx: dir * (70 + mix() * 40), vy: 0, dir, phase: mix() * Math.PI * 2, hx: door?.x ?? 0, hy: door?.y ?? 0 };
      critters.push(critter);
    }
  };

  const enterPhase = (next: HauntPhase): void => {
    phase = next;
    age = 0;
    if (next === "burst") spawn();
    if (next === "shake") dustIn = 0;
    if (next === "none") door = null;
  };

  /** Pixel offsets from the center of the door. */
  const critterOffset = (c: Critter): { x: number; y: number } => {
    const s = c.age / 1000;
    if (c.kind === "bat") return { x: c.vx * s + Math.sin(s * Math.PI * 2 * 1.1 + c.phase) * 10, y: -2 + c.vy * s + Math.sin(s * Math.PI * 2 * 2.3 + c.phase) * 3 };
    return { x: c.vx * s, y: 7 - Math.abs(Math.sin(s * Math.PI * 2 * 5 + c.phase)) * 1.2 };
  };

  const critterAlpha = (c: Critter): number => {
    const t = c.age / c.life;
    const from = c.kind === "bat" ? 0.55 : 0.6;
    return t <= from ? 1 : Math.max(0, 1 - (t - from) / (1 - from));
  };

  const readShake = (): { x: number; y: number } => {
    if (phase !== "shake" || amplitudePx === 0) return { x: 0, y: 0 };
    const s = age / 1000;
    const env = 0.7 + 0.3 * Math.sin(s * Math.PI * 2 * 3);
    const a = amplitudePx * unit;
    return { x: a * env * Math.sin(s * Math.PI * 2 * 13), y: a * 0.5 * Math.sin(s * Math.PI * 2 * 17 + 1) };
  };

  return {
    start(next) {
      if (phase !== "none") return;
      door = next;
      shakeMs = HAUNT.shakeMinMs + mix() * (HAUNT.shakeMaxMs - HAUNT.shakeMinMs);
      // The shake is as wide as it can be (3, 2 or 1 px) without the door reaching a name, a plate or a title; none when the door stands at one.
      amplitudePx = 0;
      for (const px of [HAUNT.shakePx, 2, 1]) {
        const reach = px * unit;
        const grown: Box = { x: next.x - next.w / 2 - reach, y: next.y - next.h / 2 - reach, w: next.w + 2 * reach, h: next.h + 2 * reach };
        if (!covers(grown)) {
          amplitudePx = px;
          break;
        }
      }
      enterPhase("enter");
    },

    update(deltaMs) {
      const dt = Math.max(0, deltaMs);
      for (const c of critters) c.age += dt;
      for (const p of puffs) p.age += dt;
      for (let i = critters.length - 1; i >= 0; i--) if ((critters[i] as Critter).age >= (critters[i] as Critter).life) critters.splice(i, 1);
      for (let i = puffs.length - 1; i >= 0; i--) if ((puffs[i] as Puff).age >= (puffs[i] as Puff).life) puffs.splice(i, 1);
      let remaining = dt;
      for (let guard = 0; phase !== "none" && guard < 8; guard++) {
        const left = duration() - age;
        if (remaining < left) {
          age += remaining;
          break;
        }
        remaining -= left;
        enterPhase(phase === "enter" ? "shake" : phase === "shake" ? "burst" : phase === "burst" ? "exit" : "none");
      }
      if (phase === "shake" && door !== null) {
        dustIn -= dt;
        if (dustIn <= 0 && puffs.length < puffSlots) {
          puffs.push({ id: nextId++, age: 0, life: 450 + dust() * 250, ox: (dust() - 0.5) * 16, hx: door.x, hy: door.y });
          dustIn = 90 + dust() * 120;
        } else if (dustIn <= 0) dustIn = 90;
      }
    },

    setUnit(unitsPerPx) {
      unit = Math.max(unitsPerPx, 1e-6);
    },

    setLabels(boxes) {
      labels = boxes;
    },

    get phase() {
      return phase;
    },
    get active() {
      return phase !== "none";
    },
    get slots() {
      return critterSlots + puffSlots;
    },

    read() {
      const at = door ?? { id: "", x: 0, y: 0, w: 0, h: 0 };
      let ghostAlpha = 1;
      let ghostScale = 1;
      let hold: boolean | null = null;
      if (phase === "enter") {
        const p = Math.min(1, age / HAUNT.goInMs);
        ghostAlpha = p >= 1 ? 0 : 1 - p;
        ghostScale = 1 - 0.4 * p;
        hold = age >= HAUNT.goInMs ? false : null;
      } else if (phase === "shake") {
        ghostAlpha = 0;
        ghostScale = 0.6;
        hold = false;
      } else if (phase === "burst") {
        ghostAlpha = 0;
        ghostScale = 0.6;
        hold = true;
      } else if (phase === "exit") {
        const p = easeOut(Math.min(1, age / HAUNT.exitMs));
        ghostAlpha = p;
        ghostScale = 0.6 + 0.4 * p;
        hold = true;
      }
      return {
        phase,
        door: phase === "none" ? null : at.id,
        ghostAlpha,
        ghostScale,
        hold,
        shake: readShake(),
        critters: critters.map((c): CritterReading => {
          const o = critterOffset(c);
          const x = c.hx + o.x * unit;
          const y = c.hy + o.y * unit;
          const size = CRITTER_PX[c.kind];
          const box: Box = { x: x - (size.w * unit) / 2, y: y - (size.h * unit) / 2, w: size.w * unit, h: size.h * unit };
          const s = c.age / 1000;
          return {
            id: c.id,
            kind: c.kind,
            x,
            y,
            alpha: critterAlpha(c),
            flip: c.kind === "bat" ? (c.vx < 0 ? -1 : 1) : c.dir,
            flap: c.kind === "bat" ? 0.55 + 0.45 * Math.abs(Math.sin(s * Math.PI * 2 * 7 + c.phase)) : 1,
            box,
            visible: !covers(box),
          };
        }),
        puffs: puffs.map((p): PuffReading => {
          const t = p.age / p.life;
          const rPx = 2 + 3 * t;
          const x = p.hx + p.ox * unit;
          const y = p.hy + (10 - (p.age / 1000) * 8) * unit;
          const r = rPx * unit;
          const box: Box = { x: x - r, y: y - r, w: 2 * r, h: 2 * r };
          return { id: p.id, x, y, r, alpha: 0.55 * (1 - t), box, visible: !covers(box) };
        }),
      };
    },
  };
}
