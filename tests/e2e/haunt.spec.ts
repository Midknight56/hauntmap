import { expect, test, type Page } from "@playwright/test";
import { expandAllWings, sceneDebug, settled, storeAction, type HookHaunt, type HookRect } from "./helpers";

// The haunt pass, read through the scene debug data of the dev build. When the ghost of a dependency loop reaches a door, it goes in,
// the panel shuts, the door shakes with a few puffs of dust, the panel bursts open and two to five bats and cats come out and fade, and
// the ghost comes out and goes on. What comes out is random, drawn from a seed that a development build fixes with `?hauntSeed=`.
// The random is drawing only: the map data, the analysis and the text of the page are the same for every seed.
// Headless Chromium here draws with software rendering (SwiftShader).

interface Frame {
  t: number;
  haunt: HookHaunt | null;
  ghost: { leg: number; x: number; y: number } | null;
  /** The box of the door the haunt is at, in client pixels. */
  door: { rect: HookRect; open: number } | null;
  /** The names, plates and numbers drawn now, in client pixels (only while a haunt is on). */
  labels: HookRect[];
  textures: number;
  particles: number;
}

/**
 * Sample the scene on every animation frame (at most every 30 ms) until the first haunt has ended and its critters are gone, or until
 * `maxMs` of wall time pass. `fx.clock` is the scene's own time, so a slow machine does not change a duration.
 */
