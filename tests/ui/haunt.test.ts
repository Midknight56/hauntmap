import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createHaunt, HAUNT, mulberry32, rollMix, type Haunt, type HauntPhase } from "../../src/scene/haunt";
import { createDoorKeeper } from "../../src/scene/doorKeeper";
import { createWalker, type Leg } from "../../src/scene/walk";

// The haunt pass: the ghost goes into the door of its loop, the door shakes, bats and cats come out, the ghost comes out again.
// The haunt is pure drawing state: a phase, a door, a few critters and puffs. Its random numbers come from a seedable generator that
// only the haunt reads.

const DOOR = { id: "door-a", x: 100, y: 50, w: 18, h: 18 };
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Run the haunt in steps of `step` ms until it ends or `limit` ms pass; returns what it showed at each step. */
function run(haunt: Haunt, step: number, limit: number): { t: number; phase: HauntPhase; read: ReturnType<Haunt["read"]> }[] {
  const out: { t: number; phase: HauntPhase; read: ReturnType<Haunt["read"]> }[] = [];
  for (let t = 0; t <= limit; t += step) {
    out.push({ t, phase: haunt.phase, read: haunt.read() });
    haunt.update(step);
  }
  return out;
}

describe("the seedable random", () => {
  it("gives the same numbers for the same seed, in [0, 1), and other numbers for another seed", () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    const c = mulberry32(8);
    const xs = Array.from({ length: 20 }, () => a());
    expect(Array.from({ length: 20 }, () => b())).toEqual(xs);
    expect(Array.from({ length: 20 }, () => c())).not.toEqual(xs);
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe("the mix of critters", () => {
  it("is 2 to 5 critters of the kinds bat and cat", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const mix = rollMix(mulberry32(seed));
      expect(mix.length).toBeGreaterThanOrEqual(2);
      expect(mix.length).toBeLessThanOrEqual(5);
      for (const kind of mix) expect(["bat", "cat"]).toContain(kind);
    }
  });

  it("varies: over many seeds every size from 2 to 5 and both kinds occur", () => {
    const sizes = new Set<number>();
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 120; seed++) {
      const mix = rollMix(mulberry32(seed));
      sizes.add(mix.length);
      for (const k of mix) kinds.add(k);
    }
    expect([...sizes].sort()).toEqual([2, 3, 4, 5]);
    expect([...kinds].sort()).toEqual(["bat", "cat"]);
  });

  it("differs between the two seeds the browser test uses (11 and 23), over the first four haunts", () => {
    const mixes = (seed: number): string[] => {
      const haunt = createHaunt({ seed, critterSlots: 5, puffSlots: 6 });
      const out: string[] = [];
      for (let i = 0; i < 4; i++) {
        haunt.start(DOOR);
        const seen: string[] = [];
        for (let t = 0; t < 4000; t += 16) {
          haunt.update(16);
          if (haunt.phase === "burst" && seen.length === 0) seen.push(...haunt.read().critters.map((c) => c.kind));
        }
        out.push(seen.join(","));
      }
      return out;
    };
    const a = mixes(11);
    const b = mixes(23);
    expect(a.every((m) => m !== "")).toBe(true);
    expect(a).not.toEqual(b);
    expect(a[0]).not.toBe(b[0]);
  });
});

