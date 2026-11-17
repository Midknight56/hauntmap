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