import { describe, expect, it } from "vitest";
import { createAnimator } from "../../src/scene/animation";

describe("animator (11.5, 9.5)", () => {
  it("creates no tween under reduced motion and applies the end state at once", () => {
    const animator = createAnimator({ reduced: true });
    const seen: number[] = [];
    let done = 0;
    animator.tween({ duration: 300, update: (p) => seen.push(p), onDone: () => done++ });
    expect(animator.activeTweens).toBe(0);
    expect(seen).toEqual([1]);
    expect(done).toBe(1);
  });

  it("counts a running tween and returns to 0 after it completes", () => {
    const animator = createAnimator({ reduced: false });
    const seen: number[] = [];
    let done = 0;
    animator.tween({ duration: 300, update: (p) => seen.push(p), onDone: () => done++ });
    expect(animator.activeTweens).toBe(1);
    animator.tick(100);
    expect(animator.activeTweens).toBe(1);
    animator.tick(250);
    expect(animator.activeTweens).toBe(0);
    expect(seen.at(-1)).toBe(1);
    expect(done).toBe(1);
    animator.tick(1000);
    expect(done).toBe(1);
  });

  it("completes running tweens immediately when reduced motion is switched on", () => {
    const animator = createAnimator({ reduced: false });
    let done = 0;
    animator.tween({ duration: 600, update: () => undefined, onDone: () => done++ });
    animator.setReduced(true);
    expect(animator.activeTweens).toBe(0);
    expect(done).toBe(1);
  });

  it("treats a zero duration as immediate", () => {
    const animator = createAnimator({ reduced: false });
    animator.tween({ duration: 0, update: () => undefined });
    expect(animator.activeTweens).toBe(0);
  });

  it("a tween that starts another tween in onDone still ends at zero", () => {
    const animator = createAnimator({ reduced: false });
    animator.tween({ duration: 100, update: () => undefined, onDone: () => animator.tween({ duration: 100, update: () => undefined }) });
    animator.tick(100);
    expect(animator.activeTweens).toBe(1);
    animator.tick(100);
    expect(animator.activeTweens).toBe(0);
  });

  it("drops a tween that throws, in a step or at its end, and keeps the others and the count honest", () => {
    const error = console.error;
    console.error = () => undefined;
    try {
      const animator = createAnimator({ reduced: false });
      let fine = 0;
      animator.tween({ duration: 100, update: () => void (fine += 1) });
      animator.tween({
        duration: 100,
        update: () => {
          throw new Error("a destroyed node");
        },
      });
      animator.tween({
        duration: 50,
        update: (p) => {
          if (p === 1) throw new Error("a destroyed node at the end");
        },
      });
      animator.tick(25);
      expect(animator.activeTweens).toBe(2);
      animator.tick(30);
      expect(animator.activeTweens).toBe(1);
      animator.tick(100);
      expect(animator.activeTweens).toBe(0);
      expect(fine).toBeGreaterThan(1);
    } finally {
      console.error = error;
    }
  });
});