import { expect, test, type Page } from "@playwright/test";
import { openManor, sceneDebug, settled, storeAction } from "./helpers";

// The scene counters of requirement 11.5, read through the development hook (the release build has none).

async function sample(page: Page, times: number): Promise<{ activeTweens: number; particleCount: number }[]> {
  const out: { activeTweens: number; particleCount: number }[] = [];
  for (let i = 0; i < times; i++) {
    const d = await sceneDebug(page);
    out.push({ activeTweens: d.activeTweens, particleCount: d.particleCount });
    await page.waitForTimeout(150);
  }
  return out;
}

async function revealLoop(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Dependency loops" }).click();
  await page.getByRole("list", { name: "Loops" }).getByRole("button").first().click();
}

test.describe("reduced motion, scene counters (dev build)", () => {
  test("11.5 with prefers-reduced-motion emulated no tween and no particle exists at any sample", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openManor(page);
    await settled(page);
    await revealLoop(page);
    await storeAction(page, "expandWing", "src/payments");
    await storeAction(page, "setCamera", { x: 300, y: 200, zoom: 1.2 });
    await settled(page);
    const samples = await sample(page, 10);
    expect(samples.every((s) => s.activeTweens === 0 && s.particleCount === 0)).toBe(true);
    expect((await sceneDebug(page)).tickerRunning).toBe(true);
  });

  test("11.5 with the Motion toggle on Reduce no tween and no particle exists; with motion allowed the loop has particles", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openManor(page);
    await settled(page);
    await revealLoop(page);
    // Positive control: with motion allowed the route draws particles, so the zero below is a measurement.
    await expect.poll(async () => (await sceneDebug(page)).particleCount).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Motion" }).click();
    await expect(page.getByRole("button", { name: "Motion" })).toHaveAttribute("aria-pressed", "true");
    await storeAction(page, "expandWing", "src/payments");
    await settled(page);
    const samples = await sample(page, 10);
    expect(samples.every((s) => s.activeTweens === 0 && s.particleCount === 0)).toBe(true);
  });

  test("9.5 with motion allowed every tween completes and the count returns to 0", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openManor(page);
    await settled(page);
    await storeAction(page, "select", { kind: "module", id: "src/orders/checkout.ts" }, { from: "dom" });
    await expect.poll(async () => (await sceneDebug(page)).activeTweens, { timeout: 3000 }).toBe(0);
  });
});

// The motion of the design (README, "Motion"): the ghost walks the loop, the glow breathes, the traveling light runs the selected
// path. With reduced motion (the system setting or the Motion toggle) the ghost stands at its first door, the glow and the light stop,
// and fades are instant.

type Loop = { relationIds: string[] };

async function firstLoopRelation(page: Page): Promise<string> {
  return page.evaluate(() => {
    const s = (window as unknown as { __hauntmap: { store: { getState(): { panel: { kind: string; report: { components: { witness: { relationIds: string[] } }[] } | null } } } } }).__hauntmap.store.getState();
    if (s.panel.kind !== "loops" || s.panel.report === null) throw new Error("the loops panel is not open");
    return (s.panel.report.components[0] as { witness: Loop }).witness.relationIds[0] as string;
  });
}

/** The scene counters that must not change while nothing is asked of the map. */
async function stillness(page: Page, times: number): Promise<{ ghost: unknown; glowAlpha: number | null; light: unknown; tweens: number; particles: number }[]> {
  const out: { ghost: unknown; glowAlpha: number | null; light: unknown; tweens: number; particles: number }[] = [];
  for (let i = 0; i < times; i++) {
    const d = await sceneDebug(page);
    out.push({ ghost: d.ghost, glowAlpha: d.glowAlpha, light: d.light, tweens: d.activeTweens, particles: d.particleCount });
    await page.waitForTimeout(300);
  }
  return out;
}

