import { describe, expect, it } from "vitest";
import { createAnimator } from "../../src/scene/animation";
import {
  candleAlpha,
  easeInOut,
  easeOut,
  flickerOn,
  glowAlphaAt,
  MOTION_MS,
  playCameraEase,
  playCompareEntry,
  playDoorOpen,
  playFarewell,
  playIntro,
  playRemoved,
  playSelection,
  restingRoomAlpha,
} from "../../src/scene/effects";
import { bobOffsetPx, createWalker, GHOST_PAUSE_MS, GHOST_SPEED_PX_S, polylineLength, polylinePrefix, type Leg } from "../../src/scene/walk";

// The motion of the design (README, "Motion") as numbers: durations, easing, speeds. No PixiJS: the effects work on plain objects.

const leg = (length: number): Leg => ({ points: [{ x: 0, y: 0 }, { x: length, y: 0 }], length });

describe("easing", () => {
  it("both curves run from 0 to 1 and never go back", () => {
    for (const ease of [easeOut, easeInOut]) {
      expect(ease(0)).toBe(0);
      expect(ease(1)).toBe(1);
      let last = 0;
      for (let i = 1; i <= 100; i++) {
        const v = ease(i / 100);
        expect(v).toBeGreaterThanOrEqual(last);
        last = v;
      }
    }
  });
  it("ease out is ahead of a straight line at the middle and ease in and out is at one half", () => {
    expect(easeOut(0.5)).toBeGreaterThan(0.75);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 6);
  });
});

describe("the looping corridor glow (2.4 s, 60 to 100 percent)", () => {
  it("stays between 0.6 and 1, reaches both ends, and repeats every 2,400 ms", () => {
    let lo = 1;
    let hi = 0;
    for (let t = 0; t < 2400; t += 10) {
      const a = glowAlphaAt(t);
      lo = Math.min(lo, a);
      hi = Math.max(hi, a);
      expect(glowAlphaAt(t + 2400)).toBeCloseTo(a, 9);
    }
    expect(lo).toBeGreaterThanOrEqual(0.6 - 1e-9);
    expect(lo).toBeLessThan(0.61);
    expect(hi).toBeLessThanOrEqual(1 + 1e-9);
    expect(hi).toBeGreaterThan(0.99);
  });
});

describe("the ghost walks door to door", () => {
  it("walks 60 screen pixels per second at any zoom, and pauses 400 ms at each door", () => {
    expect(GHOST_SPEED_PX_S).toBe(60);
    expect(GHOST_PAUSE_MS).toBe(400);
    for (const zoom of [0.25, 0.5, 1, 2, 4]) {
      const w = createWalker([leg(1000), leg(1000)], GHOST_PAUSE_MS);
      const ups = GHOST_SPEED_PX_S / zoom;
      expect(w.at).toEqual({ x: 0, y: 0 });
      w.advance(399, ups);
      expect(w.at.x).toBe(0);
      expect(w.pausing).toBe(true);
      w.advance(1001, ups);
      // After 400 ms of pause and 1,000 ms of walking: 60 screen pixels, that is 60 / zoom units.
      expect(w.at.x * zoom).toBeCloseTo(60, 6);
      expect(w.leg).toBe(0);
    }
  });

  it("follows the zoom now: the same time at a different zoom covers the same screen distance", () => {
    const w = createWalker([leg(10_000)], GHOST_PAUSE_MS);
    w.advance(400, 60);
    w.advance(1000, 60);
    const first = w.at.x;
    w.advance(1000, 60 / 2);
    expect((w.at.x - first) * 2).toBeCloseTo(60, 6);
  });

  it("stands for 400 ms at each door in step order and starts again after the last door", () => {
    const w = createWalker([leg(60), leg(60), leg(60)], GHOST_PAUSE_MS);
    const legsSeen: number[] = [];
    let paused = 0;
    let pausedRuns: number[] = [];
    for (let t = 0; t < 3 * (400 + 1000) + 1500; t += 10) {
      w.advance(10, 60);
      if (legsSeen.at(-1) !== w.leg) legsSeen.push(w.leg);
      if (w.pausing) paused += 10;
      else if (paused > 0) {
        pausedRuns.push(paused);
        paused = 0;
      }
    }
    expect(legsSeen.slice(0, 5)).toEqual([0, 1, 2, 0, 1]);
    pausedRuns = pausedRuns.slice(0, 3);
    for (const run of pausedRuns) expect(Math.abs(run - 400)).toBeLessThanOrEqual(10);
  });

  it("does not stall on a leg of length zero", () => {
    const w = createWalker([leg(0), leg(60)], GHOST_PAUSE_MS);
    w.advance(100_000, 60);
    expect(Number.isFinite(w.at.x)).toBe(true);
  });

  it("bobs 3 pixels every 800 ms", () => {
    let lo = 0;
    let hi = 0;
    for (let t = 0; t < 800; t++) {
      const b = bobOffsetPx(t);
      lo = Math.min(lo, b);
      hi = Math.max(hi, b);
      expect(bobOffsetPx(t + 800)).toBeCloseTo(b, 9);
    }
    expect(hi - lo).toBeCloseTo(3, 1);
  });
});

