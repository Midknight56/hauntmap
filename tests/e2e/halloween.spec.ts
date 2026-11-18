import { expect, test, type Page } from "@playwright/test";
import { expandAllWings, openManor, sceneDebug, settled, storeAction, type HookFx } from "./helpers";

// The halloween detail pass, read through the scene debug data of the dev build:
//   1 doors swing open as the ghost reaches them and shut after it has gone,
//   2 the rooms of the loop start each lap dim and light up as the ghost reaches them,
//   3 cobwebs, candles, cracks, fog, bats and spiders never cover a name and never take a name under 4.5 to 1,
//   4 under reduced motion everything stands still and every loop room is lit.
// Headless Chromium here draws with software rendering (SwiftShader).

interface Sample {
  t: number;
  ghost: { leg: number; x: number; y: number } | null;
  fx: HookFx;
  particles: number;
}

/** Sample the scene on every animation frame for `ms` of wall time, or until the ghost has walked `laps` more laps (when given). */
async function sampleFor(page: Page, ms: number, laps = 0): Promise<Sample[]> {
  return page.evaluate(
    ([duration, more]) =>
      new Promise<Sample[]>((resolve) => {
        const hook = (window as unknown as { __hauntmap: { scene(): { debug(): Record<string, unknown> } | null } }).__hauntmap;
        const out: Sample[] = [];
        const start = performance.now();
        let lastRead = -Infinity;
        const tick = (): void => {
          const scene = hook.scene();
          // At most every 40 ms: a reading lists every label, and reading at every frame would take the CPU from the other browsers.
          if (scene !== null && performance.now() - lastRead >= 40) {
            lastRead = performance.now();
            const d = scene.debug() as { ghost: Sample["ghost"]; fx: HookFx; particleCount: number };
            out.push({ t: d.fx.clock, ghost: d.ghost, fx: { ...d.fx, roomAlphas: {}, decor: [] }, particles: d.particleCount });
          }
          const first = out[0]?.fx.loop?.lap ?? 0;
          const last = out[out.length - 1]?.fx.loop?.lap ?? 0;
          if (performance.now() - start >= duration || (more > 0 && last - first >= more)) resolve(out);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    [ms, laps] as const,
  );
}

async function loopModules(page: Page): Promise<string[]> {
  await page.getByRole("button", { name: "Dependency loops" }).click();
  return page.evaluate(() => {
    const s = (window as unknown as { __hauntmap: { store: { getState(): { panel: { kind: string; report: { components: { witness: { modules: string[] } }[] } | null } } } } }).__hauntmap.store.getState();
    if (s.panel.kind !== "loops" || s.panel.report === null) throw new Error("the loops panel is not open");
    return (s.panel.report.components[0] as { witness: { modules: string[] } }).witness.modules;
  });
}

const dist = (g: { x: number; y: number }, d: { x: number; y: number }): number => Math.hypot(g.x - d.x, g.y - d.y);

test.describe("with motion allowed", () => {
  test.use({ viewport: { width: 1280, height: 720 } });
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
  });

  test("1 a door is open only while the ghost is at it or within one door width, swings open in about 120 ms and shut in about 300 ms", async ({ page }) => {
    test.setTimeout(120_000);
    await openManor(page);
    await expandAllWings(page);
    await settled(page);
    const samples = (await sampleFor(page, 30_000)).filter((s) => s.ghost !== null);
    expect(samples.length).toBeGreaterThan(60);
    const states = new Set<string>();
    const nearSince = new Map<string, number>();
    const farSince = new Map<string, number>();
    const openTimes: number[] = [];
    const shutTimes: number[] = [];
    const counted = new Set<string>();
    // A door counts for the timing of its swing only when it was seen shut (or shutting) just before the ghost came.
    const armed = new Set<string>();
    const last = new Map<string, string>();
    for (const s of samples) {
      const ghost = s.ghost as { x: number; y: number };
      expect(s.fx.doors.length, "the loop doors are listed").toBeGreaterThanOrEqual(3);
      for (const d of s.fx.doors) {
        const distance = dist(ghost, d);
        states.add(d.state);
        if (d.state === "open" || d.state === "opening") expect(distance, `door ${d.relationId} ${d.state} at ${s.t}`).toBeLessThanOrEqual(d.w + 2);
        // A closed door has no ghost at it, except while the ghost is inside the door (the haunt pass): it is not drawn then, and the panel is shut on it.
        const inside = s.fx.haunts.some((h) => h.door === d.relationId && h.phase !== "none" && h.ghostAlpha === 0);
        if (d.state === "closed" && !inside) expect(distance, `door ${d.relationId} closed at ${s.t}`).toBeGreaterThan(d.w - 2);
        if (distance <= d.w) {
          farSince.delete(d.relationId);
          if (!nearSince.has(d.relationId)) {
            nearSince.set(d.relationId, s.t);
            if (last.get(d.relationId) === "closed" || last.get(d.relationId) === "closing") armed.add(d.relationId);
            else armed.delete(d.relationId);
          }
          const key = `open ${d.relationId} ${nearSince.get(d.relationId)}`;
          if (d.state === "open" && armed.has(d.relationId) && !counted.has(key)) {
            counted.add(key);
            openTimes.push(s.t - (nearSince.get(d.relationId) as number));
          }
        } else {
          nearSince.delete(d.relationId);
          if (!farSince.has(d.relationId)) farSince.set(d.relationId, s.t);
          const away = s.t - (farSince.get(d.relationId) as number);
          const key = `shut ${d.relationId} ${farSince.get(d.relationId)}`;
          // The door was open when the ghost left (it has been seen open) and is shut now: how long that took.
          if (d.state === "closed" && !counted.has(key) && counted.has(`seen ${d.relationId}`)) {
            counted.add(key);
            shutTimes.push(away);
          }
          // 300 ms to shut, and a frame or two of slack.
          if (away > 300 + 2 * 100 + 20) expect(d.state, `door ${d.relationId} ${away} ms after the ghost left`).toBe("closed");
        }
        last.set(d.relationId, d.state);
        if (d.state === "open") counted.add(`seen ${d.relationId}`);
        if (d.state === "closed") counted.delete(`seen ${d.relationId}`);
      }
    }
    expect([...states].sort(), "a door goes through all four states").toEqual(["closed", "closing", "open", "opening"]);
    expect(openTimes.length).toBeGreaterThanOrEqual(2);
    // The scene clock counts a slow frame as at most 100 ms, so a reading is at most a frame or two late.
    const step = Math.max(...samples.slice(1).map((s, i) => s.t - (samples[i] as Sample).t));
    for (const ms of openTimes) {
      expect(ms, `opened after ${ms} ms`).toBeGreaterThanOrEqual(120 - step);
      expect(ms, `opened after ${ms} ms`).toBeLessThan(120 + 2 * step + 20);
    }
    expect(shutTimes.length).toBeGreaterThanOrEqual(2);
    for (const ms of shutTimes) {
      expect(ms, `shut after ${ms} ms`).toBeGreaterThanOrEqual(300 - step);
      expect(ms, `shut after ${ms} ms`).toBeLessThan(300 + 2 * step + 20);
    }
  });

  test("1 the same on a selected dependency path: the door of the selected relation opens as the traveling light reaches it and is shut while the light rests", async ({ page }) => {
    test.setTimeout(60_000);
    await openManor(page);
    await settled(page);
    const first = await page.evaluate(() => {
      const hook = (window as unknown as { __hauntmap: { store: { getState(): { layout: { doors: { relationId: string; from: string; to: string }[] } } } } }).__hauntmap;
      return hook.store.getState().layout.doors.find((d) => !/receipt|checkout|charge/.test(d.from + d.to))?.relationId ?? null;
    });
    expect(first).not.toBeNull();
    await storeAction(page, "select", { kind: "relation", relationId: first }, { from: "dom" });
    await settled(page);
    const samples = await page.evaluate(
      () =>
        new Promise<{ light: { x: number; y: number } | null; doors: HookFx["doors"]; t: number }[]>((resolve) => {
          const hook = (window as unknown as { __hauntmap: { scene(): { debug(): { light: { x: number; y: number } | null; fx: HookFx } } } }).__hauntmap;
          const out: { light: { x: number; y: number } | null; doors: HookFx["doors"]; t: number }[] = [];
          const start = performance.now();
          let lastRead = -Infinity;
          const tick = (): void => {
            if (performance.now() - lastRead >= 30) {
              lastRead = performance.now();
              const d = hook.scene().debug();
              out.push({ light: d.light, doors: d.fx.doors, t: d.fx.clock });
            }
            if (performance.now() - start > 7000) resolve(out);
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
    );
    const seen = new Set<string>();
    for (const s of samples) {
      const door = s.doors.find((d) => d.relationId === first);
      expect(door, "the door of the selected relation is listed").toBeDefined();
      const d = door as HookFx["doors"][number];
      seen.add(d.state);
      if (s.light === null) {
        // Rests: nothing is near, so the door is shut or shutting.
        expect(["closed", "closing"]).toContain(d.state);
      } else if (d.state === "open" || d.state === "opening") expect(dist(s.light, d), `light at ${s.t}`).toBeLessThanOrEqual(d.w + 2);
    }
    expect(seen.has("open") || seen.has("opening"), "the door opens when the light starts from it").toBe(true);
    expect(seen.has("closed"), "and is shut while the light rests").toBe(true);
  });

  test("2 the rooms of the loop are dim at the start of a lap, light up as the ghost reaches their door and reset on the next lap", async ({ page }) => {
    test.setTimeout(180_000);
    await openManor(page);
    await expandAllWings(page);
    await settled(page);
    const modules = await loopModules(page);
    expect(modules.length).toBeGreaterThanOrEqual(3);
    // Zoomed out the loop is short on screen, so a lap takes a few seconds.
    await storeAction(page, "setCamera", { x: 0, y: 0, zoom: 0.3 });
    await settled(page);
    await expect.poll(async () => (await sceneDebug(page)).fx.loop !== null).toBe(true);
    const samples = (await sampleFor(page, 90_000, 2)).filter((s) => s.ghost !== null && s.fx.loop !== null);
    const laps = new Set(samples.map((s) => (s.fx.loop as { lap: number }).lap));
    expect(laps.size, "the ghost walks more than one lap").toBeGreaterThanOrEqual(3);
    const lightAt = new Map<string, number>();
    let previous: Sample | null = null;
    let resets = 0;
    for (const s of samples) {
      const loop = s.fx.loop as NonNullable<HookFx["loop"]>;
      const ghost = s.ghost as { leg: number };
      const drawn = new Set(loop.rooms.map((r) => r.id));
      expect(drawn.size, "the rooms of the loop are drawn").toBe(modules.length);
      const expected = modules.slice(0, ghost.leg + 1).filter((m) => drawn.has(m)).sort();
      const lit = loop.rooms.filter((r) => r.lit).map((r) => r.id).sort();
      expect(lit, `lap ${loop.lap}, leg ${ghost.leg}, at ${s.t}`).toEqual(expected);
      for (const r of loop.rooms) {
        if (!r.lit) expect(r.brightness, `${r.id} dim`).toBeCloseTo(0.4, 2);
        else {
          const key = `${loop.lap}|${r.id}`;
          if (!lightAt.has(key)) lightAt.set(key, s.t);
          // Lit rooms are on their way up to full in 200 ms and then stay there.
          if (s.t - (lightAt.get(key) as number) > 260) expect(r.brightness, `${r.id} lit`).toBeGreaterThan(0.99);
          expect(r.brightness).toBeGreaterThan(0.399);
        }
      }
      const before = previous === null ? null : (previous.fx.loop as NonNullable<HookFx["loop"]>);
      if (before !== null && loop.lap === before.lap + 1) {
        resets++;
        expect(before.rooms.filter((r) => r.lit).length, "all were lit at the end of the lap").toBe(drawn.size);
        expect(lit, "only the first room is lit at the start of the next lap").toEqual([modules[0]]);
      }
      previous = s;
    }
    expect(resets).toBeGreaterThanOrEqual(1);
    expect(lightAt.size).toBeGreaterThan(modules.length);
    // A room that is not on the loop keeps its look: it is not listed and its opacity is untouched.
    const d = await sceneDebug(page);
    const onLoop = new Set((d.fx.loop as NonNullable<HookFx["loop"]>).rooms.map((r) => r.id));
    const others = Object.entries(d.fx.roomAlphas).filter(([id]) => !onLoop.has(id));
    expect(others.length).toBeGreaterThan(5);
    for (const [, alpha] of others) expect(alpha).toBe(1);
  });

  test("3 no effect covers a name, the particle limit holds, and every kind of detail is drawn", async ({ page }) => {
    test.setTimeout(120_000);
    await openManor(page);
    await expandAllWings(page);
    await settled(page);
    const kinds = new Set<string>();
    const everVisible = new Set<string>();
    let worstParticles = 0;
    const covering: string[] = [];
    for (let round = 0; round < 3; round++) {
      const samples = await sampleManyLabels(page, round === 0 ? 14_000 : 6000);
      for (const s of samples) {
        worstParticles = Math.max(worstParticles, s.particles);
        // The bats, cats and dust of the haunt are effects too: none that is shown covers a name or a plate.
        for (const h of s.haunts) {
          for (const e of [...h.critters.map((c) => ({ kind: c.kind, visible: c.visible && c.alpha > 0.02, rect: c.rect })), ...h.puffs.map((p) => ({ kind: "dust", visible: p.visible && p.alpha > 0.02, rect: p.rect }))]) {
            if (!e.visible) continue;
            for (const l of s.labels) {
              for (const box of [l.rect, l.plate]) {
                if (box === undefined) continue;
                if (e.rect.x < box.x + box.width && box.x < e.rect.x + e.rect.width && e.rect.y < box.y + box.height && box.y < e.rect.y + e.rect.height) covering.push(`${e.kind} at ${JSON.stringify(e.rect)} covers ${l.kind} ${l.id}`);
              }
            }
          }
        }
        for (const e of s.decor) {
          kinds.add(e.kind);
          if (e.visible) everVisible.add(e.kind);
          if (!e.visible || e.kind === "fog") continue;
          for (const l of s.labels) {
            for (const box of [l.rect, l.plate]) {
              if (box === undefined) continue;
              const overlap = e.rect.x < box.x + box.width && box.x < e.rect.x + e.rect.width && e.rect.y < box.y + box.height && box.y < e.rect.y + e.rect.height;
              if (overlap) covering.push(`${e.kind} at ${JSON.stringify(e.rect)} covers ${l.kind} ${l.id}`);
            }
          }
        }
      }
      // A second round after a pan shows the same, and the camera moves the labels under the effects.
      await storeAction(page, "setCamera", { x: 200 * (round + 1), y: 80, zoom: 0.8 + 0.4 * round });
      await settled(page);
    }
    expect(covering.slice(0, 5), "no detail covers a name or a plate").toEqual([]);
    for (const kind of ["web", "crack", "candle", "fog", "bat", "spider"]) expect(kinds.has(kind), `${kind} is drawn`).toBe(true);
    for (const kind of ["web", "crack", "candle", "bat", "spider"]) expect(everVisible.has(kind), `${kind} is seen`).toBe(true);
    expect(worstParticles).toBeLessThanOrEqual(40);
    expect(worstParticles).toBeGreaterThan(0);
    const d = await sceneDebug(page);
    expect(d.textureCount).toBeLessThanOrEqual(24);
  });

  test("3 every name keeps 4.5 to 1 against what is under it while the effects run", async ({ page }) => {
    test.setTimeout(120_000);
    await openManor(page);
    await expandAllWings(page);
    await settled(page);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const worst = new Map<string, number>();
    let measured = 0;
    for (let round = 0; round < 6; round++) {
      await page.waitForTimeout(1700);
      const d = await sceneDebug(page);
      const png = await page.screenshot();
      const out = await page.evaluate(
        async ([b64, labels]) => {
          const css = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
          const inks: Record<string, string> = { room: css("--room-ink"), wing: css("--plate-ink"), "wing-note": css("--ink-muted"), count: css("--ink-muted"), step: css("--ink") };
          const img = new Image();
          img.src = `data:image/png;base64,${b64 as string}`;
          await img.decode();
          const c = document.createElement("canvas");
          c.width = img.width;
          c.height = img.height;
          const g = c.getContext("2d") as CanvasRenderingContext2D;
          g.drawImage(img, 0, 0);
          const lin = (v: number): number => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
          };
          const hex = (h: string): number => {
            const n = (o: number): number => parseInt(h.slice(o, o + 2), 16);
            return 0.2126 * lin(n(1)) + 0.7152 * lin(n(3)) + 0.0722 * lin(n(5));
          };
          const rows: { id: string; kind: string; ratio: number; bg: number }[] = [];
          for (const l of labels as { kind: string; id: string; rect?: { x: number; y: number; width: number; height: number } }[]) {
            const ink = inks[l.kind];
            if (ink === undefined || l.rect === undefined) continue;
            const x0 = Math.max(0, Math.floor(l.rect.x));
            const y0 = Math.max(0, Math.floor(l.rect.y));
            const w = Math.min(c.width, Math.ceil(l.rect.x + l.rect.width)) - x0;
            const h = Math.min(c.height, Math.ceil(l.rect.y + l.rect.height)) - y0;
            if (w < 8 || h < 8) continue;
            const data = g.getImageData(x0, y0, w, h).data;
            const L = new Float64Array(w * h);
            for (let i = 0; i < w * h; i++) L[i] = 0.2126 * lin(data[i * 4] as number) + 0.7152 * lin(data[i * 4 + 1] as number) + 0.0722 * lin(data[i * 4 + 2] as number);
            const sorted = Array.from(L).sort((a, b) => a - b);
            const median = sorted[Math.floor(sorted.length / 2)] as number;
            const odd = new Uint8Array(w * h);
            for (let i = 0; i < w * h; i++) if (Math.abs((L[i] as number) - median) > 0.02) odd[i] = 1;
            let bgMax = 0;
            let bgCount = 0;
            for (let y = 0; y < h; y++) {
              for (let x = 0; x < w; x++) {
                let near = false;
                for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (odd[Math.min(h - 1, Math.max(0, y + dy)) * w + Math.min(w - 1, Math.max(0, x + dx))] === 1) near = true;
                if (near) continue;
                bgCount++;
                bgMax = Math.max(bgMax, L[y * w + x] as number);
              }
            }
            if (bgCount < w * h * 0.2) continue;
            const inkL = hex(ink);
            rows.push({ id: l.id, kind: l.kind, bg: bgMax, ratio: (Math.max(inkL, bgMax) + 0.05) / (Math.min(inkL, bgMax) + 0.05) });
          }
          return rows;
        },
        [png.toString("base64"), d.labels] as const,
      );
      measured += out.length;
      for (const row of out) worst.set(`${row.kind} ${row.id}`, Math.min(worst.get(`${row.kind} ${row.id}`) ?? Infinity, row.ratio));
    }
    expect(measured, "labels were measured").toBeGreaterThan(30);
    for (const [name, ratio] of worst) expect(ratio, name).toBeGreaterThanOrEqual(4.5);
  });

  test("5 the dev build reports the milliseconds per frame of each effect", async ({ page }) => {
    test.setTimeout(60_000);
    await openManor(page);
    await expandAllWings(page);
    await settled(page);
    await storeAction(page, "chooseLoop", 0);
    await settled(page);
    await page.waitForTimeout(2500);
    const { cost } = (await sceneDebug(page)).fx;
    const names = ["fog", "bats", "spiders", "motes", "doors", "loopLights", "candles", "ghost"];
    expect(Object.keys(cost ?? {}).sort()).toEqual([...names].sort());
    for (const name of names) {
      const ms = (cost as Record<string, number>)[name] as number;
      expect(Number.isFinite(ms), `${name} is a number`).toBe(true);
      expect(ms, `${name} is not negative`).toBeGreaterThanOrEqual(0);
      expect(ms, `${name} costs under one frame`).toBeLessThan(16);
    }
    // What the loop shows is measured: the ghost, its doors, its room lights, the motes and the candles all run.
    for (const name of ["doors", "loopLights", "ghost", "motes", "candles"]) expect((cost as Record<string, number>)[name], `${name} was measured`).toBeGreaterThan(0);
  });

  test("3 the annex with three loops keeps the particle limit and draws the details", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/");
    await page.getByRole("button", { name: "Explore the annex" }).click();
    await page.getByRole("application", { name: "Haunted map" }).waitFor();
    await settled(page);
    await expandAllWings(page);
    await settled(page);
    await expect.poll(async () => (await sceneDebug(page)).visibleRooms, { timeout: 30_000 }).toBeGreaterThan(0);
    const samples = await sampleFor(page, 4000);
    expect(samples.length).toBeGreaterThan(50);
    for (const s of samples) expect(s.particles).toBeLessThanOrEqual(40);
    expect(Math.max(...samples.map((s) => s.particles))).toBeGreaterThan(10);
    const d = await sceneDebug(page);
    expect(d.fx.loop, "a loop is shown").not.toBeNull();
    expect(d.textureCount).toBeLessThanOrEqual(24);
  });
});

/** Pixel readings of a screenshot: for each rect, the share of pixels that differ from the rect's median luminance by more than `delta`, and the mean luminance and red minus blue. */
async function readRects(page: Page, rects: { x: number; y: number; width: number; height: number }[], delta: number): Promise<{ share: number; mean: number; warm: number; peak: number }[]> {
  const png = await page.screenshot();
  return page.evaluate(
    async ([b64, list, d]) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64 as string}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext("2d") as CanvasRenderingContext2D;
      g.drawImage(img, 0, 0);
      const lin = (v: number): number => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      const out: { share: number; mean: number; warm: number; peak: number }[] = [];
      for (const r of list as { x: number; y: number; width: number; height: number }[]) {
        const x0 = Math.max(0, Math.floor(r.x));
        const y0 = Math.max(0, Math.floor(r.y));
        const w = Math.min(c.width, Math.ceil(r.x + r.width)) - x0;
        const h = Math.min(c.height, Math.ceil(r.y + r.height)) - y0;
        if (w < 2 || h < 2) {
          out.push({ share: 0, mean: 0, warm: 0, peak: 0 });
          continue;
        }
        const data = g.getImageData(x0, y0, w, h).data;
        const L: number[] = [];
        let sum = 0;
        let warm = 0;
        for (let i = 0; i < w * h; i++) {
          const l = 0.2126 * lin(data[i * 4] as number) + 0.7152 * lin(data[i * 4 + 1] as number) + 0.0722 * lin(data[i * 4 + 2] as number);
          L.push(l);
          sum += l;
          warm += (data[i * 4] as number) - (data[i * 4 + 2] as number);
        }
        const sorted = [...L].sort((a, b) => a - b);
        const median = sorted[Math.floor(L.length / 2)] as number;
        // The peak is how far the brightest 2 percent of the pixels stand above the median: a thread on the floor.
        const peak = (sorted[Math.min(L.length - 1, Math.floor(L.length * 0.98))] as number) - median;
        out.push({ share: L.filter((l) => Math.abs(l - median) > (d as number)).length / L.length, mean: sum / L.length, warm: warm / L.length, peak });
      }
      return out;
    },
    [png.toString("base64"), rects, delta] as const,
  );
}

