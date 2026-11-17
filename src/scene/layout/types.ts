import type { Preset } from "../../contracts/types";

// Types only. The layout request and result cross the worker boundary, so they hold plain data.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

/** (x, y) is the scene-unit point at the viewport center; zoom is in [0.25, 4]. */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface LayoutRequest {
  layoutVersion: 1;
  engine: "dagre" | "elk";
  modules: { id: string; wing: string }[];
  /** Drawn local relations under the preset, one per relation ID. */
  relations: { relationId: string; from: string; to: string }[];
  /** Sealed doorways: boundary relations the preset admits. */
  boundaries: { relationId: string; from: string }[];
  expandedWings: { wing: string; shownIds: string[]; hiddenCount: number }[];
  preset: Preset;
  room: { w: 96; h: 64 };
}

export interface WingBox extends Rect {
  wing: string;
  moduleCount: number;
  expanded: boolean;
  rank: number;
  shownIds: string[];
  hiddenCount: number;
}

/** `label` is the file name clipped at 18 characters with an ellipsis. */
export interface RoomBox extends Rect {
  id: string;
  wing: string;
  label: string;
}

/** `label` reads `+40 more modules`. */
export interface GroupedRoomBox extends Rect {
  wing: string;
  hiddenCount: number;
  label: string;
}

export interface DoorBox extends Rect {
  relationId: string;
  from: string;
  to: string;
  side: "n" | "e" | "s" | "w";
  arrow: Point[];
  hit: Rect;
}

export interface SealedBox extends Rect {
  relationId: string;
  from: string;
  hit: Rect;
}

export interface CorridorBox {
  fromWing: string;
  toWing: string;
  count: number;
  path: Point[];
}

export interface LayoutResult {
  layoutVersion: 1;
  layoutKey: string;
  revisionEcho?: number;
  engine: { name: "dagre" | "elk"; version: string };
  wings: WingBox[];
  rooms: RoomBox[];
  grouped: GroupedRoomBox[];
  doors: DoorBox[];
  sealed: SealedBox[];
  corridors: CorridorBox[];
  bounds: Rect;
  stats: { ms: number; nodeCount: number; edgeCount: number };
}

/** Pure and synchronous; it runs in the worker. The key needs Web Crypto, so `layoutInvestigation` adds it. */
export interface LayoutEngine {
  readonly name: "dagre" | "elk";
  readonly version: string;
  /** `now` is the clock for `stats.ms`; tests pass a fixed one so that two runs are deep-equal. */
  layout(req: LayoutRequest, now?: () => number): Omit<LayoutResult, "layoutKey">;
}
