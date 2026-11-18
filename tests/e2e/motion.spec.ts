import { expect, test, type Page } from "@playwright/test";
import { compareWithSample, waitForStatus, READY_MANOR_PAIR } from "../compare/e2e/helpers";
import { openManor, sceneDebug, settled, storeAction, withScene, type HookFx } from "./helpers";

// The motion of the design (README, "Motion") and the effects of the motion pass, measured in the dev build through the scene debug
// data. The numbers of each effect are also proved without a browser in tests/ui/motion.test.ts.

interface Sample {
  t: number;
  ghost: { leg: number; x: number; y: number } | null;
  tweens: number;
  particles: number;
  textures: number;
  fx: HookFx;
}

/** Start sampling the scene in the page on every animation frame (at most every 16 ms). */
async function startSampler(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __samples: unknown[]; __sampling: boolean; __hauntmap: { scene(): { debug(): Record<string, unknown> } | null } };
    w.__samples = [];
    w.__sampling = true;
    const tick = (): void => {
      if (!w.__sampling) return;
      const scene = w.__hauntmap.scene();
      if (scene !== null) {
        const d = scene.debug() as Record<string, unknown>;
        w.__samples.push({ t: (d['fx'] as { clock: number }).clock, ghost: d["ghost"], tweens: d["activeTweens"], particles: d["particleCount"], textures: d["textureCount"], fx: d["fx"] });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function stopSampler(page: Page): Promise<Sample[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __samples: unknown[]; __sampling: boolean };
    w.__sampling = false;
    return w.__samples as never;
  });
}

/** The phases of a haunt in milliseconds (`HAUNT` in src/scene/haunt.ts). */
const HAUNT_MS = { enter: 700, shakeMin: 1000, shakeMax: 1500, burst: 600, exit: 500 };

/** The sample indices of a haunt that was sampled whole (`findWholeHaunt`). */
interface WholeHaunt {
  stoodFrom: number;
  enter: number;
  shake: number;
  burst: number;
  exit: number;
  end: number;
  movesAgain: number;
}

/**
 * The first haunt in `samples` that was sampled from before it began to after the ghost walked on, or null: the last frame the ghost moved
 * before it (`stoodFrom`), the first frame of each phase (the frame before `enter` has no haunt), the first frame with no haunt after the exit
 * (`end`) and the first frame the ghost moved after it (`movesAgain`). Self-contained, because the page runs it from its source text too.
 */
function findWholeHaunt(samples: readonly unknown[]): WholeHaunt | null {
  type S = { t: number; ghost: { leg: number; x: number; y: number } | null; fx: { haunts: { phase: string }[] } };
  const list = samples as readonly S[];
  const phaseOf = (i: number): string => list[i]?.fx.haunts[0]?.phase ?? "none";
  const moved = (i: number): boolean => {
    const a = list[i - 1]?.ghost;
    const b = list[i]?.ghost;
    if (a === null || a === undefined || b === null || b === undefined) return false;
    return a.leg !== b.leg || Math.hypot(b.x - a.x, b.y - a.y) > 1e-6;
  };
  const next = (phase: string, from: number): number => {
    for (let i = from; i < list.length; i++) {
      const p = phaseOf(i);
      if (p === phase) return i;
      // A phase may only be followed by the next one; anything else is a haunt sampled in part.
      if (p !== phaseOf(from - 1)) return -1;
    }
    return -1;
  };
  for (let enter = 1; enter < list.length; enter++) {
    if (phaseOf(enter) !== "enter" || phaseOf(enter - 1) !== "none") continue;
    let stoodFrom = enter;
    while (stoodFrom > 1 && !moved(stoodFrom)) stoodFrom--;
    if (!moved(stoodFrom)) continue;
    const shake = next("shake", enter + 1);
    const burst = shake < 0 ? -1 : next("burst", shake + 1);
    const exit = burst < 0 ? -1 : next("exit", burst + 1);
    const end = exit < 0 ? -1 : next("none", exit + 1);
    if (end < 0) return null;
    let movesAgain = end;
    while (movesAgain < list.length && !moved(movesAgain)) movesAgain++;
    if (movesAgain >= list.length) return null;
    return { stoodFrom, enter, shake, burst, exit, end, movesAgain };
  }
  return null;
}