describe("the phases of one haunt", () => {
  it("run enter, shake, burst, exit, none in this order, and each lasts what it should", () => {
    const haunt = createHaunt({ seed: 3, critterSlots: 5, puffSlots: 6 });
    expect(haunt.phase).toBe("none");
    haunt.start(DOOR);
    const steps = run(haunt, 10, 5000);
    const order: HauntPhase[] = [];
    const started = new Map<HauntPhase, number>();
    for (const s of steps) {
      if (order[order.length - 1] !== s.phase) {
        order.push(s.phase);
        started.set(s.phase, s.t);
      }
    }
    expect(order).toEqual(["enter", "shake", "burst", "exit", "none"]);
    const shake = (started.get("burst") as number) - (started.get("shake") as number);
    expect(shake, "the door shakes for 1 to 1.5 s").toBeGreaterThanOrEqual(1000 - 10);
    expect(shake).toBeLessThanOrEqual(1500 + 10);
    expect((started.get("shake") as number) - (started.get("enter") as number)).toBeCloseTo(HAUNT.enterMs, -1);
    expect(haunt.active).toBe(false);
  });

  it("names the door it is at while it runs and none afterwards", () => {
    const haunt = createHaunt({ seed: 3, critterSlots: 5, puffSlots: 6 });
    haunt.start(DOOR);
    for (const s of run(haunt, 10, 5000)) {
      if (s.phase === "none") expect(s.read.door).toBeNull();
      else expect(s.read.door).toBe("door-a");
    }
  });

  it("hides the ghost in shake and burst, shows it before it goes in and after it comes out", () => {
    const haunt = createHaunt({ seed: 4, critterSlots: 5, puffSlots: 6 });
    haunt.start(DOOR);
    const steps = run(haunt, 10, 5000);
    for (const s of steps) {
      if (s.phase === "shake" || s.phase === "burst") expect(s.read.ghostAlpha, `${s.phase} at ${s.t}`).toBe(0);
    }
    const enter = steps.filter((s) => s.phase === "enter");
    expect(enter[0]?.read.ghostAlpha).toBe(1);
    expect(enter[enter.length - 1]?.read.ghostAlpha).toBe(0);
    const exit = steps.filter((s) => s.phase === "exit");
    expect(exit[0]?.read.ghostAlpha).toBeLessThan(0.2);
    expect(steps.find((s) => s.phase === "none" && s.t > 1000)?.read.ghostAlpha).toBe(1);
  });

  it("asks for the door shut from the end of the swing in until the burst, open at the burst and the exit, free before and after", () => {
    const haunt = createHaunt({ seed: 4, critterSlots: 5, puffSlots: 6 });
    haunt.start(DOOR);
    const steps = run(haunt, 10, 5000);
    expect(steps[0]?.read.hold).toBeNull();
    for (const s of steps) {
      if (s.phase === "shake") expect(s.read.hold).toBe(false);
      if (s.phase === "burst" || s.phase === "exit") expect(s.read.hold).toBe(true);
      if (s.phase === "none") expect(s.read.hold).toBeNull();
    }
  });

  it("shakes the door by a few pixels in the shake only", () => {
    const haunt = createHaunt({ seed: 5, critterSlots: 5, puffSlots: 6 });
    haunt.start(DOOR);
    let widest = 0;
    for (const s of run(haunt, 8, 5000)) {
      const m = Math.max(Math.abs(s.read.shake.x), Math.abs(s.read.shake.y));
      if (s.phase === "shake") widest = Math.max(widest, m);
      else expect(m, `${s.phase} at ${s.t}`).toBe(0);
      expect(m).toBeLessThanOrEqual(3 + 1e-9);
    }
    expect(widest, "a visible rattle").toBeGreaterThan(1.5);
  });

  it("scales the shake with the zoom: the same pixels on the screen", () => {
    const haunt = createHaunt({ seed: 5, critterSlots: 5, puffSlots: 6 });
    haunt.setUnit(2);
    haunt.start(DOOR);
    let widest = 0;
    for (const s of run(haunt, 8, 5000)) widest = Math.max(widest, Math.abs(s.read.shake.x), Math.abs(s.read.shake.y));
    expect(widest).toBeGreaterThan(3);
    expect(widest).toBeLessThanOrEqual(6 + 1e-9);
  });

  it("puffs small dust at the foot of the door during the shake, at most 6 at a time", () => {
    const haunt = createHaunt({ seed: 6, critterSlots: 5, puffSlots: 6 });
    haunt.start(DOOR);
    let most = 0;
    let during = 0;
    for (const s of run(haunt, 16, 5000)) {
      most = Math.max(most, s.read.puffs.length);
      if (s.phase === "shake") during += s.read.puffs.length;
      for (const p of s.read.puffs) {
        expect(p.y, "at the foot of the door").toBeGreaterThan(DOOR.y);
        expect(Math.abs(p.x - DOOR.x)).toBeLessThanOrEqual(DOOR.w);
      }
    }
    expect(during).toBeGreaterThan(0);
    expect(most).toBeLessThanOrEqual(6);
    expect(createHaunt({ seed: 6, critterSlots: 5, puffSlots: 0 }).slots).toBe(5);
  });
});

