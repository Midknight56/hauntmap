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
}

export type HitKind = "door" | "sealed" | "grouped" | "room" | "wing";

export interface HitTarget {
  kind: HitKind;
  id: string;
  rect: Rect;
}

/** One drawn name or title as the camera shows it: `px` is its font size on screen in CSS pixels. */
export interface DebugLabel {
  kind: "wing" | "wing-note" | "room" | "note";
  id: string;
  text: string;
  px: number;
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
  /** The name of the active palette. */
  theme: string;
}

export interface SceneHandle {
  setLayout(layout: LayoutResult, transition: "animate" | "jump"): void;
  setStyleState(state: StyleState): void;
  setCamera(camera: Camera, transition: "animate" | "jump"): void;
  getCamera(): Camera;
  fit(padding: number): Camera;
  /** Centers on the target; zoom is `max(current, zoomFloor)`. */
  focusOn(target: { kind: HitKind; id: string }, zoomFloor: number): Camera;
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