describe("the lamp", () => {
  it("flickers on three times in 400 ms and ends lit", () => {
    expect(MOTION_MS.lamp).toBe(400);
    let rises = 0;
    let before = flickerOn(0);
    expect(before).toBe(0);
    for (let i = 1; i <= 400; i++) {
      const v = flickerOn(i / 400);
      if (v > before) rises++;
      before = v;
    }
    expect(rises).toBe(3);
    expect(flickerOn(1)).toBe(1);
  });

  it("burns with a soft flicker that stays between 0.85 and 1, and is steady under reduced motion", () => {
    let lo = 1;
    for (let t = 0; t < 5000; t += 7) {
      for (const seed of [0, 1, 2]) {
        const a = candleAlpha(t, seed, false);
        lo = Math.min(lo, a);
        expect(a).toBeLessThanOrEqual(1);
        expect(candleAlpha(t, seed, true)).toBe(1);
      }
    }
    expect(lo).toBeGreaterThanOrEqual(0.85);
    expect(lo).toBeLessThan(0.97);
  });
});

describe("selecting a room (200 ms window, 200 ms dimming)", () => {
  it("dims the other rooms to 0.6, keeps the subdued ones at 0.55, and leaves the selected room at 1", () => {
    expect(restingRoomAlpha({ roomSelected: true, isSelected: false, subdued: false })).toBe(0.6);
    expect(restingRoomAlpha({ roomSelected: true, isSelected: false, subdued: true })).toBe(0.55);
    expect(restingRoomAlpha({ roomSelected: true, isSelected: true, subdued: false })).toBe(1);
    expect(restingRoomAlpha({ roomSelected: false, isSelected: false, subdued: false })).toBe(1);
    expect(restingRoomAlpha({ roomSelected: false, isSelected: false, subdued: true })).toBe(0.55);
  });

  it("lights the window and dims the others over 200 ms, then no tween is left", () => {
    const animator = createAnimator({ reduced: false });
    const lit = { alpha: 0 };
    const other = { alpha: 1 };
    playSelection(animator, { lit, others: [{ node: other, from: 1, to: 0.6 }] });
    expect(animator.activeTweens).toBeGreaterThan(0);
    animator.tick(100);
    expect(lit.alpha).toBeGreaterThan(0);
    expect(lit.alpha).toBeLessThan(1);
    expect(other.alpha).toBeLessThan(1);
    expect(other.alpha).toBeGreaterThan(0.6);
    animator.tick(99);
    expect(animator.activeTweens).toBeGreaterThan(0);
    animator.tick(2);
    expect(animator.activeTweens).toBe(0);
    expect(lit.alpha).toBe(1);
    expect(other.alpha).toBeCloseTo(0.6, 9);
  });

  it("applies the end state at once under reduced motion", () => {
    const animator = createAnimator({ reduced: true });
    const lit = { alpha: 0 };
    const other = { alpha: 1 };
    playSelection(animator, { lit, others: [{ node: other, from: 1, to: 0.6 }] });
    expect(animator.activeTweens).toBe(0);
    expect(lit.alpha).toBe(1);
    expect(other.alpha).toBeCloseTo(0.6, 9);
  });
});

describe("opening a door (120 ms swing, 350 ms corridor)", () => {
  it("swings first and then draws the corridor to its target", () => {
    const animator = createAnimator({ reduced: false });
    const swing: number[] = [];
    const draw: number[] = [];
    playDoorOpen(animator, { swing: (v) => swing.push(v), draw: (v) => draw.push(v) });
    animator.tick(60);
    expect(swing.at(-1)).toBeGreaterThan(0);
    expect(swing.at(-1)).toBeLessThan(1);
    expect(draw).toEqual([]);
    animator.tick(61);
    expect(swing.at(-1)).toBe(1);
    animator.tick(175);
    expect(draw.at(-1)).toBeGreaterThan(0);
    expect(draw.at(-1)).toBeLessThan(1);
    animator.tick(100);
    expect(animator.activeTweens).toBe(1);
    animator.tick(100);
    expect(animator.activeTweens).toBe(0);
    expect(draw.at(-1)).toBe(1);
  });

  it("finishes at once under reduced motion", () => {
    const animator = createAnimator({ reduced: true });
    let s = 0;
    let d = 0;
    playDoorOpen(animator, { swing: (v) => void (s = v), draw: (v) => void (d = v) });
    expect([s, d, animator.activeTweens]).toEqual([1, 1, 0]);
  });
});

