import { expect, test, type Page } from "@playwright/test";
import { openManor, sceneDebug, settled, storeAction, type HookDoorBox, type HookFx } from "./helpers";

// The door pass, read through the scene debug data of the dev build:
//   1 at the first view (1920 x 1080) every door is 16 to 20 px wide and no door box covers a name, a name plate or a label,
//   2 the panel swings open as the ghost reaches the door, stays open while it stands there and swings shut after it has gone,
//     and at least half the door width of the opening shows when it is open,
//   3 the same for the traveling light on a selected path,
//   4 the frames are drawn once: a swing redraws nothing and creates no texture (24 at most).
// Headless Chromium here draws with software rendering (SwiftShader).

interface Sample {
  t: number;
  ghost: { x: number; y: number } | null;
  light: { x: number; y: number } | null;
  doors: HookDoorBox[];
  /** The doors that swing for the ghost or the light, with the distance within which each is open (`w` of the reading). */
  readings: HookFx["doors"];
  zoom: number;
  draws: number;
  textures: number;
  /** True while the ghost is inside a door (the haunt pass): it is not drawn, and the panel is shut on it or bursts open. */
  hidden: boolean;
}

/** Read the scene on animation frames, at most every 30 ms, for `ms` of wall time. */
async function sampleFor(page: Page, ms: number): Promise<Sample[]> {
  return page.evaluate(
    (duration) =>
      new Promise<Sample[]>((resolve) => {
        const hook = (window as unknown as { __hauntmap: { scene(): { debug(): Record<string, unknown> } | null } }).__hauntmap;
        const out: Sample[] = [];
        const start = performance.now();
        let lastRead = -Infinity;
        const tick = (): void => {
          const scene = hook.scene();
          if (scene !== null && performance.now() - lastRead >= 30) {
            lastRead = performance.now();
            const d = scene.debug() as { ghost: Sample["ghost"]; light: Sample["light"]; textureCount: number; fx: HookFx };
            out.push({ t: d.fx.clock, ghost: d.ghost, light: d.light, doors: d.fx.doorBoxes, readings: d.fx.doors, zoom: d.fx.camera.zoom, draws: d.fx.doorDraws, textures: d.textureCount, hidden: d.fx.haunts.some((h) => h.phase !== "none" && h.ghostAlpha === 0) });
          }
          if (performance.now() - start >= duration) resolve(out);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

/** The distance within which a door is open for the ghost or the light: its reach, a few door widths. */
const reachOf = (s: Sample, door: HookDoorBox): number => s.readings.find((r) => r.relationId === door.relationId)?.w ?? door.w;

function overlap(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
  return Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 0.5 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 0.5;
}

test.describe("the doors at the first view, 1920 x 1080", () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test("1 every door is 16 to 20 px wide on the screen and its panel and frame are drawn", async ({ page }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openManor(page);
    await settled(page);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.waitForTimeout(800);
    const d = await sceneDebug(page);
    console.log(`DOORS zoom ${d.fx.camera.zoom.toFixed(3)} doors ${d.fx.doorBoxes.length} widths ${[...new Set(d.fx.doorBoxes.map((b) => b.widthPx.toFixed(1)))].join(" ")}`);
    expect(d.fx.doorBoxes.length, "the manor has doors").toBeGreaterThanOrEqual(10);
    for (const door of d.fx.doorBoxes) {
      expect(door.widthPx, `door ${door.relationId} is 16 to 20 px wide`).toBeGreaterThanOrEqual(16);
      expect(door.widthPx, `door ${door.relationId} is 16 to 20 px wide`).toBeLessThanOrEqual(20);
      expect(door.rect.width, "the box on the screen agrees with the width").toBeCloseTo(door.widthPx, 0);
    }
  });

  test("1 no door box covers a room name, a name plate, a wing title or any other label", async ({ page }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openManor(page);
    await settled(page);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.waitForTimeout(800);
    const d = await sceneDebug(page);
    expect(d.labels.length, "names are drawn").toBeGreaterThan(5);
    const problems: string[] = [];
    for (const door of d.fx.doorBoxes) {
      for (const label of d.labels) {
        // A step number sits on the door it numbers, and the `?` on its sealed doorway; every other label keeps clear of a door.
        if (label.kind === "step" || label.kind === "glyph") continue;
        if (label.rect !== undefined && overlap(door.rect, label.rect)) problems.push(`door ${door.relationId} ${JSON.stringify(door.rect)} covers ${label.kind} "${label.text}" ${JSON.stringify(label.rect)}`);
        if (label.plate !== undefined && overlap(door.rect, label.plate)) problems.push(`door ${door.relationId} ${JSON.stringify(door.rect)} covers the plate of ${label.kind} "${label.text}" ${JSON.stringify(label.plate)}`);
      }
    }
    expect(problems).toEqual([]);
  });

  test("4 a swing draws the frames again never and creates no texture: at most 24 stay", async ({ page }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openManor(page);
    await settled(page);
    await page.waitForTimeout(800);
    const samples = await sampleFor(page, 4000);
    expect(samples.length).toBeGreaterThan(30);
    const first = samples[0] as Sample;
    expect(first.doors.length).toBeGreaterThanOrEqual(10);
    for (const s of samples) {
      expect(s.draws, "the frames and doorways are not drawn again while the doors swing").toBe(first.draws);
      expect(s.textures, "no new texture per frame").toBe(first.textures);
      expect(s.textures).toBeLessThanOrEqual(24);
    }
    // The positive control: something swung while nothing was drawn again.
    const swung = samples.some((s) => s.doors.some((b) => b.open > 0));
    expect(swung, "a panel moved during the reading").toBe(true);
  });

  test("2 the panel opens as the ghost reaches the door, stays open while it stands there and shuts after it has gone; half the door width of opening shows", async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openManor(page);
    await settled(page);
    await page.waitForTimeout(800);
    const samples = (await sampleFor(page, 20_000)).filter((s) => s.ghost !== null);
    expect(samples.length).toBeGreaterThan(100);
    let fullyOpenAtGhost = 0;
    let shutFar = 0;
    let sawPartial = false;
    const leftAt = new Map<string, number>();
    for (const s of samples) {
      const ghost = s.ghost as { x: number; y: number };
      for (const door of s.doors) {
        const distance = dist(ghost, door);
        if (door.open > 0.001 && door.open < 0.999) sawPartial = true;
        // The ghost is 28 px wide and a door 18 px: once the ghost is within 20 px of a door it covers it, and the door must be open by then
        // (it opens while the ghost is still 32 px away, so that the swing is seen and not hidden under the ghost).
        if (s.readings.some((r) => r.relationId === door.relationId)) {
          // The claim is about a ghost that is seen: while it is inside the door (the haunt pass) the panel is shut on it, and that is the haunt.
          if (!s.hidden && distance * s.zoom <= 20) expect(door.open, `door ${door.relationId} with the ghost ${(distance * s.zoom).toFixed(0)} px away at ${s.t}`).toBeGreaterThanOrEqual(0.999);
        }
        if (distance <= 2) {
          // The ghost stands on the door (it pauses there): the panel is fully open once the 120 ms of the swing have passed.
          const since = (s.t - (leftAt.get(`near ${door.relationId}`) ?? s.t));
          if (!leftAt.has(`near ${door.relationId}`)) leftAt.set(`near ${door.relationId}`, s.t);
          if (since >= 150 && !s.hidden) {
            expect(door.open, `door ${door.relationId} while the ghost stands on it`).toBeGreaterThanOrEqual(0.999);
            expect(door.openingPx, `the opening of door ${door.relationId} is half its width or more`).toBeGreaterThanOrEqual(door.widthPx / 2);
            fullyOpenAtGhost++;
          }
        } else {
          leftAt.delete(`near ${door.relationId}`);
        }
        if (door.open > 0.001) {
          expect(door.openingPx, `door ${door.relationId} at ${door.open}`).toBeGreaterThan(0);
          // An open panel belongs to a ghost that is at the door or has just left it.
          if (distance > reachOf(s, door) + 2) leftAt.set(`away ${door.relationId}`, leftAt.get(`away ${door.relationId}`) ?? s.t);
          else leftAt.delete(`away ${door.relationId}`);
          const away = leftAt.get(`away ${door.relationId}`);
          if (away !== undefined) expect(s.t - away, `door ${door.relationId} is still open ${s.t - away} ms after the ghost went`).toBeLessThan(300 + 2 * 100 + 40);
        } else {
          leftAt.delete(`away ${door.relationId}`);
          if (distance > 3 * reachOf(s, door)) shutFar++;
        }
      }
    }
    expect(fullyOpenAtGhost, "a panel was seen fully open with the ghost on it").toBeGreaterThanOrEqual(5);
    expect(shutFar, "doors far from the ghost are shut").toBeGreaterThan(100);
    expect(sawPartial, "the swing passes through the half-open positions").toBe(true);
  });

  test("3 on a selected path the door opens as the traveling light reaches it and shuts after it has gone", async ({ page }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openManor(page);
    await settled(page);
    const picked = await page.evaluate(() => {
      const hook = (window as unknown as { __hauntmap: { store: { getState(): { layout: { doors: { relationId: string; from: string; to: string }[] } } } } }).__hauntmap;
      return hook.store.getState().layout.doors.find((d) => !/receipt|checkout|charge/.test(d.from + d.to))?.relationId ?? null;
    });
    expect(picked).not.toBeNull();
    await storeAction(page, "select", { kind: "relation", relationId: picked }, { from: "dom" });
    await settled(page);
    const samples = await sampleFor(page, 7000);
    let opened = 0;
    let shut = 0;
    for (const s of samples) {
      const door = s.doors.find((b) => b.relationId === picked) as HookDoorBox;
      expect(door, "the selected door is drawn").toBeDefined();
      if (s.light === null) {
        if (door.open === 0) shut++;
      } else if (dist(s.light, door) <= 2 && door.open >= 0.999) {
        expect(door.openingPx).toBeGreaterThanOrEqual(door.widthPx / 2);
        opened++;
      }
      if (door.open >= 0.999 && s.light !== null) expect(dist(s.light, door), `light at ${s.t}`).toBeLessThanOrEqual(reachOf(s, door) + 2);
    }
    expect(opened, "the door is open with the light on it").toBeGreaterThan(0);
    expect(shut, "and shut while the light rests").toBeGreaterThan(0);
  });
});