describe("the critters", () => {
  const burst = (seed: number): { critters: ReturnType<Haunt["read"]>["critters"]; steps: ReturnType<typeof run> } => {
    const haunt = createHaunt({ seed, critterSlots: 5, puffSlots: 6 });
    haunt.start(DOOR);
    const steps = run(haunt, 16, 6000);
    const at = steps.find((s) => s.phase === "burst" && s.read.critters.length > 0);
    return { critters: at?.read.critters ?? [], steps };
  };

  it("2 to 5 appear at the burst, none before it, and all are gone within 3 s of it", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const { critters, steps } = burst(seed);
      expect(critters.length, `seed ${seed}`).toBeGreaterThanOrEqual(2);
      expect(critters.length).toBeLessThanOrEqual(5);
      for (const s of steps) {
        if (s.phase === "enter" || s.phase === "shake") expect(s.read.critters).toEqual([]);
        expect(s.read.critters.length).toBeLessThanOrEqual(5);
      }
      const startedAt = (steps.find((s) => s.phase === "burst") as { t: number }).t;
      const last = steps.filter((s) => s.read.critters.length > 0).pop() as { t: number };
      expect(last.t - startedAt, `seed ${seed}`).toBeLessThanOrEqual(3000);
      expect(last.t - startedAt, "they live a while").toBeGreaterThan(1200);
      expect(steps[steps.length - 1]?.read.critters).toEqual([]);
    }
  });

  it("bats fly out and up and fade away; cats run out along the floor away from the door and fade away", () => {
    let bats = 0;
    let cats = 0;
    for (let seed = 1; seed <= 25; seed++) {
      const { steps } = burst(seed);
      const first = new Map<number, { x: number; y: number }>();
      const last = new Map<number, { x: number; y: number; alpha: number }>();
      for (const s of steps) {
        for (const c of s.read.critters) {
          if (!first.has(c.id)) first.set(c.id, { x: c.x, y: c.y });
          last.set(c.id, { x: c.x, y: c.y, alpha: c.alpha });
          expect(c.alpha).toBeGreaterThanOrEqual(0);
          expect(c.alpha).toBeLessThanOrEqual(1);
        }
      }
      const kinds = new Map<number, string>();
      for (const s of steps) for (const c of s.read.critters) kinds.set(c.id, c.kind);
      for (const [id, a] of first) {
        const b = last.get(id) as { x: number; y: number; alpha: number };
        expect(b.alpha, "fading at the end").toBeLessThan(0.6);
        if (kinds.get(id) === "bat") {
          bats++;
          expect(b.y, "a bat goes up").toBeLessThan(a.y - 60);
        } else {
          cats++;
          expect(Math.abs(b.x - a.x), "a cat runs away from the door").toBeGreaterThan(60);
          expect(Math.abs(b.y - a.y), "along the floor").toBeLessThan(6);
          expect(a.y, "from the foot of the door").toBeGreaterThan(DOOR.y);
        }
      }
    }
    expect(bats).toBeGreaterThan(5);
    expect(cats).toBeGreaterThan(5);
  });

  it("about 14 to 20 screen px across, at the zoom it is drawn", () => {
    const { critters } = burst(2);
    for (const c of critters) {
      expect(Math.max(c.box.w, c.box.h)).toBeGreaterThanOrEqual(14);
      expect(Math.max(c.box.w, c.box.h)).toBeLessThanOrEqual(20);
    }
    const haunt = createHaunt({ seed: 2, critterSlots: 5, puffSlots: 6 });
    haunt.setUnit(2);
    haunt.start(DOOR);
    const at = run(haunt, 16, 6000).find((s) => s.read.critters.length > 0);
    for (const c of at?.read.critters ?? []) expect(Math.max(c.box.w, c.box.h)).toBeGreaterThanOrEqual(28);
  });

  it("never more than the slots it was given (the particle budget)", () => {
    const haunt = createHaunt({ seed: 9, critterSlots: 3, puffSlots: 2 });
    haunt.start(DOOR);
    for (const s of run(haunt, 16, 6000)) {
      expect(s.read.critters.length).toBeLessThanOrEqual(3);
      expect(s.read.puffs.length).toBeLessThanOrEqual(2);
    }
    expect(haunt.slots).toBe(5);
  });

  it("are the same for the same seed whatever the frame time is", () => {
    const mixAt = (step: number): string => {
      const haunt = createHaunt({ seed: 31, critterSlots: 5, puffSlots: 6 });
      haunt.start(DOOR);
      const kinds: string[] = [];
      let shakeMs = 0;
      for (let t = 0; t < 6000; t += step) {
        haunt.update(step);
        if (haunt.phase === "shake") shakeMs += step;
        if (haunt.phase === "burst" && kinds.length === 0) kinds.push(...haunt.read().critters.map((c) => c.kind));
      }
      return `${kinds.join(",")} ${Math.round(shakeMs / 100)}`;
    };
    expect(mixAt(16)).toBe(mixAt(33));
  });

  it("are hidden while they would cover a name or a plate, and shown again once clear", () => {
    const haunt = createHaunt({ seed: 2, critterSlots: 5, puffSlots: 6 });
    // One big label over everything the critters can reach.
    haunt.setLabels([{ x: -1000, y: -1000, w: 3000, h: 3000 }]);
    haunt.start(DOOR);
    let seen = 0;
    for (const s of run(haunt, 16, 6000)) {
      for (const c of [...s.read.critters, ...s.read.puffs]) {
        seen++;
        expect(c.visible).toBe(false);
      }
    }
    expect(seen).toBeGreaterThan(0);
    const clear = createHaunt({ seed: 2, critterSlots: 5, puffSlots: 6 });
    clear.setLabels([{ x: 5000, y: 5000, w: 10, h: 10 }]);
    clear.start(DOOR);
    const shown = run(clear, 16, 6000).flatMap((s) => [...s.read.critters, ...s.read.puffs]);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.every((c) => c.visible)).toBe(true);
  });

  it("the shake keeps the door off every label: it shrinks when a label is close", () => {
    const haunt = createHaunt({ seed: 5, critterSlots: 5, puffSlots: 6 });
    // The door box is x 91..109, y 41..59; a label whose edge is 1 unit from it.
    haunt.setLabels([{ x: 110, y: 30, w: 40, h: 40 }]);
    haunt.start(DOOR);
    for (const s of run(haunt, 8, 5000)) {
      const left = 91 + s.read.shake.x;
      const right = 109 + s.read.shake.x;
      expect(right, `at ${s.t}`).toBeLessThanOrEqual(110 + 1e-9);
      expect(left).toBeLessThan(right);
    }
  });
});

