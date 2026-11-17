import { placeBadges } from "./badges";
import { placeDoors } from "./doorsPlacement";
import { routeCorridors, routeDoors } from "./routes";
import type {
  CorridorBox,
  GroupedRoomBox,
  LayoutRequest,
  LayoutResult,
  Point,
  Rect,
  RoomBox,
  WingBox,
} from "./types";

// The layout algorithm. It is pure and synchronous, and it asks a `GraphRunner` (dagre in
// production) only for ranked positions of small graphs: the wing graph, and the rooms of each
// expanded wing. Everything else (sizes, padding, doors, corridors, bounds) is arithmetic here.

export interface GraphSpec {
  nodes: { id: string; width: number; height: number }[];
  edges: { from: string; to: string; weight: number }[];
  direction: "LR" | "TB";
  nodesep: number;
  ranksep: number;
}

export interface GraphPlacement {
  /** Node centers and the rank the engine gave each node. */
  nodes: Map<string, { x: number; y: number; rank: number }>;
}

export type GraphRunner = (spec: GraphSpec) => GraphPlacement;

const ROOM_W = 96;
const ROOM_H = 64;
const GAP = 16;
const PAD_X = 24;
/** Room of an expanded wing above its first row: the title plate (6 to 36 units from the wing's top edge) and a gap, so a title is never under a room. */
export const PAD_TOP = 56;
/** The plate and the strip around it, from the top edge of the wing; nothing but the title is drawn here. */
export const PLATE_BAND = 40;
const PAD_BOTTOM = 24;
const BOUNDS_PAD = 32;
const WING_NODESEP = 48;
const WING_RANKSEP = 96;
const LABEL_LIMIT = 18;

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The file name, clipped at 18 characters with an ellipsis. */
export function roomLabel(id: string): string {
  const name = id.slice(id.lastIndexOf("/") + 1);
  return name.length > LABEL_LIMIT ? `${name.slice(0, LABEL_LIMIT)}\u2026` : name;
}

interface Interior {
  width: number;
  height: number;
  /** Top-left of each shown room inside the interior. */
  rooms: Map<string, Point>;
  grouped: Point | null;
}

function gridInterior(ids: readonly string[], hidden: number): Interior {
  const cells = ids.length + (hidden > 0 ? 1 : 0);
  const cols = Math.max(1, Math.ceil(Math.sqrt(cells)));
  const rows = Math.max(1, Math.ceil(cells / cols));
  const at = (i: number): Point => ({ x: (i % cols) * (ROOM_W + GAP), y: Math.floor(i / cols) * (ROOM_H + GAP) });
  const rooms = new Map<string, Point>();
  ids.forEach((id, i) => rooms.set(id, at(i)));
  return {
    width: cols * ROOM_W + (cols - 1) * GAP,
    height: rows * ROOM_H + (rows - 1) * GAP,
    rooms,
    grouped: hidden > 0 ? at(ids.length) : null,
  };
}

function rankedInterior(
  ids: readonly string[],
  hidden: number,
  edges: { from: string; to: string; weight: number }[],
  runner: GraphRunner,
): Interior {
  const placed = runner({
    nodes: ids.map((id) => ({ id, width: ROOM_W, height: ROOM_H })),
    edges,
    direction: "TB",
    nodesep: GAP,
    ranksep: GAP,
  }).nodes;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  for (const id of ids) {
    const p = placed.get(id) as { x: number; y: number };
    minX = Math.min(minX, p.x - ROOM_W / 2);
    minY = Math.min(minY, p.y - ROOM_H / 2);
  }
  const rooms = new Map<string, Point>();
  let width = 0;
  let height = 0;
  for (const id of ids) {
    const p = placed.get(id) as { x: number; y: number };
    const x = Math.round(p.x - ROOM_W / 2 - minX);
    const y = Math.round(p.y - ROOM_H / 2 - minY);
    rooms.set(id, { x, y });
    width = Math.max(width, x + ROOM_W);
    height = Math.max(height, y + ROOM_H);
  }
  let grouped: Point | null = null;
  if (hidden > 0) {
    grouped = { x: 0, y: height + GAP };
    height += GAP + ROOM_H;
  }
  return { width, height, rooms, grouped };
}

