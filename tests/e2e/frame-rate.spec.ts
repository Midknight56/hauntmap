import { expect, test, type Page } from "@playwright/test";
import { compareWithSample, waitForStatus, READY_MANOR_PAIR } from "../compare/e2e/helpers";
import { expandAllWings, openManor, sceneDebug, settled, storeAction } from "./helpers";

// Design pass 3, item 11: the frames per second of the map with the biggest demo graph (the manor with every wing open, its loop shown,
// then with the comparison on) and of the landing page, over 5 s, with motion on, in headless Chromium at 1920 x 1080. Headless
// Chromium draws with software rendering here (SwiftShader), so the figures say what this renderer does, not what a graphics card does.
// The figures are printed (and attached to the report); the floor below only catches a frame loop that has stopped or become heavy.
// The spec is the perf project of playwright.config.ts: it runs after the other projects, one test at a time.
test.describe.configure({ mode: "serial" });

const SECONDS = 5;
/** A floor for software rendering: the work per frame is a few dozen nodes, so far fewer frames than this means something heavy runs per frame. */
const FLOOR_FPS = 10;

/** Count the animation frames the page gets in 5 s. */
async function pageFps(page: Page): Promise<number> {
  return page.evaluate(
    (seconds) =>
      new Promise<number>((resolve) => {
        let frames = 0;
        const start = performance.now();
        const tick = (): void => {
          frames++;
          if (performance.now() - start >= seconds * 1000) resolve((frames * 1000) / (performance.now() - start));
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    SECONDS,
  );
}

async function renderer(page: Page): Promise<string> {
  return page.evaluate(() => {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl");
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    return gl === null || gl === undefined ? "no webgl" : info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
  });
}

test.describe("frame rate with motion on, 1920 x 1080", () => {
  test.use({ viewport: { width: 1920, height: 1080 } });
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
  });

  test("the map: the manor with every wing open and its loop shown, then with the comparison on", async ({ page }, info) => {
    test.setTimeout(120_000);
    await openManor(page);
    await expandAllWings(page);
    await settled(page);
    await storeAction(page, "chooseLoop", 0);
    await settled(page);
    await expect.poll(async () => (await sceneDebug(page)).activeTweens).toBe(0);
    const gpu = await renderer(page);

    const before = await sceneDebug(page);
    const loopFps = await pageFps(page);
    const during = await sceneDebug(page);
    const sceneLoop = ((during.frames - before.frames) * 1000) / (SECONDS * 1000);
    expect(during.textureCount, "no new texture per frame").toBe(before.textureCount);
    expect(during.textureCount).toBeLessThanOrEqual(24);

    await compareWithSample(page);
    await waitForStatus(page, READY_MANOR_PAIR);
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await sceneDebug(page)).activeTweens).toBe(0);
    const b2 = await sceneDebug(page);
    const compareFps = await pageFps(page);
    const d2 = await sceneDebug(page);
    const sceneCompare = ((d2.frames - b2.frames) * 1000) / (SECONDS * 1000);
    expect(d2.textureCount, "no new texture per frame").toBe(b2.textureCount);
    expect(d2.textureCount).toBeLessThanOrEqual(24);
    expect(d2.fx.lamps.length, "the comparison is on").toBe(2);

    const line = `FPS 1920x1080 map, manor all wings, loop shown: page ${loopFps.toFixed(1)}, scene ${sceneLoop.toFixed(1)}; compare on: page ${compareFps.toFixed(1)}, scene ${sceneCompare.toFixed(1)}; textures ${d2.textureCount}; renderer ${gpu}`;
    console.log(line);
    info.annotations.push({ type: "fps", description: line });
    expect(loopFps).toBeGreaterThan(FLOOR_FPS);
    expect(compareFps).toBeGreaterThan(FLOOR_FPS);
  });

  test("the landing page", async ({ page }, info) => {
    test.setTimeout(60_000);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "HauntMap" })).toBeVisible();
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const fps = await pageFps(page);
    const gpu = await renderer(page);
    const line = `FPS 1920x1080 landing: page ${fps.toFixed(1)}; renderer ${gpu}`;
    console.log(line);
    info.annotations.push({ type: "fps", description: line });
    expect(fps).toBeGreaterThan(FLOOR_FPS);
  });
});
