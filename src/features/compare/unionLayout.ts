import type { ImportRecord, Investigation, Preset } from "../../contracts/types";
import { PAD_TOP, PLATE_BAND, roomLabel } from "../../scene/layout/compute";
import { routeCorridors, routeDoors } from "../../scene/layout/routes";
import type {
  CorridorBox,
  DoorBox,
  GroupedRoomBox,
  LayoutRequest,
  LayoutResult,
  Point,
  Rect,
  RoomBox,
  SealedBox,
  WingBox,
} from "../../scene/layout/types";

// The union of two snapshots and the layout over it. `extendLayout` is pure and synchronous: every box
// of the current layout keeps its x, y, w and h, rooms are added only for modules of the newer snapshot
// (below their wing, never among the old rooms), and a wing that grew into the wing under it pushes that
// wing and its rooms down in one deterministic pass.

export type Membership = "both" | "before" | "after";

export interface UnionGraph {
  /** Sorted by ID. */
  modules: { id: string; wing: string; membership: Membership }[];
  /** Local relations in the preset on the side or sides where they exist, one per relation ID, sorted. */
  drawn: { relationId: string; from: string; to: string; membership: Membership }[];
  /** External, unresolved and unsupported relations the preset admits, one per relation ID, sorted. */
  boundaries: { relationId: string; from: string; membership: Membership }[];
}

/** The one question the union asks of the analysis: whether a record is in a preset. */
export interface PresetQuery {
  inPreset(record: ImportRecord, preset: Preset): boolean;
}

export interface DoorPlacement {
  (
    rooms: RoomBox[],
    relations: { relationId: string; from: string; to: string }[],
    boundaries: { relationId: string; from: string }[],
  ): { doors: DoorBox[]; sealed: SealedBox[] };
}

export interface ExtendOutcome {
  layout: LayoutResult;
  addedRoomIds: string[];
  droppedRoomIds: string[];
  movedRoomIds: string[];
}

/** The part of the view state the union builder reads. */
export interface BuilderState {
  preset: Preset;
  expandedWings: readonly string[];
  layout: { wings: readonly { wing: string; expanded: boolean; shownIds: readonly string[] }[] } | null;
}

const ROOM_W = 96;
const ROOM_H = 64;
const GAP = 16;
const PAD_X = 24;
const PAD_BOTTOM = 24;
const BOUNDS_PAD = 32;
const WING_CAP = 80;
const NEW_WING_W = 144;
const NEW_WING_H = 120;
const NEW_WING_GAP = 48;
const SLOT = ROOM_W + GAP;

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The wing of a module is its directory; a top-level file belongs to `(root)`. */
function wingOf(moduleId: string): string {
  const slash = moduleId.lastIndexOf("/");
  return slash < 0 ? "(root)" : moduleId.slice(0, slash);
}

function merge(a: boolean, b: boolean): Membership {
  return a && b ? "both" : a ? "before" : "after";
}

interface Side {
  ids: Set<string>;
  drawn: Map<string, ImportRecord>;
  boundaries: Map<string, ImportRecord>;
}

function sideOf(inv: Investigation, preset: Preset, api: PresetQuery): Side {
  const ids = new Set(inv.modules.map((m) => m.id));
  const drawn = new Map<string, ImportRecord>();
  const boundaries = new Map<string, ImportRecord>();
  for (const record of inv.imports) {
    if (!ids.has(record.from) || !api.inPreset(record, preset)) continue;
    if (record.resolution === "local") {
      if (record.to !== null && ids.has(record.to) && !drawn.has(record.relationId)) drawn.set(record.relationId, record);
    } else if (!boundaries.has(record.relationId)) {
      boundaries.set(record.relationId, record);
    }
  }
  return { ids, drawn, boundaries };
}

export function buildUnionGraph(before: Investigation, after: Investigation, preset: Preset, api: PresetQuery): UnionGraph {
  const a = sideOf(before, preset, api);
  const b = sideOf(after, preset, api);
  const moduleIds = [...new Set([...a.ids, ...b.ids])].sort(compareText);
  const drawnIds = [...new Set([...a.drawn.keys(), ...b.drawn.keys()])].sort(compareText);
  const boundaryIds = [...new Set([...a.boundaries.keys(), ...b.boundaries.keys()])].sort(compareText);
  return {
    modules: moduleIds.map((id) => ({ id, wing: wingOf(id), membership: merge(a.ids.has(id), b.ids.has(id)) })),
    drawn: drawnIds.map((relationId) => {
      const record = (a.drawn.get(relationId) ?? b.drawn.get(relationId)) as ImportRecord;
      return { relationId, from: record.from, to: record.to as string, membership: merge(a.drawn.has(relationId), b.drawn.has(relationId)) };
    }),
    boundaries: boundaryIds.map((relationId) => {
      const record = (a.boundaries.get(relationId) ?? b.boundaries.get(relationId)) as ImportRecord;
      return { relationId, from: record.from, membership: merge(a.boundaries.has(relationId), b.boundaries.has(relationId)) };
    }),
  };
}

