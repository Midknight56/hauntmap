import { expect, test, type Page } from "@playwright/test";
import { compareWithSample, waitForStatus, READY_MANOR_PAIR } from "../compare/e2e/helpers";
import { expandAllWings, openManor, sceneDebug, settled, storeAction } from "./helpers";

// Design pass 3, item 11: the frames per second of the map with the biggest demo graph (the manor with every wing open, its loop shown,
// then with the comparison on) and of the landing page, as the median of three runs of 5 s each, with motion on, in headless Chromium at 1920 x 1080. Headless
// Chromium draws with software rendering here (SwiftShader), so the figures say what this renderer does, not what a graphics card does.
// The figures are printed (and attached to the report). The halloween detail pass sets the floor at 55 frames per second for the page and for the scene, so that a frame loop that has become heavy fails here.
// The spec is the perf project of playwright.config.ts: it runs after the other projects, one test at a time.
test.describe.configure({ mode: "serial" });

const SECONDS = 5;
/** Each case runs this many times; the median of the runs is checked, so that one slow window (the machine is shared) does not decide. */
const RUNS = 3;
/** The floor of the halloween detail pass: 55 frames per second over 5 s, with the effects running, in software rendering. */
const FLOOR_FPS = 55;

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

/** The middle value of an odd number of runs. */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] as number;
}

interface Reading {
  page: number;
  scene: number;
  runs: string;
}

/** Run the 5 s window `RUNS` times and return the median of the page rate and of the scene rate (the frames the scene drew in the same windows). */
async function measure(page: Page): Promise<Reading> {
  const pages: number[] = [];
  const scenes: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const before = await sceneDebug(page);
    pages.push(await pageFps(page));
    const after = await sceneDebug(page);
    scenes.push(((after.frames - before.frames) * 1000) / (SECONDS * 1000));
  }
  return { page: median(pages), scene: median(scenes), runs: pages.map((p, i) => `${p.toFixed(1)}/${(scenes[i] as number).toFixed(1)}`).join(" ") };
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
    test.setTimeout(240_000);
    await openManor(page);
    await expandAllWings(page);
    await settled(page);
    await storeAction(page, "chooseLoop", 0);
    await settled(page);
    await expect.poll(async () => (await sceneDebug(page)).activeTweens).toBe(0);
    const gpu = await renderer(page);

    const before = await sceneDebug(page);
    const loop = await measure(page);
    const during = await sceneDebug(page);
    expect(during.textureCount, "no new texture per frame").toBe(before.textureCount);
    expect(during.textureCount).toBeLessThanOrEqual(24);
    expect(during.fx.loop, "the loop is shown, with its rooms lighting").not.toBeNull();
    expect(during.fx.decor.length, "the details are drawn").toBeGreaterThan(10);
    expect(during.particleCount, "inside the particle limit").toBeLessThanOrEqual(40);

    await compareWithSample(page);
    await waitForStatus(page, READY_MANOR_PAIR);
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await sceneDebug(page)).activeTweens).toBe(0);
    const b2 = await sceneDebug(page);
    const compare = await measure(page);
    const d2 = await sceneDebug(page);
    expect(d2.textureCount, "no new texture per frame").toBe(b2.textureCount);
    expect(d2.textureCount).toBeLessThanOrEqual(24);
    expect(d2.fx.lamps.length, "the comparison is on").toBe(2);

    const line = `FPS 1920x1080 map, manor all wings, loop shown: median of ${RUNS} x ${SECONDS} s, page ${loop.page.toFixed(1)}, scene ${loop.scene.toFixed(1)} (runs page/scene ${loop.runs}); compare on: page ${compare.page.toFixed(1)}, scene ${compare.scene.toFixed(1)} (runs ${compare.runs}); textures ${d2.textureCount}; renderer ${gpu}`;
    console.log(line);
    info.annotations.push({ type: "fps", description: line });
    expect(loop.page, "median page frames per second, map with the loop").toBeGreaterThanOrEqual(FLOOR_FPS);
    expect(loop.scene, "median scene frames per second, map with the loop").toBeGreaterThanOrEqual(FLOOR_FPS);
    expect(compare.page, "median page frames per second, map with the comparison").toBeGreaterThanOrEqual(FLOOR_FPS);
    expect(compare.scene, "median scene frames per second, map with the comparison").toBeGreaterThanOrEqual(FLOOR_FPS);
  });

  test("the landing page", async ({ page }, info) => {
    test.setTimeout(90_000);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "HauntMap" })).toBeVisible();
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const runs: number[] = [];
    for (let i = 0; i < RUNS; i++) runs.push(await pageFps(page));
    const fps = median(runs);
    const gpu = await renderer(page);
    const line = `FPS 1920x1080 landing: median of ${RUNS} x ${SECONDS} s, page ${fps.toFixed(1)} (runs ${runs.map((r) => r.toFixed(1)).join(" ")}); renderer ${gpu}`;
    console.log(line);
    info.annotations.push({ type: "fps", description: line });
    expect(fps, "median page frames per second, landing").toBeGreaterThanOrEqual(FLOOR_FPS);
  });
});