async function watchFirstHaunt(page: Page, maxMs: number): Promise<Frame[]> {
  return page.evaluate(
    (limit) =>
      new Promise<Frame[]>((resolve) => {
        const hook = (window as unknown as { __hauntmap: { scene(): { debug(): Record<string, unknown> } | null } }).__hauntmap;
        const out: Frame[] = [];
        const start = performance.now();
        let last = -Infinity;
        let seenExit = false;
        const tick = (): void => {
          const scene = hook.scene();
          if (scene !== null && performance.now() - last >= 30) {
            last = performance.now();
            const d = scene.debug() as {
              ghost: Frame["ghost"];
              textureCount: number;
              particleCount: number;
              labels: { rect?: HookRect; plate?: HookRect }[];
              fx: { clock: number; haunts: HookHaunt[]; doorBoxes: { relationId: string; rect: HookRect; open: number }[] };
            };
            const haunt = d.fx.haunts.find((h) => h.phase !== "none") ?? d.fx.haunts[0] ?? null;
            const door = haunt !== null && haunt.door !== null ? (d.fx.doorBoxes.find((b) => b.relationId === haunt.door) ?? null) : null;
            const busy = haunt !== null && (haunt.phase !== "none" || haunt.critters.length > 0 || haunt.puffs.length > 0);
            const labels: HookRect[] = [];
            if (busy) for (const l of d.labels) for (const r of [l.rect, l.plate]) if (r !== undefined) labels.push(r);
            out.push({
              t: d.fx.clock,
              haunt: haunt === null ? null : JSON.parse(JSON.stringify(haunt)),
              ghost: d.ghost,
              door: door === null ? null : { rect: door.rect, open: door.open },
              labels,
              textures: d.textureCount,
              particles: d.particleCount,
            });
            if (haunt !== null && haunt.phase === "exit") seenExit = true;
            if (seenExit && haunt !== null && haunt.phase === "none" && haunt.critters.length === 0 && haunt.puffs.length === 0) return resolve(out);
          }
          if (performance.now() - start >= limit) resolve(out);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    maxMs,
  );
}

/** Open the manor with a fixed seed, show every wing so that the loop is whole, and zoom out a little so that the ghost reaches a door soon (the shake keeps off the names, so at a farther zoom, where the names crowd the doors, a door may not shake). */
async function openHaunted(page: Page, seed: number, zoom = 0.5): Promise<void> {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(`/?hauntSeed=${seed}`);
  await page.getByRole("button", { name: "Explore the manor" }).click();
  await page.waitForFunction(() => performance.getEntriesByName("hauntmap:usable").length > 0);
  await expandAllWings(page);
  await settled(page);
  await storeAction(page, "setCamera", { x: 0, y: 0, zoom });
  await settled(page);
  await expect.poll(async () => (await sceneDebug(page)).fx.haunts.length, { timeout: 15_000 }).toBeGreaterThan(0);
}

const overlaps = (a: HookRect, b: HookRect): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** The phases of the haunt in the order they first appeared. */
function phaseOrder(frames: Frame[]): string[] {
  const order: string[] = [];
  for (const f of frames) {
    const phase = f.haunt?.phase ?? "none";
    if (order[order.length - 1] !== phase) order.push(phase);
  }
  return order;
}

/** The kinds of the critters of the haunt, in the order they were first seen. */
function critterKinds(frames: Frame[]): string[] {
  const seen = new Map<number, string>();
  for (const f of frames) for (const c of f.haunt?.critters ?? []) if (!seen.has(c.id)) seen.set(c.id, c.kind);
  return [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([, kind]) => kind);
}

test.describe("the haunt of a door", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("1 the ghost goes into the door, it shakes, critters burst out and fade, the ghost comes out and goes on", async ({ page }) => {
    test.setTimeout(150_000);
    await openHaunted(page, 11);
    const frames = await watchFirstHaunt(page, 90_000);
    const order = phaseOrder(frames);
    expect(order.slice(order.indexOf("enter")), "the phases come in order").toEqual(["enter", "shake", "burst", "exit", "none"]);
    const at = (phase: string): Frame[] => frames.filter((f) => f.haunt?.phase === phase);
    const door = (at("enter")[0] as Frame).haunt?.door ?? null;
    expect(door, "the haunt names the door it is at").not.toBeNull();
    for (const phase of ["enter", "shake", "burst", "exit"]) for (const f of at(phase)) expect(f.haunt?.door, `${phase} at ${f.t}`).toBe(door);

    // The ghost is in the door while it shakes and while the panel bursts open.
    for (const f of [...at("shake"), ...at("burst")]) expect(f.haunt?.ghostAlpha, `ghost at ${f.t}`).toBe(0);
    expect((at("enter")[0] as Frame).haunt?.ghostAlpha, "the ghost is seen as it comes to the door").toBeGreaterThan(0.9);

    // About 1 to 1.5 s of shake (a frame is at most 100 ms of scene time).
    const shake = at("shake");
    const shakeMs = (at("burst")[0] as Frame).t - (shake[0] as Frame).t;
    expect(shakeMs).toBeGreaterThanOrEqual(1000 - 110);
    expect(shakeMs).toBeLessThanOrEqual(1500 + 110);
    // The panel and the frame rattle by a few pixels; the panel is shut while it does.
    const xs = shake.map((f) => (f.door as { rect: HookRect }).rect.x);
    const spread = Math.max(...xs) - Math.min(...xs);
    expect(spread, "the door rattles").toBeGreaterThanOrEqual(1);
    expect(spread, "by a few pixels").toBeLessThanOrEqual(8);
    for (const f of shake.filter((s) => s.t - (shake[0] as Frame).t > 100)) expect((f.door as { open: number }).open, `panel shut at ${f.t}`).toBeLessThan(0.05);
    // Small puffs of dust at the foot of the door, during the shake only.
    expect(shake.some((f) => (f.haunt as HookHaunt).puffs.length > 0), "dust puffs").toBe(true);
    for (const f of [...at("enter"), ...at("burst"), ...at("exit")]) if (f.t < (at("burst")[0] as Frame).t) expect((f.haunt as HookHaunt).critters).toEqual([]);

    // The critters: 2 to 5, none before the burst, all gone within about 3 s of it.
    const burstAt = (at("burst")[0] as Frame).t;
    for (const f of frames) if (f.t < burstAt) expect((f.haunt as HookHaunt).critters, `before the burst at ${f.t}`).toEqual([]);
    const kinds = critterKinds(frames);
    expect(kinds.length).toBeGreaterThanOrEqual(2);
    expect(kinds.length).toBeLessThanOrEqual(5);
    for (const k of kinds) expect(["bat", "cat"]).toContain(k);
    const lastSeen = Math.max(...frames.filter((f) => (f.haunt?.critters.length ?? 0) > 0).map((f) => f.t));
    expect(lastSeen - burstAt, "the critters are gone within about 3 s").toBeLessThanOrEqual(3000 + 110);
    expect(lastSeen - burstAt, "and they stay long enough to be seen").toBeGreaterThan(1200);
    expect((frames[frames.length - 1] as Frame).haunt?.critters, "none is left").toEqual([]);
    expect(Math.max(...frames.map((f) => f.haunt?.critters.length ?? 0))).toBeLessThanOrEqual(5);

    // Bats fly up, cats run along the floor, and each fades out.
    const track = new Map<number, { kind: string; first: HookRect; last: HookRect; alpha: number }>();
    for (const f of frames) {
      for (const c of f.haunt?.critters ?? []) {
        const known = track.get(c.id);
        track.set(c.id, { kind: c.kind, first: known?.first ?? c.rect, last: c.rect, alpha: c.alpha });
      }
    }
    for (const [id, c] of track) {
      expect(c.alpha, `critter ${id} fades out`).toBeLessThan(0.7);
      if (c.kind === "bat") expect(c.first.y - c.last.y, `bat ${id} flies up`).toBeGreaterThan(20);
      else {
        expect(Math.abs(c.last.x - c.first.x), `cat ${id} runs away`).toBeGreaterThan(30);
        expect(Math.abs(c.last.y - c.first.y), `cat ${id} stays on the floor`).toBeLessThan(8);
      }
    }

    // The ghost comes out of the door and goes on along the loop.
    const exit = at("exit");
    expect((exit[exit.length - 1] as Frame).haunt?.ghostAlpha).toBeGreaterThan(0.9);
    const after = frames.filter((f) => f.t > (exit[exit.length - 1] as Frame).t + 250 && f.ghost !== null);
    expect(after.length).toBeGreaterThan(0);
    expect((after[after.length - 1] as Frame).haunt?.ghostAlpha).toBe(1);
  });

  test("5 the door rattles plainly at a door that no name stands next to: 3 px or more; next to a name 2 px or more, off the name", async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    let clearBest: number | null = null;
    for (const zoom of [0.5, 1, 0.35, 0.75]) {
      await openHaunted(page, 11, zoom);
      const frames = await watchFirstHaunt(page, 90_000);
      const shake = frames.filter((f) => f.haunt?.phase === "shake" && f.door !== null);
      const rest = frames.filter((f) => f.haunt?.phase === "enter" && f.door !== null).pop();
      expect(shake.length, `a shake at zoom ${zoom}`).toBeGreaterThan(8);
      const door = (rest?.door as { rect: HookRect }).rect;
      const around = { x: door.x - 6, y: door.y - 6, width: door.width + 12, height: door.height + 12 };
      const near = (shake[0] as Frame).labels.some((l) => overlaps(around, l));
      const best = Math.max(...shake.map((f) => Math.abs((f.door as { rect: HookRect }).rect.x - door.x)));
      expect(best, `the door moves at least 2 px at zoom ${zoom}`).toBeGreaterThanOrEqual(2);
      if (!near && clearBest === null) clearBest = best;
    }
    expect(clearBest, "one zoom puts the haunt at a door that no name stands next to").not.toBeNull();
    expect(clearBest, "the frame and panel move 3 px or more there").toBeGreaterThanOrEqual(3);
  });

  test("4 a stranger can see a bat and a cat: 22 to 30 px, they travel 120 and 100 px, no new texture, particles inside the limit, nothing over a name", async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await openHaunted(page, 11, 0.5);
    const before = await sceneDebug(page);
    const frames = await watchFirstHaunt(page, 90_000);
    const critters = frames.flatMap((f) => f.haunt?.critters ?? []);
    expect(critters.length).toBeGreaterThan(0);
    for (const c of critters) {
      expect(c.rect.width, `${c.kind} is about 22 to 30 px across`).toBeGreaterThanOrEqual(21.5);
      expect(c.rect.width).toBeLessThanOrEqual(30.5);
    }
    // Far enough to be seen: a bat 120 px and a cat 100 px from the center of the door before it fades out.
    const doorFrame = frames.find((f) => f.door !== null)?.door as { rect: HookRect };
    const center = { x: doorFrame.rect.x + doorFrame.rect.width / 2, y: doorFrame.rect.y + doorFrame.rect.height / 2 };
    const farthest = new Map<number, { kind: string; far: number }>();
    for (const f of frames) {
      for (const c of f.haunt?.critters ?? []) {
        if (c.alpha < 0.5) continue;
        const far = Math.hypot(c.rect.x + c.rect.width / 2 - center.x, c.rect.y + c.rect.height / 2 - center.y);
        farthest.set(c.id, { kind: c.kind, far: Math.max(far, farthest.get(c.id)?.far ?? 0) });
      }
    }
    expect(farthest.size).toBeGreaterThan(0);
    for (const [id, c] of farthest) expect(c.far, `${c.kind} ${id} travels`).toBeGreaterThanOrEqual(c.kind === "bat" ? 120 : 100);
    // The puffs of dust are 6 to 10 px across.
    for (const p of frames.flatMap((f) => f.haunt?.puffs ?? [])) {
      expect(p.rect.width).toBeGreaterThanOrEqual(5.5);
      expect(p.rect.width).toBeLessThanOrEqual(10.5);
    }
    // The silhouettes are drawn once into cached textures: the count never changes and stays at 24 or under.
    expect(before.textureCount).toBeLessThanOrEqual(24);
    for (const f of frames) {
      expect(f.textures, `textures at ${f.t}`).toBe(before.textureCount);
      expect(f.particles, `particles at ${f.t}`).toBeLessThanOrEqual(40);
      const on = (f.haunt?.critters.length ?? 0) + (f.haunt?.puffs.length ?? 0);
      expect(on).toBeLessThanOrEqual(f.particles);
    }
    // No critter, puff or shaken door covers a name, a plate or a number.
    const covering: string[] = [];
    for (const f of frames) {
      for (const c of f.haunt?.critters ?? []) if (c.visible && c.alpha > 0.02) for (const l of f.labels) if (overlaps(c.rect, l)) covering.push(`${c.kind} ${JSON.stringify(c.rect)} covers ${JSON.stringify(l)} at ${f.t}`);
      for (const p of f.haunt?.puffs ?? []) if (p.visible && p.alpha > 0.02) for (const l of f.labels) if (overlaps(p.rect, l)) covering.push(`puff ${JSON.stringify(p.rect)} covers ${JSON.stringify(l)} at ${f.t}`);
      if (f.door !== null) for (const l of f.labels) if (overlaps(f.door.rect, l)) covering.push(`door ${JSON.stringify(f.door.rect)} covers ${JSON.stringify(l)} at ${f.t}`);
    }
    expect(covering.slice(0, 5), "no effect of the haunt covers a name").toEqual([]);
  });
});