/** Open the manor on the page `/` plus `query` (a development build reads `hauntSeed` from it). */
async function openManorWith(page: Page, query: string): Promise<void> {
  await page.goto(`/${query}`);
  await page.getByRole("button", { name: "Explore the manor" }).click();
  await page.waitForFunction(() => performance.getEntriesByName("hauntmap:usable").length > 0);
}

async function still(page: Page): Promise<void> {
  await settled(page);
  await expect.poll(async () => (await sceneDebug(page)).activeTweens).toBe(0);
}

test.describe("with motion allowed", () => {
  test.use({ viewport: { width: 1280, height: 720 } });
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
  });

  test("1 the ghost walks 60 screen pixels per second at any zoom and stands about 400 ms at each door where no haunt runs", async ({ page }) => {
    test.setTimeout(60_000);
    // `?hauntSeed=off` (development build only) turns the haunts off for this page: a door pause is then the plain pause of the walker.
    await openManorWith(page, "?hauntSeed=off");
    expect((await sceneDebug(page)).fx.haunts, "no haunt runs on this page").toEqual([]);
    await still(page);
    const speeds: number[] = [];
    const pauses: number[] = [];
    for (const zoomFactor of [1, 2]) {
      if (zoomFactor === 2) {
        const camera = (await sceneDebug(page)).fx.camera;
        await storeAction(page, "setCamera", { x: camera.x, y: camera.y, zoom: camera.zoom * 2 });
        await still(page);
      }
      await startSampler(page);
      await page.waitForTimeout(6500);
      const samples = (await stopSampler(page)).filter((s) => s.ghost !== null);
      const moving: number[] = [];
      let still0: number | null = null;
      for (let i = 1; i < samples.length; i++) {
        const a = samples[i - 1] as Sample;
        const b = samples[i] as Sample;
        const dt = b.t - a.t;
        if (dt <= 0 || dt > 200 || (a.ghost as { leg: number }).leg !== (b.ghost as { leg: number }).leg) continue;
        const dist = Math.hypot((b.ghost as { x: number }).x - (a.ghost as { x: number }).x, (b.ghost as { y: number }).y - (a.ghost as { y: number }).y);
        if (dist > 1e-6) {
          moving.push(((dist * b.fx.camera.zoom) / dt) * 1000);
          if (still0 !== null) {
            pauses.push(b.t - still0);
            still0 = null;
          }
        } else if (still0 === null) still0 = a.t;
      }
      expect(moving.length, "the ghost moves").toBeGreaterThan(20);
      moving.sort((x, y) => x - y);
      speeds.push(moving[Math.floor(moving.length / 2)] as number);
    }
    for (const speed of speeds) expect(speed, `speed ${speeds.join(", ")}`).toBeGreaterThan(54);
    for (const speed of speeds) expect(speed, `speed ${speeds.join(", ")}`).toBeLessThan(66);
    // A pause is measured between the last frame of a walk and the first of the next one, so it is about 400 ms plus up to a frame or two.
    const plausible = pauses.filter((p) => p > 300 && p < 600);
    expect(plausible.length, `pauses ${pauses.map(Math.round).join(", ")}`).toBeGreaterThan(0);
  });

  test("1b a pause that holds a haunt lasts as long as its phases: enter, shake of 1 to 1.5 s, burst and exit", async ({ page }) => {
    test.setTimeout(90_000);
    await openManorWith(page, "?hauntSeed=11");
    await still(page);
    await startSampler(page);
    // The sampler starts wherever the ghost is, and under load that can be in the middle of a haunt, whose first phase would then look short.
    // So the test measures the first haunt that is sampled whole: the ghost walks, a frame with no haunt, then enter, shake, burst, exit, a
    // frame with no haunt again, and the ghost walks on. It waits until such a haunt is in the samples, with the same finder it measures with.
    await page.waitForFunction(
      ([source]) => {
        const find = new Function(`return (${source as string});`)() as (samples: unknown[]) => unknown;
        return find((window as unknown as { __samples: unknown[] }).__samples) !== null;
      },
      [findWholeHaunt.toString()] as const,
      { timeout: 70_000, polling: 250 },
    );
    const samples = await stopSampler(page);
    const found = findWholeHaunt(samples);
    expect(found, "a whole haunt is sampled").not.toBeNull();
    const { stoodFrom, enter, shake, burst, exit, end, movesAgain } = found as WholeHaunt;
    const time = (i: number): number => (samples[i] as Sample).t;
    // A phase is read between the first frame of it and the first frame of the next one, so it is exact to the frame before and the frame at the end.
    const frame = (i: number): number => time(i) - time(i - 1);
    const within = (name: string, measured: number, expected: number, ...bracket: number[]): void => {
      const tolerance = bracket.reduce((sum, i) => sum + frame(i), 0) + 1;
      expect(Math.abs(measured - expected), `${name}: ${Math.round(measured)} ms against ${Math.round(expected)} ms (tolerance ${Math.round(tolerance)})`).toBeLessThanOrEqual(tolerance);
    };
    within("enter", time(shake) - time(enter), HAUNT_MS.enter, enter, shake);
    within("burst", time(exit) - time(burst), HAUNT_MS.burst, burst, exit);
    within("exit", time(end) - time(exit), HAUNT_MS.exit, exit, end);
    const shakeMs = time(burst) - time(shake);
    const slack = frame(shake) + frame(burst);
    expect(shakeMs, `shake ${Math.round(shakeMs)} ms`).toBeGreaterThanOrEqual(HAUNT_MS.shakeMin - slack);
    expect(shakeMs, `shake ${Math.round(shakeMs)} ms`).toBeLessThanOrEqual(HAUNT_MS.shakeMax + slack);
    const phases = time(end) - time(enter);
    // The walker stands from its arrival (the last frame it moved) to its first step after the haunt (the first frame it moved again).
    const stood = time(movesAgain) - time(stoodFrom);
    // Exact to the frames that bracket the pause: the arrival frame, the haunt start and the first step after the haunt.
    const bracket = frame(stoodFrom + 1) + frame(enter) + frame(movesAgain);
    expect(stood, `the ghost stood ${Math.round(stood)} ms, the phases took ${Math.round(phases)} ms`).toBeGreaterThanOrEqual(phases - bracket);
    expect(stood, `the ghost stood ${Math.round(stood)} ms, the phases took ${Math.round(phases)} ms`).toBeLessThanOrEqual(phases + bracket);
    expect(phases).toBeGreaterThanOrEqual(HAUNT_MS.enter + HAUNT_MS.shakeMin + HAUNT_MS.burst + HAUNT_MS.exit - bracket);
    expect(phases).toBeLessThanOrEqual(HAUNT_MS.enter + HAUNT_MS.shakeMax + HAUNT_MS.burst + HAUNT_MS.exit + bracket);
  });

  test("3 and 7 Zoom in eases out and is done in 300 ms", async ({ page }) => {
    await openManor(page);
    await still(page);
    const before = (await sceneDebug(page)).fx.camera.zoom;
    await startSampler(page);
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.waitForTimeout(900);
    const samples = await stopSampler(page);
    const target = before * 1.25;
    const start = samples.find((s) => s.fx.camera.zoom > before + 1e-6) as Sample;
    expect(start, "the zoom starts").toBeDefined();
    const progress = (s: Sample): number => (s.fx.camera.zoom - before) / (target - before);
    const finished = samples.find((s) => progress(s) >= 0.999) as Sample;
    expect(finished, "the zoom ends at its target").toBeDefined();
    const duration = finished.t - start.t;
    expect(duration, `duration ${duration}`).toBeGreaterThan(200);
    expect(duration, `duration ${duration}`).toBeLessThan(420);
    const mid = samples.filter((s) => s.t - start.t >= 120 && s.t - start.t <= 160);
    expect(mid.length).toBeGreaterThan(0);
    for (const s of mid) expect(progress(s), "ease out is ahead of a straight line").toBeGreaterThan(0.7);
  });

  test("4 selecting a room dims the other rooms to 60 percent in 200 ms and Clear selection brings them back", async ({ page }) => {
    await openManor(page);
    await still(page);
    await startSampler(page);
    await storeAction(page, "select", { kind: "module", id: "src/orders/checkout.ts" }, { from: "dom" });
    await page.waitForTimeout(900);
    const samples = await stopSampler(page);
    const other = "src/orders/cart.ts";
    const series = samples.map((s) => s.fx.roomAlphas[other] as number).filter((a) => a !== undefined);
    expect(Math.min(...series)).toBeCloseTo(0.6, 2);
    expect(series.some((a) => a > 0.62 && a < 0.98), "the dimming is not a jump").toBe(true);
    const last = samples.at(-1) as Sample;
    expect(last.fx.roomAlphas["src/orders/checkout.ts"]).toBe(1);
    expect(last.tweens).toBe(0);
    await storeAction(page, "select", { kind: "none" }, { from: "dom" });
    await expect.poll(async () => (await sceneDebug(page)).fx.roomAlphas[other]).toBe(1);
  });

  test("5 opening a door swings it in 120 ms and then draws its corridor in 350 ms", async ({ page }) => {
    await openManor(page);
    await still(page);
    const relationId = await page.evaluate(() => {
      const s = (window as unknown as { __hauntmap: { store: { getState(): { layout: { doors: { relationId: string; from: string }[] } } } } }).__hauntmap.store.getState();
      return (s.layout.doors.find((d) => d.from === "src/orders/checkout.ts") as { relationId: string }).relationId;
    });
    await startSampler(page);
    await storeAction(page, "select", { kind: "relation", relationId }, { from: "dom" });
    await page.waitForTimeout(1200);
    const samples = (await stopSampler(page)).filter((s) => s.fx.door !== null);
    expect(samples.length).toBeGreaterThan(5);
    const swingDone = samples.find((s) => (s.fx.door as { swing: number }).swing >= 0.999) as Sample;
    const drawStart = samples.find((s) => (s.fx.door as { draw: number }).draw > 0.001) as Sample;
    const drawDone = samples.find((s) => (s.fx.door as { draw: number }).draw >= 0.999) as Sample;
    const first = samples[0] as Sample;
    expect(swingDone.t - first.t, "the swing takes about 120 ms").toBeLessThan(260);
    expect(drawStart.t, "the corridor is drawn after the swing").toBeGreaterThanOrEqual(swingDone.t - 20);
    const drawing = drawDone.t - drawStart.t;
    expect(drawing, `drawing ${drawing}`).toBeGreaterThan(250);
    expect(drawing, `drawing ${drawing}`).toBeLessThan(520);
  });

  test("8 faint dust motes drift inside the particle limit, the texture cache stays at 24 or fewer", async ({ page }) => {
    await openManor(page);
    await still(page);
    const a = await sceneDebug(page);
    await page.waitForTimeout(700);
    const b = await sceneDebug(page);
    expect(a.fx.motes.length).toBeGreaterThan(0);
    expect(a.fx.motes.length).toBeLessThanOrEqual(12);
    expect(a.particleCount).toBeLessThanOrEqual(40);
    expect(b.particleCount).toBeLessThanOrEqual(40);
    expect(JSON.stringify(b.fx.motes), "the motes drift").not.toEqual(JSON.stringify(a.fx.motes));
    expect(a.textureCount).toBeLessThanOrEqual(24);
    expect(b.textureCount).toBeLessThanOrEqual(24);
  });

  test("8 the rooms fade in softly on the first load of a manor", async ({ page }) => {
    await page.goto("/");
    await startSampler(page);
    await page.getByRole("button", { name: "Explore the manor" }).click();
    await page.waitForFunction(() => performance.getEntriesByName("hauntmap:usable").length > 0);
    await page.waitForTimeout(1500);
    const samples = await stopSampler(page);
    const alphas = samples.map((s) => s.fx.layerAlpha);
    expect(alphas.some((a) => a < 0.6), "the layer starts nearly dark").toBe(true);
    expect(alphas.at(-1)).toBe(1);
  });

  test("7 the panels slide in over 200 ms and the inspector fades in over 150 ms", async ({ page }) => {
    await openManor(page);
    await still(page);
    const animation = (selector: string): Promise<{ name: string; duration: string }> =>
      page.evaluate((s) => {
        const style = getComputedStyle(document.querySelector(s) as Element);
        return { name: style.animationName, duration: style.animationDuration };
      }, selector);
    for (const selector of [".steps-panel", ".legend"]) expect(await animation(selector), selector).toEqual({ name: "panel-slide", duration: "0.2s" });
    const before = await page.locator(".inspector").getAttribute("data-fade");
    await storeAction(page, "select", { kind: "module", id: "src/orders/checkout.ts" }, { from: "dom" });
    await expect.poll(() => page.locator(".inspector").getAttribute("data-fade")).not.toBe(before);
    const fade = await animation(".inspector");
    expect(fade.duration).toBe("0.15s");
    expect(fade.name).toMatch(/^inspector-fade-[ab]$/);
  });
  test("6 compare: the removed corridor fades over 600 ms, the ghost last over 400 ms, added doorways grow, the lamps flicker on", async ({ page }) => {
    test.setTimeout(60_000);
    await openManor(page);
    await still(page);
    await storeAction(page, "chooseLoop", 0);
    await still(page);
    await startSampler(page);
    await compareWithSample(page);
    await waitForStatus(page, READY_MANOR_PAIR);
    await page.waitForTimeout(1800);
    const samples = await stopSampler(page);

    const fade = samples.filter((s) => s.fx.farewell !== null);
    expect(fade.length, "a corridor fades").toBeGreaterThan(5);
    const startAt = (fade[0] as Sample).t;
    const corridorGone = fade.find((s) => (s.fx.farewell as { corridor: number }).corridor <= 0.01) as Sample;
    const ghostGone = fade.find((s) => (s.fx.farewell as { ghost: number }).ghost <= 0.01) as Sample;
    expect(corridorGone.t - startAt, `corridor ${corridorGone.t - startAt}`).toBeGreaterThan(450);
    expect(corridorGone.t - startAt, `corridor ${corridorGone.t - startAt}`).toBeLessThan(800);
    expect(ghostGone.t - corridorGone.t, "the ghost fades last").toBeGreaterThan(300);
    expect(ghostGone.t - corridorGone.t).toBeLessThan(560);
    for (const s of fade.filter((x) => x.t < corridorGone.t - 40)) expect((s.fx.farewell as { ghost: number }).ghost).toBe(1);

    const removed = samples.filter((s) => s.fx.removed.length > 0);
    expect(removed.length, "a removed door has its ghost outline").toBeGreaterThan(5);
    expect(Math.min(...removed.map((s) => (s.fx.removed[0] as { outline: number }).outline))).toBeLessThan(0.2);
    expect((removed.at(-1) as Sample).fx.removed[0]).toEqual({ outline: 1, solid: 0 });

    const grow = samples.filter((s) => s.fx.addedScales.length > 0).flatMap((s) => s.fx.addedScales);
    expect(grow.length).toBeGreaterThan(5);
    expect(Math.min(...grow)).toBeLessThan(0.6);
    expect(grow.at(-1)).toBe(1);

    const lamps = samples.filter((s) => s.fx.lamps.length === 2);
    expect(lamps.length).toBeGreaterThan(10);
    const firstLamps = lamps.slice(0, 30).map((s) => s.fx.lamps[0] as number);
    expect(Math.min(...firstLamps), "the lamp starts dark and flickers").toBeLessThan(0.1);
    expect(firstLamps.some((a) => a > 0.8)).toBe(true);
    const settled = lamps.slice(-10).map((s) => s.fx.lamps[0] as number);
    for (const a of settled) {
      expect(a).toBeGreaterThanOrEqual(0.85);
      expect(a).toBeLessThanOrEqual(1);
    }
    expect((await sceneDebug(page)).activeTweens).toBe(0);
  });
});