function clamp(point: Point, rect: Rect): Point {
  return { x: Math.min(Math.max(point.x, rect.x), rect.x + rect.w), y: Math.min(Math.max(point.y, rect.y), rect.y + rect.h) };
}

function centerOf(rect: Rect): Point {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

export function computeLayout(
  req: LayoutRequest,
  runner: GraphRunner,
  engine: { name: "dagre" | "elk"; version: string },
  now: () => number,
): Omit<LayoutResult, "layoutKey"> {
  const started = now();

  // Sort every input so that the order of the request never reaches the engine.
  const modules = [...req.modules].sort((a, b) => compareText(a.id, b.id));
  const relations = [...req.relations].sort((a, b) => compareText(a.relationId, b.relationId));
  const boundaries = [...req.boundaries].sort((a, b) => compareText(a.relationId, b.relationId));
  const wingOfModule = new Map(modules.map((m) => [m.id, m.wing]));
  const members = new Map<string, string[]>();
  for (const m of modules) {
    const list = members.get(m.wing);
    if (list === undefined) members.set(m.wing, [m.id]);
    else list.push(m.id);
  }
  const wingNames = [...members.keys()].sort(compareText);
  const expansion = new Map<string, { shownIds: string[]; hiddenCount: number }>();
  for (const e of req.expandedWings) {
    if (!members.has(e.wing)) continue;
    expansion.set(e.wing, { shownIds: [...e.shownIds].sort(compareText), hiddenCount: e.hiddenCount });
  }

  // Each wing's interior: a ranked run when it has intra-wing relations, otherwise a grid.
  const interiors = new Map<string, Interior>();
  for (const wing of wingNames) {
    const exp = expansion.get(wing);
    if (exp === undefined) {
      interiors.set(wing, gridInterior(["\u0000cell"], 0));
      continue;
    }
    const shown = new Set(exp.shownIds);
    const weights = new Map<string, { from: string; to: string; weight: number }>();
    for (const r of relations) {
      if (r.from === r.to || !shown.has(r.from) || !shown.has(r.to)) continue;
      const key = JSON.stringify([r.from, r.to]);
      const known = weights.get(key);
      if (known === undefined) weights.set(key, { from: r.from, to: r.to, weight: 1 });
      else known.weight++;
    }
    const edges = [...weights.values()].sort((a, b) => compareText(a.from, b.from) || compareText(a.to, b.to));
    interiors.set(
      wing,
      edges.length > 0 ? rankedInterior(exp.shownIds, exp.hiddenCount, edges, runner) : gridInterior(exp.shownIds, exp.hiddenCount),
    );
  }

  // The wing graph, ranked left to right. Wing boxes are sized from their interiors.
  const size = new Map<string, { w: number; h: number }>();
  for (const wing of wingNames) {
    const interior = interiors.get(wing) as Interior;
    size.set(wing, { w: interior.width + 2 * PAD_X, h: interior.height + PAD_TOP + PAD_BOTTOM });
  }
  const pairCounts = new Map<string, { from: string; to: string; count: number }>();
  for (const r of relations) {
    const a = wingOfModule.get(r.from);
    const b = wingOfModule.get(r.to);
    if (a === undefined || b === undefined || a === b) continue;
    const key = JSON.stringify([a, b]);
    const known = pairCounts.get(key);
    if (known === undefined) pairCounts.set(key, { from: a, to: b, count: 1 });
    else known.count++;
  }
  const pairs = [...pairCounts.values()].sort((a, b) => compareText(a.from, b.from) || compareText(a.to, b.to));
  const placed = runner({
    nodes: wingNames.map((id) => ({ id, width: (size.get(id) as { w: number }).w, height: (size.get(id) as { h: number }).h })),
    edges: pairs.map((p) => ({ from: p.from, to: p.to, weight: p.count })),
    direction: "LR",
    nodesep: WING_NODESEP,
    ranksep: WING_RANKSEP,
  }).nodes;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  for (const wing of wingNames) {
    const p = placed.get(wing) as { x: number; y: number };
    const s = size.get(wing) as { w: number; h: number };
    minX = Math.min(minX, p.x - s.w / 2);
    minY = Math.min(minY, p.y - s.h / 2);
  }
  const denseRank = new Map<number, number>();
  [...new Set(wingNames.map((w) => (placed.get(w) as { rank: number }).rank))]
    .sort((a, b) => a - b)
    .forEach((rank, index) => denseRank.set(rank, index));

  const wings: WingBox[] = [];
  const rooms: RoomBox[] = [];
  const grouped: GroupedRoomBox[] = [];
  const roomRects = new Map<string, Rect>();
  for (const wing of wingNames) {
    const p = placed.get(wing) as { x: number; y: number; rank: number };
    const s = size.get(wing) as { w: number; h: number };
    const x = Math.round(p.x - s.w / 2 - minX);
    const y = Math.round(p.y - s.h / 2 - minY);
    const exp = expansion.get(wing);
    const all = members.get(wing) as string[];
    wings.push({
      wing,
      x,
      y,
      w: s.w,
      h: s.h,
      moduleCount: all.length,
      expanded: exp !== undefined,
      rank: denseRank.get(p.rank) as number,
      shownIds: exp === undefined ? [] : exp.shownIds,
      hiddenCount: exp === undefined ? all.length : exp.hiddenCount,
    });
    if (exp === undefined) continue;
    const interior = interiors.get(wing) as Interior;
    for (const id of exp.shownIds) {
      const at = interior.rooms.get(id) as Point;
      const rect = { x: x + PAD_X + at.x, y: y + PAD_TOP + at.y, w: ROOM_W, h: ROOM_H };
      rooms.push({ ...rect, id, wing, label: roomLabel(id) });
      roomRects.set(id, rect);
    }
    if (interior.grouped !== null) {
      grouped.push({
        x: x + PAD_X + interior.grouped.x,
        y: y + PAD_TOP + interior.grouped.y,
        w: ROOM_W,
        h: ROOM_H,
        wing,
        hiddenCount: exp.hiddenCount,
        label: `+${exp.hiddenCount} more modules`,
      });
    }
  }

  const placedDoors = placeDoors({ rooms: roomRects, relations, boundaries });
  const sealed = placedDoors.sealed;
  const doors = routeDoors(placedDoors.doors, { rooms, grouped, wings, plate: PLATE_BAND });

  const wingRects = new Map(wings.map((w) => [w.wing, w]));
  const lines: CorridorBox[] = routeCorridors(
    pairs.map((pair) => {
      const a = wingRects.get(pair.from) as WingBox;
      const b = wingRects.get(pair.to) as WingBox;
      return { fromWing: pair.from, toWing: pair.to, count: pair.count, path: [clamp(centerOf(b), a), clamp(centerOf(a), b)] };
    }),
    wings,
  );
  const badges = placeBadges(lines.map((l) => ({ path: l.route ?? l.path })), { rooms, grouped, doors, sealed, wings });
  const corridors: CorridorBox[] = lines.map((line, i) => ({ ...line, badge: badges[i] as Point }));

  let bounds: Rect = { x: 0, y: 0, w: 0, h: 0 };
  if (wings.length > 0) {
    const left = Math.min(...wings.map((w) => w.x)) - BOUNDS_PAD;
    const top = Math.min(...wings.map((w) => w.y)) - BOUNDS_PAD;
    const right = Math.max(...wings.map((w) => w.x + w.w)) + BOUNDS_PAD;
    const bottom = Math.max(...wings.map((w) => w.y + w.h)) + BOUNDS_PAD;
    bounds = { x: left, y: top, w: right - left, h: bottom - top };
  }

  return {
    layoutVersion: 1,
    engine,
    wings,
    rooms,
    grouped,
    doors,
    sealed,
    corridors,
    bounds,
    stats: { ms: now() - started, nodeCount: req.modules.length, edgeCount: req.relations.length },
  };
}
