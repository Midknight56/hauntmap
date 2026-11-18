import { describe, expect, it } from "vitest";
import { createLoopLights, DIM_BRIGHTNESS, LIGHT_UP_MS } from "../../src/scene/loopLights";
import { createWalker, GHOST_PAUSE_MS, type Leg } from "../../src/scene/walk";

// Halloween detail pass, item 2: the rooms of a loop start each lap dim (45 percent), light up with a candle glow in 200 ms when the
// ghost reaches their door, stay lit for the rest of the lap, and go dim again at the start of the next one.

const ids = ["a", "b", "c"];
const brightnessOf = (lights: ReturnType<typeof createLoopLights>, id: string): number => (lights.rooms().find((r) => r.id === id) as { brightness: number }).brightness;
const litIds = (lights: ReturnType<typeof createLoopLights>): string[] =>
  lights
    .rooms()
    .filter((r) => r.lit)
    .map((r) => r.id)
    .sort();

describe("the lights of a loop", () => {
  it("dims every room to 45 percent before the ghost arrives", () => {
    const lights = createLoopLights(ids);
    expect(DIM_BRIGHTNESS).toBe(0.45);
    expect(litIds(lights)).toEqual([]);
    for (const id of ids) expect(brightnessOf(lights, id)).toBeCloseTo(0.45, 6);
  });

  it("lights the rooms from the first up to the one the ghost has reached, and no other", () => {
    const lights = createLoopLights(ids);
    lights.sync(0, 1);
    expect(litIds(lights)).toEqual(["a"]);
    lights.sync(1, 1);
    expect(litIds(lights)).toEqual(["a", "b"]);
    lights.sync(2, 1);
    expect(litIds(lights)).toEqual(["a", "b", "c"]);
  });

  it("brightens in 200 ms to full and keeps that", () => {
    const lights = createLoopLights(ids);
    lights.sync(0, 1);
    expect(brightnessOf(lights, "a")).toBeCloseTo(0.45, 6);
    lights.advance(LIGHT_UP_MS / 2);
    const half = brightnessOf(lights, "a");
    expect(half).toBeGreaterThan(0.5);
    expect(half).toBeLessThan(0.99);
    lights.advance(LIGHT_UP_MS / 2);
    expect(brightnessOf(lights, "a")).toBe(1);
    lights.advance(5000);
    expect(brightnessOf(lights, "a")).toBe(1);
    expect(brightnessOf(lights, "b")).toBeCloseTo(0.45, 6);
  });

  it("dims every room again at the start of the next lap", () => {
    const lights = createLoopLights(ids);
    lights.sync(2, 1);
    lights.advance(1000);
    expect(litIds(lights)).toEqual(["a", "b", "c"]);
    lights.sync(0, 2);
    expect(litIds(lights)).toEqual(["a"]);
    expect(brightnessOf(lights, "b")).toBeCloseTo(0.45, 6);
    expect(brightnessOf(lights, "c")).toBeCloseTo(0.45, 6);
    expect(lights.lap).toBe(2);
  });

  it("under reduced motion every room is lit at once and stays lit", () => {
    const lights = createLoopLights(ids);
    lights.still();
    expect(litIds(lights)).toEqual(["a", "b", "c"]);
    for (const id of ids) expect(brightnessOf(lights, id)).toBe(1);
    lights.advance(1000);
    expect(brightnessOf(lights, "a")).toBe(1);
  });

  it("follows the ghost walking a loop for three laps: exactly the rooms reached this lap are lit", () => {
    const legs: Leg[] = ids.map((_, k) => ({ points: [{ x: k * 100, y: 0 }, { x: k * 100 + 100, y: 0 }], length: 100 }));
    const walker = createWalker(legs, GHOST_PAUSE_MS);
    const lights = createLoopLights(ids);
    const laps = new Set<number>();
    for (let t = 0; t < 40_000; t += 16) {
      walker.advance(16, 60);
      lights.sync(walker.leg, walker.lap);
      lights.advance(16);
      expect(litIds(lights), `at ${t} ms, leg ${walker.leg}, lap ${walker.lap}`).toEqual(ids.slice(0, walker.leg + 1).sort());
      laps.add(walker.lap);
    }
    expect(laps.size).toBeGreaterThanOrEqual(3);
  });
});

describe("the walker counts laps", () => {
  it("starts at lap 1 and counts a lap each time it returns to its first door", () => {
    const legs: Leg[] = [0, 1, 2].map((k) => ({ points: [{ x: k * 60, y: 0 }, { x: k * 60 + 60, y: 0 }], length: 60 }));
    const walker = createWalker(legs, 0);
    expect(walker.lap).toBe(1);
    walker.advance(1000, 60);
    expect(walker.lap).toBe(1);
    expect(walker.leg).toBe(1);
    walker.advance(2000, 60);
    expect(walker.leg).toBe(0);
    expect(walker.lap).toBe(2);
  });
});