/** What a stranger could read of the map and the analysis: the investigation and its loops, the doors and names drawn, the text of the page. */
async function readEverything(page: Page): Promise<string> {
  return page.evaluate(() => {
    const hook = (window as unknown as { __hauntmap: { store: { getState(): Record<string, unknown> }; scene(): { debug(): Record<string, unknown> } | null } }).__hauntmap;
    const state = hook.store.getState();
    const d = hook.scene()?.debug() as { labels: { kind: string; id: string; text: string }[]; fx: { doorBoxes: { relationId: string; x: number; y: number; w: number }[] } };
    return JSON.stringify({
      investigation: state["investigation"],
      panel: state["panel"],
      selection: state["selection"],
      doors: d.fx.doorBoxes.map((b) => [b.relationId, b.x, b.y, b.w]).sort(),
      names: d.labels.map((l) => [l.kind, l.id, l.text]).sort(),
      text: document.body.innerText,
    });
  });
}

test.describe("the random of the haunt is drawing only", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("2 two seeds give two different mixes, the same seed the same mix, and the map data, the analysis and the page text are the same", async ({ page }) => {
    test.setTimeout(240_000);
    const run = async (seed: number): Promise<{ kinds: string[]; before: string; after: string; fixed: number | null }> => {
      await openHaunted(page, seed);
      await page.getByRole("button", { name: "Dependency loops" }).click();
      await settled(page);
      const before = await readEverything(page);
      const fixed = (await sceneDebug(page)).fx.hauntSeed;
      const frames = await watchFirstHaunt(page, 90_000);
      expect(phaseOrder(frames)).toContain("burst");
      return { kinds: critterKinds(frames), before, after: await readEverything(page), fixed };
    };
    const a = await run(11);
    const b = await run(23);
    const again = await run(11);
    expect(a.fixed).toBe(11);
    expect(b.fixed).toBe(23);
    expect(a.kinds.length).toBeGreaterThanOrEqual(2);
    expect(a.kinds, "the seed 11 and the seed 23 bring a different mix").not.toEqual(b.kinds);
    expect(again.kinds, "the same seed brings the same mix").toEqual(a.kinds);
    // Nothing but the effect differs: the data, the analysis and the text are the same for the two seeds, and before and after the haunt.
    expect(b.before).toBe(a.before);
    expect(a.after).toBe(a.before);
    expect(b.after).toBe(b.before);
  });
});