function membersByWing(union: UnionGraph): Map<string, string[]> {
  const members = new Map<string, string[]>();
  for (const m of union.modules) {
    const list = members.get(m.wing);
    if (list === undefined) members.set(m.wing, [m.id]);
    else list.push(m.id);
  }
  return members;
}

/**
 * The layout request of the union. A wing in `keep` keeps its shown modules (removed ones dropped, added
 * ones appended while fewer than 80 are shown); any other expanded wing shows its 80 smallest modules.
 * There is no `bring` swap: the store's builder receives only the view state.
 */
export function buildUnionRequest(
  union: UnionGraph,
  expandedWings: readonly string[],
  keep: ReadonlyMap<string, readonly string[]>,
  preset: Preset,
  engine: "dagre" | "elk",
): LayoutRequest {
  const members = membersByWing(union);
  const expanded: LayoutRequest["expandedWings"] = [];
  for (const wing of [...expandedWings].sort(compareText)) {
    const all = members.get(wing);
    if (all === undefined) continue;
    const kept = keep.get(wing);
    let shown: string[];
    if (kept === undefined) {
      shown = all.slice(0, WING_CAP);
    } else {
      const present = new Set(all);
      shown = kept.filter((id) => present.has(id));
      const have = new Set(shown);
      for (const id of all) {
        if (shown.length >= WING_CAP) break;
        if (!have.has(id)) shown.push(id);
      }
    }
    expanded.push({ wing, shownIds: shown, hiddenCount: all.length - shown.length });
  }
  return {
    layoutVersion: 1,
    engine,
    modules: union.modules.map((m) => ({ id: m.id, wing: m.wing })),
    relations: union.drawn.map((r) => ({ relationId: r.relationId, from: r.from, to: r.to })),
    boundaries: union.boundaries.map((b) => ({ relationId: b.relationId, from: b.from })),
    expandedWings: expanded,
    preset,
    room: { w: 96, h: 64 },
  };
}

/** The key of a union layout: SHA-256 hex of the canonical JSON of the base key, the union and the engine. */
export function unionLayoutKey(
  base: string | null,
  request: LayoutRequest,
  engine: { name: string; version: string },
  sha256Hex: (text: string) => Promise<string>,
): Promise<string> {
  return sha256Hex(
    JSON.stringify({
      base,
      modules: request.modules.map((m) => m.id).sort(compareText),
      relations: request.relations.map((r) => r.relationId).sort(compareText),
      expandedWings: request.expandedWings.map((w) => w.wing).sort(compareText),
      preset: request.preset,
      engine,
    }),
  );
}

/** The builder the store calls for every layout request while a comparison is active; `null` when none is. */
export function unionRequestBuilder(
  read: () => { union: UnionGraph; engine: "dagre" | "elk" } | null,
): (state: BuilderState) => LayoutRequest | null {
  return (state) => {
    const active = read();
    if (active === null) return null;
    const keep = new Map<string, readonly string[]>();
    for (const wing of state.layout?.wings ?? []) if (wing.expanded) keep.set(wing.wing, wing.shownIds);
    return buildUnionRequest(active.union, state.expandedWings, keep, state.preset, active.engine);
  };
}

