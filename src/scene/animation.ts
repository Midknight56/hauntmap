// Tweens with a count. Under reduced motion none is created: the end state is applied at once.
// The traveling light is not a tween (it loops and exists only while a route filter is active).

export interface TweenSpec {
  /** Milliseconds; zero or less applies the end state at once. */
  duration: number;
  /** Called with progress in (0, 1]; the last call has progress 1. */
  update(progress: number): void;
  onDone?(): void;
}

export interface Animator {
  tween(spec: TweenSpec): void;
  tick(deltaMs: number): void;
  setReduced(reduced: boolean): void;
  /** Complete every running tween now. */
  finishAll(): void;
  readonly activeTweens: number;
}

interface Running {
  spec: TweenSpec;
  elapsed: number;
}

export function createAnimator(opts: { reduced: boolean }): Animator {
  let reduced = opts.reduced;
  let running: Running[] = [];

  function finish(entry: Running): void {
    try {
      entry.spec.update(1);
      entry.spec.onDone?.();
    } catch (error) {
      // An effect on a node that a redraw has destroyed must not stop the ticker.
      console.error("A tween failed at its end.", error);
    }
  }

  return {
    tween(spec) {
      if (reduced || !(spec.duration > 0)) {
        spec.update(1);
        spec.onDone?.();
        return;
      }
      running.push({ spec, elapsed: 0 });
    },
    tick(deltaMs) {
      if (running.length === 0) return;
      const batch = running;
      running = [];
      const alive: Running[] = [];
      const done: Running[] = [];
      for (const entry of batch) {
        entry.elapsed += Math.max(0, deltaMs);
        if (entry.elapsed >= entry.spec.duration) done.push(entry);
        else {
          try {
            entry.spec.update(entry.elapsed / entry.spec.duration);
            alive.push(entry);
          } catch (error) {
            // A tween that fails is dropped, so that one broken effect never stops the ticker and the other tweens.
            console.error("A tween failed and was dropped.", error);
          }
        }
      }
      // A tween started inside a callback was pushed to `running`; keep it after the survivors.
      running = [...alive, ...running];
      for (const entry of done) finish(entry);
    },
    setReduced(value) {
      reduced = value;
      if (reduced) this.finishAll();
    },
    finishAll() {
      const batch = running;
      running = [];
      for (const entry of batch) finish(entry);
    },
    get activeTweens() {
      return running.length;
    },
  };
}