for (const how of ["system", "toggle"] as const) {
  test.describe(`reduced motion by the ${how} setting`, () => {
    test.use({ viewport: { width: 1280, height: 720 } });

    test("3 no haunt, no shake and no critter: the ghost stands at its first door and is seen", async ({ page }) => {
      test.setTimeout(90_000);
      if (how === "system") await page.emulateMedia({ reducedMotion: "reduce" });
      else {
        await page.emulateMedia({ reducedMotion: "no-preference" });
        await page.addInitScript(() => localStorage.setItem("hauntmap.prefs.v1", JSON.stringify({ version: 1, motion: "reduce", legendOpen: true, preset: "static-value" })));
      }
      await page.goto("/?hauntSeed=11");
      await page.getByRole("button", { name: "Explore the manor" }).click();
      await page.waitForFunction(() => performance.getEntriesByName("hauntmap:usable").length > 0);
      await expandAllWings(page);
      await settled(page);
      await storeAction(page, "setCamera", { x: 0, y: 0, zoom: 0.5 });
      await settled(page);
      await expect.poll(async () => (await sceneDebug(page)).glow).toBe(true);
      // Long enough for a ghost that walked to have reached several doors at this zoom.
      for (let i = 0; i < 24; i++) {
        const d = await sceneDebug(page);
        expect((d.ghost as { leg: number }).leg, "the ghost stands at its first door").toBe(0);
        expect(d.particleCount).toBe(0);
        expect(d.activeTweens).toBe(0);
        for (const h of d.fx.haunts) {
          expect(h.phase).toBe("none");
          expect(h.critters).toEqual([]);
          expect(h.puffs).toEqual([]);
          expect(h.shake).toEqual({ x: 0, y: 0 });
          expect(h.ghostAlpha).toBe(1);
        }
        // Every door stands as it is: the panel does not rattle (the boxes do not move).
        await page.waitForTimeout(500);
      }
      const doors = (await sceneDebug(page)).fx.doorBoxes.map((b) => b.rect.x);
      await page.waitForTimeout(600);
      expect((await sceneDebug(page)).fx.doorBoxes.map((b) => b.rect.x)).toEqual(doors);
    });
  });
}