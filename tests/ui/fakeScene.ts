import type { Camera, LayoutResult } from "../../src/scene/layout/types";
import type { HitKind, HitTarget, SceneDebug, SceneHandle, StyleState } from "../../src/scene/types";

// A SceneHandle that records every call, for component tests that must not start WebGL.

export interface SceneCall {
  name: string;
  args: unknown[];
}

export interface FakeScene {
  handle: SceneHandle;
  calls: SceneCall[];
  /** The last argument of the last `setStyleState`, or null. */
  readonly lastStyleState: StyleState | null;
  readonly lastLayout: LayoutResult | null;
  /** Deliver an event to the handlers registered through `on`. */
  emit(event: "select", hit: HitTarget | null): void;
  emit(event: "camera", camera: Camera): void;
  emit(event: "contextlost" | "contextrestored" | "contextfailed"): void;
  destroyed: boolean;
}

export function createFakeScene(initial: Camera = { x: 0, y: 0, zoom: 1 }): FakeScene {
  const calls: SceneCall[] = [];
  const listeners = new Map<string, Set<(arg?: never) => void>>();
  let camera = initial;
  let styleState: StyleState | null = null;
  let layout: LayoutResult | null = null;
  const record = (name: string, ...args: unknown[]): void => {
    calls.push({ name, args });
  };
  const fake: FakeScene = {
    calls,
    destroyed: false,
    get lastStyleState() {
      return styleState;
    },
    get lastLayout() {
      return layout;
    },
    emit(event: string, arg?: unknown) {
      for (const cb of [...(listeners.get(event) ?? [])]) (cb as (a?: unknown) => void)(arg);
    },
    handle: {
      setLayout(next, transition) {
        record("setLayout", next, transition);
        layout = next;
      },
      setStyleState(state) {
        record("setStyleState", state);
        styleState = state;
      },
      setCamera(next, transition) {
        record("setCamera", next, transition);
        camera = next;
      },
      getCamera() {
        return camera;
      },
      fit(padding) {
        record("fit", padding);
        return camera;
      },
      focusOn(target: { kind: HitKind; id: string }, zoomFloor) {
        record("focusOn", target, zoomFloor);
        camera = { ...camera, zoom: Math.max(camera.zoom, zoomFloor) };
        return camera;
      },
      screenRectOf(target: { kind: HitKind; id: string }) {
        record("screenRectOf", target);
        return null;
      },
      hitTest(clientX, clientY) {
        record("hitTest", clientX, clientY);
        return null;
      },
      on: ((event: string, cb: (arg?: never) => void) => {
        record("on", event);
        const set = listeners.get(event) ?? new Set();
        set.add(cb);
        listeners.set(event, set);
        return () => {
          set.delete(cb);
        };
      }) as SceneHandle["on"],
      setReducedMotion(reduced) {
        record("setReducedMotion", reduced);
      },
      resize() {
        record("resize");
      },
      debug(): SceneDebug {
        if (fake.destroyed) throw new Error("Scene destroyed");
        return { textureCount: 0, visibleRooms: 0, tickerRunning: true, activeTweens: 0, drawnDoors: 0, particleCount: 0, frames: 0, labels: [], ghost: null, glow: false, glowAlpha: null, light: null, wingMarks: [], theme: "candlelit-manor", fx: { clock: 0, camera: { x: 0, y: 0, zoom: 1 }, motes: [], lamps: [], roomAlphas: {}, layerAlpha: 1, addedScales: [], farewell: null, removed: [], door: null, doors: [], loop: null, decor: [], doorPx: [], doorways: 0, doorBoxes: [], doorDraws: 0, cost: { fog: 0, bats: 0, spiders: 0, motes: 0, doors: 0, loopLights: 0, candles: 0, ghost: 0 }, haunts: [], hauntSeed: null } };
      },
      destroy() {
        record("destroy");
        fake.destroyed = true;
      },
    },
  } as FakeScene;
  return fake;
}