test.describe("the look at the first view, 1920 x 1080", () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test("6 the doors of the loop are 16 to 20 px wide, the cobwebs are large and bright, the cracks show, lit rooms have a warm halo", async ({ page }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openManor(page);
    await settled(page);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.waitForTimeout(800);
    const d = await sceneDebug(page);
    expect(d.fx.doorPx.length, "the loop has doors that swing").toBeGreaterThanOrEqual(3);
    for (const px of d.fx.doorPx) {
      expect(px, "a swinging door is 16 to 20 px wide on the screen").toBeGreaterThanOrEqual(16);
      expect(px).toBeLessThanOrEqual(20);
    }
    expect(d.fx.doorways, "each swinging door has a dark doorway behind it").toBe(d.fx.doorPx.length);

    const visible = d.fx.decor.filter((e) => e.visible);
    const webs = visible.filter((e) => e.kind === "web" && e.rect.width >= 12);
    expect(webs.length, "cobwebs are seen").toBeGreaterThanOrEqual(4);
    const wingWebs = webs.filter((e) => e.rect.width >= 30);
    expect(wingWebs.length, "the cobwebs in the wing corners are 30 px or more").toBeGreaterThanOrEqual(3);
    const webRead = await readRects(page, webs.map((e) => e.rect), 0.05);
    const strongest = webRead.map((r) => r.peak).sort((a, b) => b - a);
    console.log(`LOOK webs ${webs.length} peaks ${strongest.map((s) => s.toFixed(3)).join(" ")}`);
    expect(strongest[2] as number, "the threads of a cobweb stand clearly above the floor").toBeGreaterThanOrEqual(0.05);

    const cracks = visible.filter((e) => e.kind === "crack");
    expect(cracks.length).toBeGreaterThanOrEqual(3);
    const crackRead = await readRects(page, cracks.map((e) => e.rect), 0.025);
    const crackPeaks = crackRead.map((r) => r.peak).sort((a, b) => b - a);
    console.log(`LOOK cracks ${cracks.length} peaks ${crackPeaks.map((s) => s.toFixed(3)).join(" ")}`);
    expect(crackPeaks[4] as number, "the cracks stand a little above the floor").toBeGreaterThanOrEqual(0.02);
  });

  test("6 a lit loop room has a warm halo around its walls; a dim one has none", async ({ page }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openManor(page);
    await settled(page);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    // One room of the loop, seen while it is dim and again once the ghost has lit it: the bands beside its walls change. A reading counts
    // only when the room was in the same state (and the same lap) before and after the screenshot, so that a slow machine cannot skew it.
    const loopOf = async (): Promise<NonNullable<HookFx["loop"]>> => (await sceneDebug(page)).fx.loop as NonNullable<HookFx["loop"]>;
    const roomOf = async (id: string): Promise<{ lap: number; lit: boolean; glow: number }> => {
      const loop = await loopOf();
      const room = loop.rooms.find((r) => r.id === id) as { lit: boolean; glow: number };
      return { lap: loop.lap, lit: room.lit, glow: room.glow };
    };
    const rectOf = (id: string): Promise<{ x: number; y: number; width: number; height: number }> =>
      page.evaluate((moduleId) => {
        const r = (window as unknown as { __hauntmap: { scene(): { screenRectOf(t: { kind: string; id: string }): DOMRect } } }).__hauntmap.scene().screenRectOf({ kind: "room", id: moduleId });
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }, id);
    // Before the haunt pass the ghost stood at the door of the room it had just lit, and the bands beside the walls were read with it there (the
    // thresholds below come from that). Now the ghost goes into the door first, so the bands are read once it is seen again (at 90 percent or more)
    // at the room: the same picture, and never with the ghost hidden.
    const ghostBack = (id: string): Promise<boolean> =>
      page.evaluate((moduleId) => {
        const scene = (window as unknown as { __hauntmap: { scene(): { debug(): { ghost: { x: number; y: number } | null; fx: HookFx }; screenRectOf(t: { kind: string; id: string }): DOMRect } } }).__hauntmap.scene();
        const d = scene.debug();
        if (d.fx.haunts.some((h) => h.phase !== "none" && h.ghostAlpha < 0.9)) return false;
        if (d.ghost === null) return false;
        const canvas = document.querySelector("canvas") as HTMLCanvasElement;
        const box = canvas.getBoundingClientRect();
        const room = scene.screenRectOf({ kind: "room", id: moduleId });
        const gx = box.left + box.width / 2 + (d.ghost.x - d.fx.camera.x) * d.fx.camera.zoom;
        const gy = box.top + box.height / 2 + (d.ghost.y - d.fx.camera.y) * d.fx.camera.zoom;
        const dx = Math.max(room.x - gx, 0, gx - (room.x + room.width));
        const dy = Math.max(room.y - gy, 0, gy - (room.y + room.height));
        return Math.hypot(dx, dy) <= 30;
      }, id);
    type Read = { share: number; mean: number; warm: number; peak: number }[];
    const stable = async (id: string, wantLit: boolean): Promise<Read | null> => {
      const ok = (s: { lit: boolean; glow: number }): boolean => (wantLit ? s.glow > 0.99 : !s.lit);
      const before = await roomOf(id);
      if (!ok(before) || (wantLit && !(await ghostBack(id)))) return null;
      const rect = await rectOf(id);
      const bands = [
        { x: rect.x - 9, y: rect.y + 12, width: 6, height: rect.height - 24 },
        { x: rect.x + rect.width + 3, y: rect.y + 12, width: 6, height: rect.height - 24 },
        { x: rect.x + rect.width * 0.1, y: rect.y + rect.height * 0.62, width: rect.width * 0.8, height: rect.height * 0.3 },
      ];
      const read = await readRects(page, bands, 1);
      const after = await roomOf(id);
      return ok(after) && after.lap === before.lap ? read : null;
    };
    let dimRead: Read | null = null;
    let litRead: Read | null = null;
    for (let attempt = 0; attempt < 8 && litRead === null; attempt++) {
      await expect.poll(async () => (await loopOf()).rooms.some((r) => !r.lit), { timeout: 30_000, intervals: [50] }).toBe(true);
      const id = (await loopOf()).rooms.filter((r) => !r.lit).pop()?.id as string;
      dimRead = await stable(id, false);
      if (dimRead === null) continue;
      await expect.poll(async () => (await roomOf(id)).glow, { timeout: 30_000, intervals: [30] }).toBeGreaterThan(0.99);
      // Wait until the ghost is seen again at the door of the room (or the lap has ended, which starts the next attempt).
      const lap = (await roomOf(id)).lap;
      await expect.poll(async () => (await roomOf(id)).lap !== lap || (await ghostBack(id)), { timeout: 30_000, intervals: [20] }).toBe(true);
      litRead = await stable(id, true);
    }
    expect(dimRead, "a dim reading was taken").not.toBeNull();
    expect(litRead, "a lit reading was taken").not.toBeNull();
    const a = litRead as Read;
    const b = dimRead as Read;
    const floorRatio = (a[2] as { mean: number }).mean / Math.max(1e-6, (b[2] as { mean: number }).mean);
    console.log(`LOOK inside lit ${(a[2] as { mean: number }).mean.toFixed(4)} dim ${(b[2] as { mean: number }).mean.toFixed(4)} ratio ${floorRatio.toFixed(2)}`);
    expect(floorRatio, "the floor of a lit room is clearly brighter than a dim one").toBeGreaterThanOrEqual(2.2);    const litMean = (a[0] as { mean: number }).mean + (a[1] as { mean: number }).mean;
    const dimMean = (b[0] as { mean: number }).mean + (b[1] as { mean: number }).mean;
    const litWarm = ((a[0] as { warm: number }).warm + (a[1] as { warm: number }).warm) / 2;
    const dimWarm = ((b[0] as { warm: number }).warm + (b[1] as { warm: number }).warm) / 2;    console.log(`LOOK halo lit ${litMean.toFixed(4)} warm ${litWarm.toFixed(1)}; dim ${dimMean.toFixed(4)} warm ${dimWarm.toFixed(1)}`);
    expect(litMean, "the ring around a lit room is brighter than around a dim one").toBeGreaterThan(dimMean * 1.6);
    expect(litWarm, "and warmer").toBeGreaterThan(dimWarm + 28);
  });
});
interface LabelSample {
  particles: number;
  haunts: HookFx["haunts"];
  decor: HookFx["decor"];
  labels: { kind: string; id: string; rect?: { x: number; y: number; width: number; height: number }; plate?: { x: number; y: number; width: number; height: number } }[];
}

