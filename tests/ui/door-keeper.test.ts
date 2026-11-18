import { describe, expect, it } from "vitest";
import { createDoorKeeper, DOOR_OPEN_MS, DOOR_SHUT_MS } from "../../src/scene/doorKeeper";
import { createWalker, GHOST_PAUSE_MS, type Leg } from "../../src/scene/walk";

// Halloween detail pass, item 1: a door swings open when the ghost (or the traveling light) is at it or within one door width of it,
// and swings shut after it has gone. The keeper is pure: it works on a position and a time step.

const door = { id: "a", x: 100, y: 50, w: 16 };
const near = { x: 100, y: 50 };
const far = { x: 300, y: 50 };

describe("the door keeper", () => {
  it("starts closed and stays closed while nothing is near", () => {
    const keeper = createDoorKeeper([door]);
    expect(keeper.phase("a")).toBe("closed");
    keeper.update(1000, null);
    keeper.update(1000, far);
    expect(keeper.phase("a")).toBe("closed");
    expect(keeper.swing("a")).toBe(0);
  });

  it("opens in 120 ms once the actor is at the door, passing through opening", () => {
    const keeper = createDoorKeeper([door]);
    keeper.update(DOOR_OPEN_MS / 2, near);
    expect(keeper.phase("a")).toBe("opening");
    expect(keeper.swing("a")).toBeGreaterThan(0);
    expect(keeper.swing("a")).toBeLessThan(1);
    keeper.update(DOOR_OPEN_MS / 2, near);
    expect(keeper.phase("a")).toBe("open");
    expect(keeper.swing("a")).toBe(1);
  });

  it("opens when the actor is exactly one door width away, and not when it is farther", () => {
    const a = createDoorKeeper([door]);
    a.update(16, { x: 116, y: 50 });
    expect(a.phase("a")).toBe("opening");
    const b = createDoorKeeper([door]);
    b.update(16, { x: 116.5, y: 50 });
    expect(b.phase("a")).toBe("closed");
  });

  it("shuts in 300 ms after the actor has left, passing through closing", () => {
    const keeper = createDoorKeeper([door]);
    keeper.update(500, near);
    expect(keeper.phase("a")).toBe("open");
    keeper.update(DOOR_SHUT_MS / 2, far);
    expect(keeper.phase("a")).toBe("closing");
    expect(keeper.swing("a")).toBeGreaterThan(0);
    expect(keeper.swing("a")).toBeLessThan(1);
    keeper.update(DOOR_SHUT_MS / 2, far);
    expect(keeper.phase("a")).toBe("closed");
  });

  it("starts to close at once when the actor leaves, and reopens from where it was", () => {
    const keeper = createDoorKeeper([door]);
    keeper.update(500, near);
    keeper.update(150, far);
    const half = keeper.swing("a");
    expect(half).toBeCloseTo(0.5, 5);
    keeper.update(DOOR_OPEN_MS / 2, near);
    expect(keeper.swing("a")).toBeCloseTo(1, 5);
  });

  it("settle puts every door where the actor puts it, at once", () => {
    const keeper = createDoorKeeper([door, { id: "b", x: 400, y: 50, w: 16 }]);
    keeper.settle(near);
    expect(keeper.phase("a")).toBe("open");
    expect(keeper.phase("b")).toBe("closed");
    keeper.settle(null);
    expect(keeper.phase("a")).toBe("closed");
  });

  it("with no actor every door shuts", () => {
    const keeper = createDoorKeeper([door]);
    keeper.update(500, near);
    keeper.update(400, null);
    expect(keeper.phase("a")).toBe("closed");
  });

  it("lists every door with its center, width, phase and swing", () => {
    const keeper = createDoorKeeper([door]);
    expect(keeper.list()).toEqual([{ relationId: "a", x: 100, y: 50, w: 16, state: "closed", swing: 0 }]);
  });
});

describe("a door against the ghost walking a loop", () => {
  const legs = (lengths: number[]): Leg[] => {
    // A square-ish loop: leg k runs from door k to door k + 1; the doors are the first points of the legs.
    const pts = [
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      { x: 300, y: 200 },
      { x: 0, y: 200 },
    ];
    return lengths.map((length, k) => ({ points: [pts[k] as { x: number; y: number }, pts[(k + 1) % 4] as { x: number; y: number }], length }));
  };

  it("is open only while the ghost is within one door width of it, and closed 300 ms after it is farther", () => {
    const loop = legs([300, 200, 300, 200]);
    const doors = loop.map((l, k) => ({ id: String(k), x: (l.points[0] as { x: number }).x, y: (l.points[0] as { y: number }).y, w: 16 }));
    const keeper = createDoorKeeper(doors);
    const walker = createWalker(loop, GHOST_PAUSE_MS);
    const farFor = new Map<string, number>(doors.map((d) => [d.id, Infinity]));
    let opened = 0;
    let closing = 0;
    for (let t = 0; t < 30_000; t += 16) {
      walker.advance(16, 60);
      keeper.update(16, walker.at);
      for (const d of doors) {
        const dist = Math.hypot(walker.at.x - d.x, walker.at.y - d.y);
        const phase = keeper.phase(d.id);
        if (dist > d.w) farFor.set(d.id, (farFor.get(d.id) as number) + 16);
        else farFor.set(d.id, 0);
        if (phase === "open" || phase === "opening") expect(dist, `door ${d.id} at ${t}`).toBeLessThanOrEqual(d.w + 1e-6);
        if (phase === "closed") expect(dist, `door ${d.id} at ${t}`).toBeGreaterThan(d.w - 1e-6);
        if ((farFor.get(d.id) as number) > DOOR_SHUT_MS + 16) expect(phase, `door ${d.id} at ${t}`).toBe("closed");
        if (phase === "open") opened++;
        if (phase === "closing") closing++;
      }
    }
    expect(opened).toBeGreaterThan(20);
    expect(closing).toBeGreaterThan(10);
  });
});
