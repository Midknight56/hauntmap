import type { Animator } from "./animation";

// The motion of the map as numbers and small players (README of the design, "Motion"). Pure, no PixiJS: the players work on
// objects that have an `alpha` or on a setter, so that tests drive them with a manual animator. Effects only draw; they never
// touch the graph, the selection, the steps or any other data. Under reduced motion the animator applies every end state at once.

export const MOTION_MS = {
  /** A selected room: its window lights. */
  window: 200,
  /** The other rooms dim. */
  dim: 200,
  /** A door swings open. */
  doorSwing: 120,
  /** The corridor of an opened door draws to its target. */
  corridorDraw: 350,
  /** A removed corridor fades to its ghost outline. */
  removed: 600,
  /** The ghost of a dropped loop fades, after the corridor. */
  ghostFade: 400,
  /** An added doorway grows. */
  added: 300,
  /** The one green pulse of an added doorway. */
  pulse: 400,
  /** The lamp of a changed room flickers on three times. */
  lamp: 400,
  /** Zoom and Fit to view. */
  camera: 300,
  /** The rooms fade in on the first load of a manor. */
  intro: 700,
} as const;

/** The other rooms are shown at this opacity while a room is selected. */
export const DIM_ALPHA = 0.6;
/** A room that is not in the traversal (the design asks for 45 to 55 percent). */
export const SUBDUED_ROOM_ALPHA = 0.55;
/** The looping corridor glow breathes between 60 and 100 percent over 2.4 s. */
export const GLOW_PERIOD_MS = 2400;

export interface Alpha {
  alpha: number;
}

export const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);
export const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/** The opacity of the looping corridor glow at `clockMs`. */
export function glowAlphaAt(clockMs: number): number {
  return 0.8 + 0.2 * Math.sin((clockMs / GLOW_PERIOD_MS) * Math.PI * 2);
}

/** The lamp of a changed room flickers on: dark, lit, dark, lit, dark, lit, three times in the run, and stays lit. */
export function flickerOn(progress: number): 0 | 1 {
  if (progress >= 1) return 1;
  if (progress <= 0) return 0;
  return Math.floor(progress * 6) % 2 === 1 ? 1 : 0;
}

/** A soft candle flicker: between 0.86 and 1, a little different for each lamp (`seed`); steady under reduced motion. */
export function candleAlpha(clockMs: number, seed: number, reduced: boolean): number {
  if (reduced) return 1;
  const u = (Math.sin(clockMs / 170 + seed * 2.3) * 0.6 + Math.sin(clockMs / 61 + seed * 5.1) * 0.4 + 1) / 2;
  return 1 - 0.14 * u;
}

/** The opacity a room rests at: 0.6 while a room is selected and it is not that room; subdued rooms keep 0.55. */
export function restingRoomAlpha(input: { roomSelected: boolean; isSelected: boolean; subdued: boolean }): number {
  if (input.subdued) return SUBDUED_ROOM_ALPHA;
  return input.roomSelected && !input.isSelected ? DIM_ALPHA : 1;
}

/** The window of the selected room lights in 200 ms; the other rooms move to their resting opacity in 200 ms. */
export function playSelection(animator: Animator, input: { lit: Alpha | null; others: readonly { node: Alpha; from: number; to: number }[] }): void {
  const { lit, others } = input;
  if (lit !== null) {
    lit.alpha = 0;
    animator.tween({ duration: MOTION_MS.window, update: (p) => void (lit.alpha = easeOut(p)) });
  }
  if (others.length > 0) {
    for (const o of others) o.node.alpha = o.from;
    animator.tween({
      duration: MOTION_MS.dim,
      update: (p) => {
        for (const o of others) o.node.alpha = mix(o.from, o.to, easeOut(p));
      },
    });
  }
}

/** The door swings in 120 ms; then the corridor draws to its target in 350 ms. `swing` and `draw` receive progress from 0 to 1. */
export function playDoorOpen(animator: Animator, input: { swing: ((progress: number) => void) | null; draw: ((progress: number) => void) | null }): void {
  const { swing, draw } = input;
  const drawNow = (): void => {
    if (draw !== null) animator.tween({ duration: MOTION_MS.corridorDraw, update: (p) => draw(easeInOut(p)) });
  };
  if (swing === null) {
    draw?.(0);
    drawNow();
    return;
  }
  swing(0);
  animator.tween({ duration: MOTION_MS.doorSwing, update: (p) => swing(easeOut(p)), onDone: drawNow });
}

/**
 * A closed loop: its corridor fades over 600 ms (to the dashed ghost outline that the comparison draws), and the ghost that
 * walked it fades last, over 400 ms.
 */
export function playFarewell(animator: Animator, input: { corridor: Alpha; ghost: Alpha | null }): void {
  const { corridor, ghost } = input;
  corridor.alpha = 1;
  if (ghost !== null) ghost.alpha = 1;
  animator.tween({
    duration: MOTION_MS.removed,
    update: (p) => void (corridor.alpha = 1 - p),
    onDone: () => {
      corridor.alpha = 0;
      if (ghost === null) return;
      animator.tween({ duration: MOTION_MS.ghostFade, update: (p) => void (ghost.alpha = 1 - p), onDone: () => void (ghost.alpha = 0) });
    },
  });
}

/** Added doorways grow in 300 ms with one pulse; the lamps of changed rooms flicker on, three times in 400 ms. */
export function playCompareEntry(
  animator: Animator,
  input: { added: readonly { grow(scale: number): void; pulse(progress: number): void }[]; lamps: readonly ((on: number) => void)[] },
): void {
  const { added, lamps } = input;
  if (added.length > 0) {
    animator.tween({
      duration: MOTION_MS.added,
      update: (p) => {
        for (const a of added) a.grow(mix(0.2, 1, easeOut(p)));
      },
    });
    animator.tween({
      duration: MOTION_MS.pulse,
      update: (p) => {
        for (const a of added) a.pulse(p);
      },
    });
  }
  if (lamps.length > 0) {
    for (const set of lamps) set(0);
    animator.tween({
      duration: MOTION_MS.lamp,
      update: (p) => {
        const on = flickerOn(p);
        for (const set of lamps) set(on);
      },
    });
  }
}

/** Zoom and Fit to view: progress 0 to 1 over 300 ms, eased out. */
export function playCameraEase(animator: Animator, update: (progress: number) => void, onDone?: () => void): void {
  animator.tween({ duration: MOTION_MS.camera, update: (p) => update(easeOut(p)), ...(onDone === undefined ? {} : { onDone }) });
}

/** The rooms of a manor fade in softly the first time it is drawn. */
export function playIntro(animator: Animator, layer: Alpha): void {
  layer.alpha = 0;
  animator.tween({ duration: MOTION_MS.intro, update: (p) => void (layer.alpha = easeOut(p)), onDone: () => void (layer.alpha = 1) });
}

/** Removed doors: the solid corridor fades out while its dashed ghost outline fades in, over 600 ms. */
export function playRemoved(animator: Animator, input: { outline: readonly Alpha[]; solid: Alpha | null }): void {
  const { outline, solid } = input;
  for (const o of outline) o.alpha = 0;
  if (solid !== null) solid.alpha = 1;
  animator.tween({
    duration: MOTION_MS.removed,
    update: (p) => {
      for (const o of outline) o.alpha = p;
      if (solid !== null) solid.alpha = 1 - p;
    },
  });
}