test("7 under reduced motion the panels and the inspector have no animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openManor(page);
  await still(page);
  await storeAction(page, "select", { kind: "module", id: "src/orders/checkout.ts" }, { from: "dom" });
  for (const selector of [".steps-panel", ".legend", ".inspector"]) {
    const name = await page.evaluate((s) => getComputedStyle(document.querySelector(s) as Element).animationName, selector);
    expect(name, selector).toBe("none");
  }
});
/** Everything on the map that can move, read once. */
async function movers(page: Page): Promise<unknown> {
  const d = await withScene(page, (scene) => {
    const x = scene.debug();
    return { ghost: x.ghost, glowAlpha: x.glowAlpha, light: x.light, tweens: x.activeTweens, particles: x.particleCount, motes: x.fx.motes, lamps: x.fx.lamps, camera: x.fx.camera, layerAlpha: x.fx.layerAlpha, rooms: x.fx.roomAlphas, farewell: x.fx.farewell, door: x.fx.door };
  });
  return d;
}

async function expectMapStands(page: Page): Promise<void> {
  const first = (await movers(page)) as { ghost: unknown; tweens: number; particles: number; motes: unknown[]; lamps: number[]; glowAlpha: number | null };
  expect(first.ghost, "the ghost is drawn").not.toBeNull();
  expect((first.ghost as { leg: number }).leg, "the ghost stands at its first door").toBe(0);
  expect(first.glowAlpha).toBe(1);
  expect(first.tweens).toBe(0);
  expect(first.particles).toBe(0);
  expect(first.motes).toEqual([]);
  await page.waitForTimeout(900);
  const second = await movers(page);
  expect(JSON.stringify(second)).toEqual(JSON.stringify(first));
  await page.waitForTimeout(900);
  expect(JSON.stringify(await movers(page))).toEqual(JSON.stringify(first));
}

