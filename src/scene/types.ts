import type { RouteFilter, Selection } from "../features/investigation/selection";
import type { Camera, LayoutResult, Rect } from "./layout/types";

// Types of the scene handle. No PixiJS import, so tests and components can use them without WebGL.

export interface SceneOptions {
  container: HTMLElement;
  reducedMotion: boolean;
  /** Development builds only: `debug()` returns live counters. */
  debug: boolean;
  forceFailure?: boolean;
  /** Development builds fix the seed of the random of the haunts (drawing only); a release build draws a new one for each map. */
  hauntSeed?: number;
  /** Development builds can turn the haunts off for one page (`?hauntSeed=off`), so that a test sees the plain pause of the ghost at a door. */
  hauntsOff?: boolean;
}

export type SceneInitFailure = "init-failed" | "no-webgl" | "forced";

export type SceneInit = { ok: true; scene: SceneHandle } | { ok: false; reason: SceneInitFailure; message: string };

/** Comparison styling is applied by snapshot-comparison's scene module through the same call. */
export interface StyleState {
  selection: Selection;
  routeFilter: RouteFilter | null;
  comparison?: unknown;
  /**
   * The witness of every dependency loop of the investigation under the active preset. The scene shows them from the
   * start (ecto borders, a glowing corridor, a ghost) without a route filter and without a selection.
   */
  loops?: readonly AmbientLoop[];
}

export interface AmbientLoop {
  modules: readonly string[];
  relationIds: readonly string[];
}

export type HitKind = "door" | "sealed" | "grouped" | "room" | "wing";

export interface HitTarget {
  kind: HitKind;
  id: string;
  rect: Rect;
}

/** One drawn name or title as the camera shows it: `px` is its font size on screen in CSS pixels. */
export interface DebugLabel {
  kind: "wing" | "wing-note" | "room" | "note" | "step" | "glyph" | "count";
  id: string;
  text: string;
  px: number;
  /** Where the text is drawn, in client pixels (design pass 2: names are never cut by the edge of the map). */
  rect?: { x: number; y: number; width: number; height: number };
  /** The plate behind a name that is drawn on one, in client pixels. */
  plate?: { x: number; y: number; width: number; height: number };
}

/** One haunt as the debug data reports it; boxes are in client pixels, positions in scene units. */
export interface HauntDebug {
  phase: "none" | "enter" | "shake" | "burst" | "exit";
  door: string | null;
  ghostAlpha: number;
  shake: { x: number; y: number };
  critters: { id: number; kind: "bat" | "cat"; x: number; y: number; alpha: number; visible: boolean; rect: { x: number; y: number; width: number; height: number } }[];
  puffs: { x: number; y: number; r: number; alpha: number; visible: boolean; rect: { x: number; y: number; width: number; height: number } }[];
}

export interface SceneDebug {
  textureCount: number;
  visibleRooms: number;
  tickerRunning: boolean;
  activeTweens: number;
  drawnDoors: number;
  particleCount: number;
  frames: number;
  /** Every wing title, room name and note that is drawn and not culled. */
  labels: DebugLabel[];
  /** The ghost of a dependency loop (scene units, and the leg of the loop it is on); null when no loop is shown. */
  ghost: { leg: number; x: number; y: number } | null;
  /** True while the glow of a looping corridor is drawn. */
  glow: boolean;
  /** The opacity of that glow now: it breathes between 0.6 and 1, and stays at 1 under reduced motion; null without a loop. */
  glowAlpha: number | null;
  /** The traveling light on the selected door (scene units); null while it rests, and when no door is selected. */
  light: { x: number; y: number } | null;
  /** The doorways drawn on collapsed wings for a removed or an added relation of a comparison (item 9 of the design pass). */
  wingMarks: { wing: string; kind: "removed" | "added" }[];
  /** The name of the active palette. */
  theme: string;
  /** What the effects of the motion pass draw now: the camera as drawn, the motes, the lamps, the opacity of rooms and of the layer that holds them. */
  fx: {
    /** The time the scene has animated, in milliseconds (frame times, each at most 100 ms). */
    clock: number;
    camera: Camera;
    motes: { x: number; y: number }[];
    lamps: number[];
    roomAlphas: Record<string, number>;
    layerAlpha: number;
    addedScales: number[];
    farewell: { corridor: number; ghost: number } | null;
    removed: { outline: number; solid: number }[];
    door: { swing: number; draw: number } | null;
    /** The doors that swing for the ghost or the traveling light: the center and width in scene units, and the phase of the swing. */
    doors: { relationId: string; x: number; y: number; w: number; state: "closed" | "opening" | "open" | "closing"; swing: number }[];
    /** The rooms of the loop the ghost walks (lit or dim, with the brightness 0.4 to 1) and the lap it is on; null when no loop is shown. */
    loop: { lap: number; rooms: { id: string; lit: boolean; glow: number; brightness: number }[] } | null;
    /** The cobwebs, cracks, candles, fog, bats and spiders with their boxes in client pixels; `visible` is false while one rests, is culled or would cover a name. */
    /** The width on the screen, in pixels, of each swinging door leaf, and the number of dark doorways drawn behind them. */
    doorPx: number[];
    doorways: number;
    /** Every drawn door: its center and width in scene units, its box in client pixels, the width on the screen, how far its panel is open (0 shut, 1 open) and the width of the opening in pixels. */
    doorBoxes: { relationId: string; x: number; y: number; w: number; rect: { x: number; y: number; width: number; height: number }; widthPx: number; open: number; openingPx: number }[];
    /** How many times the frames and doorways of the doors were drawn again since the map was drawn: a camera step does, a swing never does. */
    doorDraws: number;
    /** The milliseconds per frame that the update of each effect takes (a running mean over the last frames); zero in the release build. */
    cost: Record<"fog" | "bats" | "spiders" | "motes" | "doors" | "loopLights" | "candles" | "ghost", number>;
    decor: { kind: "web" | "crack" | "candle" | "fog" | "bat" | "spider"; moving: boolean; visible: boolean; rect: { x: number; y: number; width: number; height: number } }[];
    /** The haunt of each loop the ghost walks: the phase, the door it is at, the opacity of the ghost, and what is on screen. Empty under reduced motion. */
    haunts: HauntDebug[];
    /** The seed of the random of the haunts; null in a release build. */
    hauntSeed: number | null;
  };
}

export interface SceneHandle {
  setLayout(layout: LayoutResult, transition: "animate" | "jump"): void;
  setStyleState(state: StyleState): void;
  setCamera(camera: Camera, transition: "animate" | "jump"): void;
  getCamera(): Camera;
  fit(padding: number): Camera;
  /** Centers on the target; zoom is `max(current, zoomFloor)`, or exactly `zoom` when it is given (a selected step framed whole). */
  focusOn(target: { kind: HitKind; id: string }, zoomFloor: number, zoom?: number): Camera;
  screenRectOf(target: { kind: HitKind; id: string }): DOMRect | null;
  hitTest(clientX: number, clientY: number): HitTarget | null;
  on(event: "select", cb: (hit: HitTarget | null) => void): () => void;
  on(event: "camera", cb: (camera: Camera) => void): () => void;
  /** `contextfailed` fires when no restore arrived within 5,000 ms (the caller shows the renderer banner). */
  on(event: "contextlost" | "contextrestored" | "contextfailed", cb: () => void): () => void;
  setReducedMotion(reduced: boolean): void;
  resize(): void;
  /** Throws `Scene destroyed` after `destroy()`. */
  debug(): SceneDebug;
  destroy(): void;
}