/** Read the effects and the labels together every 250 ms for `ms`. */
async function sampleManyLabels(page: Page, ms: number): Promise<LabelSample[]> {
  const out: LabelSample[] = [];
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const d = await sceneDebug(page);
    out.push({ particles: d.particleCount, haunts: d.fx.haunts, decor: d.fx.decor, labels: d.labels });
    await page.waitForTimeout(250);
  }
  return out;
}

for (const how of ["system", "toggle"] as const) {
  test.describe(`reduced motion by the ${how} setting`, () => {
    test.use({ viewport: { width: 1280, height: 720 } });

    test("4 everything on the map is still: the ghost stands at its first door, the doors and the details stay, and every loop room is lit", async ({ page }) => {
      test.setTimeout(60_000);
      if (how === "system") await page.emulateMedia({ reducedMotion: "reduce" });
      else {
        await page.emulateMedia({ reducedMotion: "no-preference" });
        await page.addInitScript(() => localStorage.setItem("hauntmap.prefs.v1", JSON.stringify({ version: 1, motion: "reduce", legendOpen: true, preset: "static-value" })));
      }
      await openManor(page);
      await expandAllWings(page);
      await settled(page);
      await expect.poll(async () => (await sceneDebug(page)).fx.loop !== null).toBe(true);
      const read = async (): Promise<unknown> => {
        const d = await sceneDebug(page);
        return { ghost: d.ghost, doors: d.fx.doors, loop: d.fx.loop, decor: d.fx.decor, motes: d.fx.motes, glowAlpha: d.glowAlpha, particles: d.particleCount, tweens: d.activeTweens };
      };
      const a = (await read()) as { ghost: { leg: number; x: number; y: number }; doors: HookFx["doors"]; loop: NonNullable<HookFx["loop"]>; decor: HookFx["decor"]; particles: number; tweens: number };
      await page.waitForTimeout(2500);
      const b = await read();
      expect(b, "nothing moved between two readings").toEqual(a);
      expect(a.ghost.leg, "the ghost stands at its first door").toBe(0);
      expect(a.loop.rooms.length).toBeGreaterThanOrEqual(3);
      for (const r of a.loop.rooms) {
        expect(r.lit, `${r.id} is lit`).toBe(true);
        expect(r.brightness).toBe(1);
      }
      expect(a.particles).toBe(0);
      expect(a.tweens).toBe(0);
      expect(a.doors.length).toBeGreaterThanOrEqual(3);
      for (const door of a.doors) expect(["open", "closed"]).toContain(door.state);
      // The drawn panels agree: no swing and no half-open panel. A door is open while the ghost stands on it and shut otherwise.
      const ghostAt = a.ghost;
      const boxes = (await sceneDebug(page)).fx.doorBoxes;
      expect(boxes.length).toBeGreaterThanOrEqual(10);
      let openCount = 0;
      for (const box of boxes) {
        const onIt = Math.hypot(ghostAt.x - box.x, ghostAt.y - box.y) <= box.w;
        expect([0, 1], `door ${box.relationId} is open or shut, never half open`).toContain(box.open);
        if (box.open === 1) {
          openCount++;
          expect(onIt, `door ${box.relationId} is open only while the ghost stands on it`).toBe(true);
          expect(box.openingPx, "an open door shows half its width or more").toBeGreaterThanOrEqual(box.widthPx / 2);
        } else expect(box.openingPx).toBe(0);
        if (onIt) expect(box.open, `door ${box.relationId} is open while the ghost stands on it`).toBe(1);
      }
      expect(openCount, "the door under the ghost is open").toBeGreaterThanOrEqual(1);
      const kinds = new Set(a.decor.map((e) => e.kind));
      for (const kind of ["web", "crack", "candle", "fog", "bat", "spider"]) expect(kinds.has(kind as never), `${kind} is drawn, standing still`).toBe(true);
    });
  });
}