describe("comparing revisions", () => {
  it("fades the removed corridor to a ghost outline over 600 ms, then the ghost over 400 ms", () => {
    const animator = createAnimator({ reduced: false });
    const corridor = { alpha: 1 };
    const ghost = { alpha: 1 };
    playFarewell(animator, { corridor, ghost });
    animator.tick(300);
    expect(corridor.alpha).toBeGreaterThan(0);
    expect(corridor.alpha).toBeLessThan(1);
    expect(ghost.alpha).toBe(1);
    animator.tick(299);
    expect(ghost.alpha).toBe(1);
    animator.tick(2);
    expect(corridor.alpha).toBe(0);
    animator.tick(200);
    expect(ghost.alpha).toBeGreaterThan(0);
    expect(ghost.alpha).toBeLessThan(1);
    animator.tick(201);
    expect(ghost.alpha).toBe(0);
    expect(animator.activeTweens).toBe(0);
  });

  it("grows an added doorway in 300 ms with one pulse, and flickers the lamps three times in 400 ms", () => {
    const animator = createAnimator({ reduced: false });
    const grow: number[] = [];
    const pulse: number[] = [];
    const lamp: number[] = [];
    playCompareEntry(animator, { added: [{ grow: (v) => grow.push(v), pulse: (v) => pulse.push(v) }], lamps: [(v) => lamp.push(v)] });
    animator.tick(150);
    expect(grow.at(-1)).toBeGreaterThan(0.2);
    expect(grow.at(-1)).toBeLessThan(1);
    animator.tick(151);
    expect(grow.at(-1)).toBe(1);
    animator.tick(100);
    animator.tick(100);
    expect(lamp.at(-1)).toBe(1);
    expect(pulse.at(-1)).toBe(1);
    expect(animator.activeTweens).toBe(0);
    expect(new Set(lamp).size).toBeGreaterThan(1);
  });

  it("applies the final state at once under reduced motion", () => {
    const animator = createAnimator({ reduced: true });
    const corridor = { alpha: 1 };
    const ghost = { alpha: 1 };
    playFarewell(animator, { corridor, ghost });
    expect([corridor.alpha, ghost.alpha, animator.activeTweens]).toEqual([0, 0, 0]);
  });
});

describe("zoom, fit, first load", () => {
  it("eases the camera out in 300 ms", () => {
    expect(MOTION_MS.camera).toBe(300);
    const animator = createAnimator({ reduced: false });
    const seen: number[] = [];
    playCameraEase(animator, (p) => seen.push(p));
    animator.tick(150);
    expect(seen.at(-1)).toBeGreaterThan(0.75);
    animator.tick(149);
    expect(animator.activeTweens).toBe(1);
    animator.tick(2);
    expect(animator.activeTweens).toBe(0);
    expect(seen.at(-1)).toBe(1);
  });

  it("fades the rooms in softly on the first load and not at all under reduced motion", () => {
    const animator = createAnimator({ reduced: false });
    const layer = { alpha: 0 };
    playIntro(animator, layer);
    animator.tick(100);
    expect(layer.alpha).toBeGreaterThan(0);
    expect(layer.alpha).toBeLessThan(1);
    animator.tick(2000);
    expect(layer.alpha).toBe(1);
    const still = createAnimator({ reduced: true });
    const other = { alpha: 0 };
    playIntro(still, other);
    expect(other.alpha).toBe(1);
  });
});

describe("a corridor drawn to its target", () => {
  const path = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }];
  it("is a prefix of the path of the asked length", () => {
    expect(polylinePrefix(path, 0)).toEqual([{ x: 0, y: 0 }, { x: 0, y: 0 }]);
    const half = polylinePrefix(path, 75);
    expect(polylineLength(half)).toBeCloseTo(75, 9);
    expect(half.at(-1)).toEqual({ x: 75, y: 0 });
    const more = polylinePrefix(path, 125);
    expect(more.at(-1)).toEqual({ x: 100, y: 25 });
    expect(polylinePrefix(path, 1000)).toEqual(path);
  });
});
describe("removed doors", () => {
  it("cross fade from the solid corridor to the ghost outline over 600 ms", () => {
    const animator = createAnimator({ reduced: false });
    const outline = { alpha: 1 };
    const solid = { alpha: 0 };
    playRemoved(animator, { outline: [outline], solid });
    expect([outline.alpha, solid.alpha]).toEqual([0, 1]);
    animator.tick(300);
    expect(outline.alpha).toBeCloseTo(0.5, 6);
    expect(solid.alpha).toBeCloseTo(0.5, 6);
    animator.tick(299);
    expect(animator.activeTweens).toBe(1);
    animator.tick(2);
    expect(animator.activeTweens).toBe(0);
    expect([outline.alpha, solid.alpha]).toEqual([1, 0]);
  });
});