import { expect, test, type Page } from "@playwright/test";
import { compareWithSample, waitForStatus, READY_MANOR_PAIR } from "../compare/e2e/helpers";
import { openManor, sceneDebug, settled, shot, storeAction } from "./helpers";

// The eight screenshots of the design pass, written when HAUNTMAP_SHOTS=1 (`shot` writes nothing otherwise). Each is the screen of
// the matching picture in .design-ref/png: the landing page, the full map, a selected room with its evidence (a loop chosen), and the
// comparison of the two snapshots, at 1920 x 1080 and at 360 x 640. The assertions keep the case honest when no file is written.

const SIZES = [
  { name: "1920", width: 1920, height: 1080 },
  { name: "360", width: 360, height: 640 },
] as const;

async function still(page: Page): Promise<void> {
  await settled(page);
  await expect.poll(async () => (await sceneDebug(page)).activeTweens).toBe(0);
  // The fonts and the first frames of the scene are in place.
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(400);
}

for (const size of SIZES) {
  test.describe(`design screens at ${size.width} x ${size.height}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test("landing", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "HauntMap" })).toBeVisible();
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      await shot(page, `docs/acceptance/img/design-landing-${size.name}.png`);
    });

    test("map", async ({ page }) => {
      await openManor(page);
      await still(page);
      await expect(page.getByRole("region", { name: "Investigation steps" })).toBeVisible();
      await shot(page, `docs/acceptance/img/design-map-${size.name}.png`);
    });

    test("room", async ({ page }) => {
      await openManor(page);
      await still(page);
      await storeAction(page, "chooseLoop", 0);
      // The chosen step (both rooms, the door and the corridor) is framed clear of the zoom stack and the minimap (design pass 2, item 4).
      await still(page);
      await expect(page.getByRole("region", { name: "Evidence trail" })).toBeVisible();
      await shot(page, `docs/acceptance/img/design-room-${size.name}.png`);
    });

    test("compare", async ({ page }) => {
      await openManor(page);
      await still(page);
      if (size.name === "1920") await page.getByRole("button", { name: "Close panel" }).click();
      else await page.getByRole("button", { name: "More" }).click();
      await compareWithSample(page);
      await waitForStatus(page, READY_MANOR_PAIR);
      await page.keyboard.press("Escape");
      if (size.name === "360") await page.getByRole("button", { name: "More" }).click();
      await still(page);
      await expect(page.getByRole("region", { name: "Comparison summary" })).toBeVisible();
      await shot(page, `docs/acceptance/img/design-compare-${size.name}.png`);
    });
  });
}