function centerOf(rect: Rect): Point {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

function clamp(point: Point, rect: Rect): Point {
  return { x: Math.min(Math.max(point.x, rect.x), rect.x + rect.w), y: Math.min(Math.max(point.y, rect.y), rect.y + rect.h) };
}

const overlapsX = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w;

export function extendLayout(
  current: LayoutResult,
  union: UnionGraph,
  request: LayoutRequest,
  place: DoorPlacement,
  layoutKey: string,
): ExtendOutcome {
  void request;
  const started = performance.now();
  const unionIds = new Set(union.modules.map((m) => m.id));
  const members = membersByWing(union);

  // 1. Copy, and drop rooms of modules that are in neither snapshot.
  const droppedRoomIds = current.rooms.filter((r) => !unionIds.has(r.id)).map((r) => r.id).sort(compareText);
  const wings: WingBox[] = current.wings
    .filter((w) => members.has(w.wing))
    .map((w) => ({ ...w, shownIds: w.shownIds.filter((id) => unionIds.has(id)) }));
  const wingNames = new Set(wings.map((w) => w.wing));
  const rooms: RoomBox[] = current.rooms.filter((r) => unionIds.has(r.id) && wingNames.has(r.wing)).map((r) => ({ ...r }));
  let grouped: GroupedRoomBox[] = current.grouped.filter((g) => wingNames.has(g.wing)).map((g) => ({ ...g }));
  const keptRoomIds = new Set(rooms.map((r) => r.id));
  const oldHeight = new Map(wings.map((w) => [w.wing, w.h] as const));
  const wingByName = new Map(wings.map((w) => [w.wing, w] as const));

  // New wings: any union wing the layout does not have, collapsed, to the right of the bounds.
  const maxRank = current.wings.reduce((n, w) => Math.max(n, w.rank), -1);
  const absent = [...members.keys()].filter((name) => !wingByName.has(name)).sort(compareText);
  absent.forEach((name, j) => {
    const box: WingBox = {
      wing: name,
      x: current.bounds.x + current.bounds.w + NEW_WING_GAP,
      y: current.bounds.y + BOUNDS_PAD + (NEW_WING_H + NEW_WING_GAP) * j,
      w: NEW_WING_W,
      h: NEW_WING_H,
      moduleCount: 0,
      expanded: false,
      rank: maxRank + 1 + j,
      shownIds: [],
      hiddenCount: 0,
    };
    wings.push(box);
    wingByName.set(name, box);
  });

  // 2. Rooms of modules only in the newer snapshot, in module-ID order.
  const roomsOfWing = new Map<string, RoomBox[]>();
  for (const room of rooms) {
    const list = roomsOfWing.get(room.wing);
    if (list === undefined) roomsOfWing.set(room.wing, [room]);
    else list.push(room);
  }
  const drawnIds = new Set(rooms.map((r) => r.id));
  const slots = new Map<string, { base: number; used: number }>();
  const addedRoomIds: string[] = [];

  /** The next free slot below the old rooms of a wing; the wing grows to hold its row. */
  function nextSlot(wing: WingBox): Point {
    let state = slots.get(wing.wing);
    if (state === undefined) {
      const boxes: Rect[] = [...(roomsOfWing.get(wing.wing) ?? []), ...grouped.filter((g) => g.wing === wing.wing)];
      const lowest = boxes.length === 0 ? wing.y + PAD_TOP - GAP : Math.max(...boxes.map((b) => b.y + b.h));
      state = { base: lowest + GAP, used: 0 };
      slots.set(wing.wing, state);
    }
    const perRow = Math.max(1, Math.floor((wing.w - 2 * PAD_X - ROOM_W) / SLOT) + 1);
    const row = Math.floor(state.used / perRow);
    const col = state.used % perRow;
    state.used += 1;
    const y = state.base + row * (ROOM_H + GAP);
    wing.h = Math.max(wing.h, y + ROOM_H + PAD_BOTTOM - wing.y);
    return { x: wing.x + PAD_X + col * SLOT, y };
  }

  for (const m of union.modules) {
    if (m.membership !== "after" || drawnIds.has(m.id)) continue;
    const wing = wingByName.get(m.wing) as WingBox;
    if (!wing.expanded) continue;
    const list = roomsOfWing.get(wing.wing) ?? [];
    if (list.length >= WING_CAP) continue;
    const at = nextSlot(wing);
    const room: RoomBox = { id: m.id, wing: wing.wing, x: at.x, y: at.y, w: ROOM_W, h: ROOM_H, label: roomLabel(m.id) };
    rooms.push(room);
    list.push(room);
    roomsOfWing.set(wing.wing, list);
    wing.shownIds.push(m.id);
    addedRoomIds.push(m.id);
  }

  // Counts, and the grouped room of every expanded wing that hides modules.
  for (const wing of wings) {
    const total = (members.get(wing.wing) ?? []).length;
    wing.moduleCount = total;
    wing.shownIds.sort(compareText);
    wing.hiddenCount = wing.expanded ? total - wing.shownIds.length : total;
    const existing = grouped.find((g) => g.wing === wing.wing);
    if (wing.expanded && wing.hiddenCount > 0) {
      const label = `+${wing.hiddenCount} more modules`;
      if (existing === undefined) {
        const at = nextSlot(wing);
        grouped.push({ wing: wing.wing, x: at.x, y: at.y, w: ROOM_W, h: ROOM_H, hiddenCount: wing.hiddenCount, label });
      } else {
        existing.hiddenCount = wing.hiddenCount;
        existing.label = label;
      }
    } else if (existing !== undefined) {
      grouped = grouped.filter((g) => g !== existing);
    }
  }

  // 3. One pass over the grown wings, in rank order: the wings under a grown wing move down by its growth.
  const grown = wings.filter((w) => oldHeight.has(w.wing) && w.h > (oldHeight.get(w.wing) as number)).sort((a, b) => a.rank - b.rank || compareText(a.wing, b.wing));
  const shift = new Map<string, number>();
  const at = (w: WingBox): number => w.y + (shift.get(w.wing) ?? 0);
  for (const g of grown) {
    const was = oldHeight.get(g.wing) as number;
    const growth = g.h - was;
    const originalBottom = at(g) + was;
    for (const other of wings) {
      if (other === g || at(other) < originalBottom || !overlapsX(other, g)) continue;
      shift.set(other.wing, (shift.get(other.wing) ?? 0) + growth);
    }
  }
  const movedRoomIds: string[] = [];
  for (const wing of wings) {
    const dy = shift.get(wing.wing) ?? 0;
    if (dy === 0) continue;
    wing.y += dy;
    for (const room of roomsOfWing.get(wing.wing) ?? []) {
      room.y += dy;
      if (keptRoomIds.has(room.id)) movedRoomIds.push(room.id);
    }
    for (const g of grouped) if (g.wing === wing.wing) g.y += dy;
  }

  // 4. Doors and sealed doorways over the union.
  const drawn = new Set(rooms.map((r) => r.id));
  const placed = place(
    rooms,
    union.drawn.filter((r) => drawn.has(r.from) && drawn.has(r.to)).map((r) => ({ relationId: r.relationId, from: r.from, to: r.to })),
    union.boundaries.filter((b) => drawn.has(b.from)).map((b) => ({ relationId: b.relationId, from: b.from })),
  );
  // The same routed passages as the fleet layout (item 6b of the theme pass): arrows go around rooms.
  const doors = routeDoors(placed.doors, { rooms, grouped, wings, plate: PLATE_BAND });
  const sealed = placed.sealed;

  // 5. One corridor per ordered wing pair, counting distinct union relation IDs.
  const wingOfModule = new Map(union.modules.map((m) => [m.id, m.wing] as const));
  const pairs = new Map<string, { from: string; to: string; count: number }>();
  for (const r of union.drawn) {
    const a = wingOfModule.get(r.from);
    const b = wingOfModule.get(r.to);
    if (a === undefined || b === undefined || a === b) continue;
    const key = JSON.stringify([a, b]);
    const known = pairs.get(key);
    if (known === undefined) pairs.set(key, { from: a, to: b, count: 1 });
    else known.count += 1;
  }
  const byName = new Map(wings.map((w) => [w.wing, w] as const));
  const lines: CorridorBox[] = routeCorridors(
    [...pairs.values()]
      .sort((x, y) => compareText(x.from, y.from) || compareText(x.to, y.to))
      .map((pair) => {
        const a = byName.get(pair.from) as WingBox;
        const b = byName.get(pair.to) as WingBox;
        return { fromWing: pair.from, toWing: pair.to, count: pair.count, path: [clamp(centerOf(b), a), clamp(centerOf(a), b)] };
      }),
    wings,
  );
  // A corridor whose path is unchanged keeps its count label where the fleet put it. A new or moved path gets no
  // `badge`, so the scene draws the label at the middle of the path: placing labels again would cost time that grows
  // with corridors times obstacles, and would move labels of corridors that did not change.
  const oldCorridors = new Map(current.corridors.map((c) => [JSON.stringify([c.fromWing, c.toWing]), c] as const));
  const corridors: CorridorBox[] = lines.map((line) => {
    const was = oldCorridors.get(JSON.stringify([line.fromWing, line.toWing]));
    return was?.badge !== undefined && JSON.stringify(was.path) === JSON.stringify(line.path) && JSON.stringify(was.route) === JSON.stringify(line.route) ? { ...line, badge: was.badge } : line;
  });

  // 6. Bounds, key, stats.
  let bounds: Rect = { x: 0, y: 0, w: 0, h: 0 };
  if (wings.length > 0) {
    const left = Math.min(...wings.map((w) => w.x)) - BOUNDS_PAD;
    const top = Math.min(...wings.map((w) => w.y)) - BOUNDS_PAD;
    const right = Math.max(...wings.map((w) => w.x + w.w)) + BOUNDS_PAD;
    const bottom = Math.max(...wings.map((w) => w.y + w.h)) + BOUNDS_PAD;
    bounds = { x: left, y: top, w: right - left, h: bottom - top };
  }
  const layout: LayoutResult = {
    layoutVersion: 1,
    layoutKey,
    engine: current.engine,
    wings,
    rooms,
    grouped,
    doors,
    sealed,
    corridors,
    bounds,
    stats: { ms: performance.now() - started, nodeCount: rooms.length + wings.length, edgeCount: doors.length },
  };
  return { layout, addedRoomIds: addedRoomIds.sort(compareText), droppedRoomIds, movedRoomIds: movedRoomIds.sort(compareText) };
}
