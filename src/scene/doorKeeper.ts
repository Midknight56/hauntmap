import type { Point } from "./layout/types";

// Doors that swing for something that walks past them (the ghost on a loop, the traveling light on a selected path). Pure, no PixiJS.
// A door is open only while the actor is at it or within one door width of it; it swings open in 120 ms and shuts in 300 ms once the
// actor is farther. The keeper reads positions and time steps only: it never touches the graph, the selection or the steps.

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
  /** The width of the door: the actor is near it when it is within this distance of the center. */
  w: number;
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
  /** 0 shut, 1 open. */
  swing(id: string): number;
  list(): DoorReading[];
}

export function createDoorKeeper(doors: readonly KeptDoor[]): DoorKeeper {
  const open = new Map<string, number>(doors.map((d) => [d.id, 0]));
  const nearNow = new Map<string, boolean>(doors.map((d) => [d.id, false]));
  const isNear = (d: KeptDoor, actor: Point | null): boolean => actor !== null && Math.hypot(actor.x - d.x, actor.y - d.y) <= d.w;
  const phaseOf = (id: string): DoorPhase => {
    const f = open.get(id) ?? 0;
    if (nearNow.get(id) === true) return f >= 1 ? "open" : "opening";
    return f <= 0 ? "closed" : "closing";
  };
  return {
    update(deltaMs, actor) {
      const dt = Math.max(0, deltaMs);
      for (const d of doors) {
        const near = isNear(d, actor);
        nearNow.set(d.id, near);
        const f = open.get(d.id) ?? 0;
        open.set(d.id, near ? Math.min(1, f + dt / DOOR_OPEN_MS) : Math.max(0, f - dt / DOOR_SHUT_MS));
      }
    },
    settle(actor) {
      for (const d of doors) {
        const near = isNear(d, actor);
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
    phase: phaseOf,
    swing: (id) => open.get(id) ?? 0,
    list: () => doors.map((d) => ({ relationId: d.id, x: d.x, y: d.y, w: d.w, state: phaseOf(d.id), swing: open.get(d.id) ?? 0 })),
  };
}