async function expectStill(page: Page): Promise<void> {
  // The loop is shown from the start, with its ghost at the first door; a door is selected so that its light has something to run on.
  await expect.poll(async () => (await sceneDebug(page)).glow).toBe(true);
  const relationId = await firstLoopRelation(page);
  await storeAction(page, "select", { kind: "relation", relationId }, { from: "dom" });
  await settled(page);
  const samples = await stillness(page, 10);
  const first = samples[0] as (typeof samples)[number];
  expect(first.ghost, "the ghost is drawn").not.toBeNull();
  expect((first.ghost as { leg: number }).leg, "the ghost stands at its first door").toBe(0);
  expect(first.light, "the light is a static marker").not.toBeNull();
  // The haunt pass: no haunt, no shake and no critter under reduced motion; the ghost stays at its first door, seen.
  const haunted = (await sceneDebug(page)).fx.haunts;
  for (const h of haunted) {
    expect(h.phase, "no haunt").toBe("none");
    expect(h.door).toBeNull();
    expect(h.critters, "no critter").toEqual([]);
    expect(h.puffs, "no dust").toEqual([]);
    expect(h.shake).toEqual({ x: 0, y: 0 });
    expect(h.ghostAlpha, "the ghost is seen").toBe(1);
  }
  for (const s of samples) {
    expect(s.ghost).toEqual(first.ghost);
    expect(s.light).toEqual(first.light);
    expect(s.glowAlpha).toBe(1);
    expect(s.tweens).toBe(0);
    expect(s.particles).toBe(0);
  }
  // No door swings: a door is shown open while the ghost stands on it and shut otherwise, and the drawn panels do not change.
  const doors = (await sceneDebug(page)).fx.doorBoxes;
  const standing = (first.ghost as { x: number; y: number });
  expect(doors.length, "the doors are drawn").toBeGreaterThanOrEqual(10);
  for (const door of doors) {
    const onIt = Math.hypot(standing.x - door.x, standing.y - door.y) <= door.w;
    expect(door.open, `door ${door.relationId} is open while the ghost stands on it and shut otherwise`).toBe(onIt ? 1 : 0);
  }
  await page.waitForTimeout(600);
  expect((await sceneDebug(page)).fx.doorBoxes.map((d) => d.open), "the panels stay where they are").toEqual(doors.map((d) => d.open));
  // A change of the layout (a wing opens, a wing closes) is applied at once: no tween exists at any moment after it.
  await storeAction(page, "collapseWing", "src/payments");
  const right = await sceneDebug(page);
  expect(right.activeTweens).toBe(0);
  await settled(page);
  expect((await sceneDebug(page)).activeTweens).toBe(0);
}

test.describe("the motion of the design", () => {
  test("with prefers-reduced-motion the ghost stands at its first door, the glow and the traveling light stop, and fades are instant", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openManor(page);
    await settled(page);
    await expectStill(page);
  });

  test("with the Motion toggle on Reduce the ghost, the glow and the light stand still too", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openManor(page);
    await settled(page);
    await page.getByRole("button", { name: "Motion" }).click();
    await expect(page.getByRole("button", { name: "Motion" })).toHaveAttribute("aria-pressed", "true");
    await expectStill(page);
  });

  test("with motion allowed the ghost walks, the glow breathes between 60 and 100 percent, and the light runs 900 ms of every 2.5 s", async ({ page }) => {
    test.setTimeout(60_000);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openManor(page);
    await settled(page);
    const relationId = await firstLoopRelation(page);
    await storeAction(page, "select", { kind: "relation", relationId }, { from: "dom" });
    await settled(page);
    const glow: number[] = [];
    const ghosts = new Set<string>();
    let lit = 0;
    let dark = 0;
    const started = Date.now();
    while (Date.now() - started < 6000) {
      const d = await sceneDebug(page);
      if (d.glowAlpha !== null) glow.push(d.glowAlpha);
      ghosts.add(JSON.stringify(d.ghost));
      if (d.light === null) dark++;
      else lit++;
      await page.waitForTimeout(60);
    }
    expect(Math.min(...glow)).toBeLessThan(0.75);
    expect(Math.min(...glow)).toBeGreaterThanOrEqual(0.6 - 1e-6);
    expect(Math.max(...glow)).toBeGreaterThan(0.95);
    expect(Math.max(...glow)).toBeLessThanOrEqual(1 + 1e-6);
    expect(ghosts.size, "the ghost moves").toBeGreaterThan(5);
    expect(lit, "the light runs").toBeGreaterThan(0);
    expect(dark, "the light rests between two runs").toBeGreaterThan(lit);
  });
});