describe("the walker and the door keeper that the haunt asks", () => {
  const legs: Leg[] = [
    { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], length: 100, from: 0 },
    { points: [{ x: 100, y: 0 }, { x: 100, y: 100 }], length: 100, from: 1 },
  ];

  it("counts its arrivals at a door, and can end its pause at once", () => {
    const walker = createWalker(legs, 400);
    expect(walker.arrivals).toBe(0);
    walker.advance(400, 100);
    expect(walker.arrivals, "the first pause is a start, not an arrival").toBe(0);
    walker.advance(1000, 100);
    expect(walker.arrivals).toBe(1);
    expect(walker.pausing).toBe(true);
    expect(walker.leg).toBe(1);
    walker.endPause();
    walker.advance(100, 100);
    expect(walker.pausing).toBe(false);
    expect(walker.at.y).toBeGreaterThan(0);
  });

  it("holds a door shut or open whatever the actor does, and lets go with null", () => {
    const keeper = createDoorKeeper([{ id: "a", x: 0, y: 0, w: 16 }]);
    keeper.update(500, { x: 0, y: 0 });
    expect(keeper.phase("a")).toBe("open");
    keeper.hold("a", false);
    keeper.update(400, { x: 0, y: 0 });
    expect(keeper.phase("a")).toBe("closed");
    keeper.hold("a", true);
    keeper.update(10, { x: 500, y: 0 });
    expect(keeper.phase("a")).toBe("opening");
    keeper.update(500, { x: 500, y: 0 });
    expect(keeper.phase("a")).toBe("open");
    keeper.hold("a", null);
    keeper.update(500, { x: 500, y: 0 });
    expect(keeper.phase("a")).toBe("closed");
  });
});

describe("the random belongs to the haunt", () => {
  it("is read only by the haunt: no other file of the scene, the analysis or the features uses the generator", () => {
    const files = ["src/scene/haunt.ts", "src/scene/corridors.ts", "src/scene/adapter.ts"];
    for (const file of files) {
      const text = readFileSync(join(REPO, file), "utf8");
      if (file === "src/scene/haunt.ts") {
        expect(text).not.toMatch(/from "\.\.\/(analysis|contracts|features|components)/);
        expect(text).not.toMatch(/Math\.random/);
      } else {
        // The loop and the adapter pass a seed; they never draw a number from the generator themselves.
        expect(text).not.toMatch(/mulberry32\(/);
      }
    }
  });
});