test.describe("reduced motion stops every moving thing of the map", () => {
  test("with prefers-reduced-motion: the ghost, the glow, the light, the motes, the lamps and the camera stand still", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openManor(page);
    await still(page);
    await expectMapStands(page);
    await page.getByRole("button", { name: "Zoom in" }).click();
    await expect.poll(async () => (await sceneDebug(page)).fx.camera.zoom).toBeGreaterThan(0);
    // The zoom is applied in the same frame: the drawn camera is the target and no tween exists.
    expect((await sceneDebug(page)).activeTweens).toBe(0);
    await expectMapStands(page);
  });

  test("with the Motion toggle on Reduce the same things stand still, also after a comparison", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openManor(page);
    await still(page);
    await page.getByRole("button", { name: "Motion" }).click();
    await expect(page.getByRole("button", { name: "Motion" })).toHaveAttribute("aria-pressed", "true");
    await expectMapStands(page);
    await page.getByRole("button", { name: "Close panel" }).click();
    await compareWithSample(page);
    await waitForStatus(page, READY_MANOR_PAIR);
    await page.keyboard.press("Escape");
    const lamps = (await sceneDebug(page)).fx.lamps;
    expect(lamps.length).toBe(2);
    for (const a of lamps) expect(a).toBe(1);
    expect((await sceneDebug(page)).activeTweens).toBe(0);
    const a = JSON.stringify(await movers(page));
    await page.waitForTimeout(1200);
    expect(JSON.stringify(await movers(page))).toEqual(a);
  });
});
