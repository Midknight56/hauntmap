import type { Point } from "./layout/types";

// Doors that swing for something that walks past them (the ghost on a loop, the traveling light on a selected path). Pure, no PixiJS.
// A door is open only while the actor is at it or within its reach of it (the ghost is wider than the door, so the reach is a few door
// widths: the door is open when the ghost arrives and shuts once the ghost has cleared it); it swings open in 120 ms and shuts in 300 ms once
// the actor is farther. The keeper reads positions and time steps only: it never touches the graph, the selection or the steps.

export type DoorPhase = "closed" | "opening" | "open" | "closing";

/** A door swings open in about this long once the actor is at it. */
export const DOOR_OPEN_MS = 120;
/** A door swings shut in about this long once the actor has left it. */
export const DOOR_SHUT_MS = 300;

export interface KeptDoor {
  id: string;
  /** The center of the door in scene units. */
  x: number;
  y: number;
  /** The reach of the door: the actor is near it when it is within this distance of the center. */
  w: number;
  /** The distance within which an actor that stands still opens the door at once (`settle`); the reach when absent. */
  stand?: number;
}

export interface DoorReading {
  relationId: string;
  x: number;
  y: number;
  w: number;
  state: DoorPhase;
  swing: number;
}

export interface DoorKeeper {
  /** Move on by `deltaMs` with the actor at `actor` (null when there is none: every door shuts). */
  update(deltaMs: number, actor: Point | null): void;
  /** Put every door where the actor puts it, at once (reduced motion). */
  settle(actor: Point | null): void;
  /** Put every door fully open or fully shut, at once. */
  setAll(open: boolean): void;
  phase(id: string): DoorPhase;
  /** Change the reach of every door (the zoom changed: the ghost keeps its size on the screen, so its reach in scene units follows). */
  setReach(units: number): void;
  /** Hold a door shut (false) or open (true) whatever the actor does; null lets the actor decide again (the haunt of a door shakes it shut). */
  hold(id: string, open: boolean | null): void;
  /** 0 shut, 1 open. */
  swing(id: string): number;
  list(): DoorReading[];
}

export function createDoorKeeper(doors: readonly KeptDoor[]): DoorKeeper {
  const open = new Map<string, number>(doors.map((d) => [d.id, 0]));
  const nearNow = new Map<string, boolean>(doors.map((d) => [d.id, false]));
  const reach = new Map<string, number>(doors.map((d) => [d.id, d.w]));
  const held = new Map<string, boolean>();
  const isNear = (d: KeptDoor, actor: Point | null, within: number): boolean => actor !== null && Math.hypot(actor.x - d.x, actor.y - d.y) <= within;
  const phaseOf = (id: string): DoorPhase => {
    const f = open.get(id) ?? 0;
    if (nearNow.get(id) === true) return f >= 1 ? "open" : "opening";
    return f <= 0 ? "closed" : "closing";
  };
  return {
    update(deltaMs, actor) {
      const dt = Math.max(0, deltaMs);
      for (const d of doors) {
        const near = held.get(d.id) ?? isNear(d, actor, reach.get(d.id) ?? d.w);
        nearNow.set(d.id, near);
        const f = open.get(d.id) ?? 0;
        open.set(d.id, near ? Math.min(1, f + dt / DOOR_OPEN_MS) : Math.max(0, f - dt / DOOR_SHUT_MS));
      }
    },
    settle(actor) {
      for (const d of doors) {
        const near = isNear(d, actor, d.stand ?? reach.get(d.id) ?? d.w);
        nearNow.set(d.id, near);
        open.set(d.id, near ? 1 : 0);
      }
    },
    setAll(value) {
      for (const d of doors) {
        nearNow.set(d.id, value);
        open.set(d.id, value ? 1 : 0);
      }
    },
    hold(id, open) {
      if (open === null) held.delete(id);
      else held.set(id, open);
    },
    setReach(units) {
      for (const d of doors) reach.set(d.id, units);
    },
    phase: phaseOf,
    swing: (id) => open.get(id) ?? 0,
    list: () => doors.map((d) => ({ relationId: d.id, x: d.x, y: d.y, w: reach.get(d.id) ?? d.w, state: phaseOf(d.id), swing: open.get(d.id) ?? 0 })),
  };
}
