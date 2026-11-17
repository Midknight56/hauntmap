import type { RouteFilter, Selection } from "../features/investigation/selection";
import type { Camera, LayoutResult, Rect } from "./layout/types";

// Types of the scene handle. No PixiJS import, so tests and components can use them without WebGL.

export interface SceneOptions {
  container: HTMLElement;
  reducedMotion: boolean;
  /** Development builds only: `debug()` returns live counters. */
  debug: boolean;
  forceFailure?: boolean;
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