import { expect, test, type Page } from "@playwright/test";
import { compareAction } from "../compare/e2e/scene";
import { expandAllWings, openFixture, openManor, sceneDebug, settled, storeAction } from "./helpers";

// The theme pass (Costume Contest look), checked in the dev build at 1,280 x 720 with the scene's debug data:
// item 5 (names at least 12 CSS pixels), item 6 (titles under no room, a right column that hides nothing),
// item 4 (the ghost and the glow), item 1 (the three palettes) and item 3 (the texture cache).

async function revealLoop(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Dependency loops" }).click();
  await page.getByRole("list", { name: "Loops" }).getByRole("button").first().click();
  await settled(page);
  await expect.poll(async () => (await sceneDebug(page)).glow).toBe(true);
}

async function layoutOf(page: Page): Promise<{
  wings: { wing: string; x: number; y: number; w: number; h: number; expanded: boolean }[];
  rooms: { id: string; wing: string; x: number; y: number; w: number; h: number }[];
  doors: { relationId: string; x: number; y: number; w: number; h: number }[];
}> {
  return page.evaluate(() => JSON.parse(JSON.stringify((window as unknown as { __hauntmap: { store: { getState(): { layout: unknown } } } }).__hauntmap.store.getState().layout)));
}

test.describe("names and titles at the first fitted view (item 5)", () => {
  test("every wing title and every room name drawn is at least 12 CSS pixels tall on screen", async ({ page }) => {
    await openManor(page);
    await settled(page);
    await expect.poll(async () => (await sceneDebug(page)).activeTweens).toBe(0);
    const layout = await layoutOf(page);
    const debug = await sceneDebug(page);
    const titles = debug.labels.filter((l) => l.kind === "wing");
    expect(titles.map((l) => l.id).sort()).toEqual(layout.wings.map((w) => w.wing).sort());
    const names = debug.labels.filter((l) => l.kind === "room");
    expect(names.length).toBeGreaterThan(0);
    for (const label of [...titles, ...names]) {
      expect(label.text.trim(), `${label.kind} ${label.id} has words`).not.toBe("");
      expect(label.px, `${label.kind} ${label.id} "${label.text}" is ${label.px} px`).toBeGreaterThanOrEqual(12);
    }
  });

  test("zoomed in the names are the full words, zoomed out they are short", async ({ page }) => {
    await openManor(page);
    await settled(page);
    await expect.poll(async () => (await sceneDebug(page)).activeTweens).toBe(0);
    const fitted = (await sceneDebug(page)).labels.find((l) => l.kind === "room" && l.id === "src/orders/checkout.ts");
    expect(fitted).toBeDefined();
    await storeAction(page, "select", { kind: "module", id: "src/orders/checkout.ts" }, { from: "dom" });
    await expect.poll(async () => (await sceneDebug(page)).activeTweens).toBe(0);
    const near = (await sceneDebug(page)).labels.find((l) => l.kind === "room" && l.id === "src/orders/checkout.ts");
    expect(near?.text).toBe("checkout.ts");
    expect(near?.px ?? 0).toBeGreaterThanOrEqual(12);
  });
});

test.describe("titles and the right column (item 6)", () => {
  test("a wing title plate is above the rooms: no room starts inside the top 40 units of its wing", async ({ page }) => {
    await openManor(page);
    await settled(page);
    for (const wing of ["src/notifications", "src/payments"]) await storeAction(page, "expandWing", wing);
    await settled(page);
    const layout = await layoutOf(page);
    expect(layout.rooms.length).toBeGreaterThan(10);
    for (const room of layout.rooms) {
      const wing = layout.wings.find((w) => w.wing === room.wing);
      expect(wing).toBeDefined();
      expect(room.y - (wing?.y ?? 0), `${room.id} is under the plate of ${room.wing}`).toBeGreaterThanOrEqual(40);
    }
  });

  test("with a loop shown at 1,280 x 720 the right panel holds the steps and the inspector in one column that scrolls, and every line of the source excerpt can be scrolled to and is not covered", async ({ page }) => {
    await openManor(page);
    await settled(page);
    await revealLoop(page);
    const m = await page.evaluate(() => {
      const column = document.querySelector<HTMLElement>(".side-column");
      const lines = [...document.querySelectorAll<HTMLElement>(".excerpt li")];
      if (column === null || lines.length === 0) return null;
      const covered: string[] = [];
      for (const line of lines) {
        line.scrollIntoView({ block: "center" });
        const r = line.getBoundingClientRect();
        const c = column.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + 8, r.top + r.height / 2);
        if (r.top < c.top - 1 || r.bottom > c.bottom + 1 || top === null || !line.contains(top)) covered.push(line.textContent ?? "");
      }
      return { overflow: getComputedStyle(column).overflowY, height: column.getBoundingClientRect().height, scrollable: column.scrollHeight > column.clientHeight, lines: lines.length, covered };
    });
    expect(m).not.toBeNull();
    expect(["auto", "scroll"]).toContain(m?.overflow);
    expect(m?.height ?? 0).toBeGreaterThanOrEqual(190);
    expect(m?.scrollable).toBe(true);
    expect(m?.lines ?? 0).toBeGreaterThan(2);
    expect(m?.covered).toEqual([]);
  });
});test.describe("the ghost and the glow (item 4)", () => {
  test("with motion allowed the ghost walks the loop one leg for each 1,200 ms, in step order, and the particles stay at 40 or fewer", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openManor(page);
    await settled(page);
    await revealLoop(page);
    test.setTimeout(60_000);
    const legs: number[] = [];
    let positions = 0;
    let samples = 0;
    const started = Date.now();
    let last: { x: number; y: number } | null = null;
    // Sample until the ghost has walked a whole loop and come back to its first leg (or 40 s pass on a slow machine).
    while (legs.length < 4 && Date.now() - started < 40_000) {
      samples += 1;
      const d = await sceneDebug(page);
      expect(d.glow).toBe(true);
      expect(d.particleCount).toBeLessThanOrEqual(40);
      expect(d.ghost).not.toBeNull();
      const ghost = d.ghost as { leg: number; x: number; y: number };
      if (legs[legs.length - 1] !== ghost.leg) legs.push(ghost.leg);
      if (last === null || last.x !== ghost.x || last.y !== ghost.y) positions += 1;
      last = ghost;
      await page.waitForTimeout(100);
    }
    expect(positions, "the ghost moves between samples").toBeGreaterThan(samples / 2);
    // Every leg follows the one before it, and the loop wraps from the last leg to the first.
    for (let i = 1; i < legs.length; i++) expect(legs[i]).toBe(((legs[i - 1] as number) + 1) % 3);
    expect(legs.slice(0, 4)).toEqual([0, 1, 2, 0].map((_, i) => ((legs[0] as number) + i) % 3));
  });

  test("with reduced motion the ghost stands still at step 1, the glow is drawn, and nothing moves", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openManor(page);
    await settled(page);
    for (const wing of ["src/notifications", "src/payments"]) await storeAction(page, "expandWing", wing);
    await settled(page);
    await revealLoop(page);
    const first = await sceneDebug(page);
    expect(first.glow).toBe(true);
    expect(first.ghost?.leg).toBe(0);
    for (let i = 0; i < 8; i++) {
      await page.waitForTimeout(250);
      const d = await sceneDebug(page);
      expect(d.ghost).toEqual(first.ghost);
      expect(d.particleCount).toBe(0);
      expect(d.activeTweens).toBe(0);
    }
    const layout = await layoutOf(page);
    const relation = await page.evaluate(() => (window as unknown as { __hauntmap: { store: { getState(): { routeFilter: { relationIds: string[] } } } } }).__hauntmap.store.getState().routeFilter.relationIds[0]);
    const door = layout.doors.find((d) => d.relationId === relation);
    expect(door).toBeDefined();
    expect(first.ghost?.x).toBeCloseTo((door?.x ?? 0) + (door?.w ?? 0) / 2, 5);
    expect(first.ghost?.y).toBeCloseTo((door?.y ?? 0) + (door?.h ?? 0) / 2, 5);
  });

  test("the loop is shown from the start: a glowing corridor and a ghost, with no selection, no route filter and no step done", async ({ page }) => {
    await openManor(page);
    await settled(page);
    await expect.poll(async () => (await sceneDebug(page)).glow).toBe(true);
    const d = await sceneDebug(page);
    expect(d.ghost).not.toBeNull();
    expect(d.glowAlpha).not.toBeNull();
    const state = await page.evaluate(() => {
      const s = (window as unknown as { __hauntmap: { store: { getState(): { selection: unknown; routeFilter: unknown; steps: { steps: { status: string }[] } } } } }).__hauntmap.store.getState();
      return { selection: s.selection, routeFilter: s.routeFilter, statuses: s.steps.steps.map((x) => x.status) };
    });
    expect(state.selection).toEqual({ kind: "none" });
    expect(state.routeFilter).toBeNull();
    expect(state.statuses.every((s) => s === "todo")).toBe(true);
  });

  test("no ghost and no glow in an investigation without a loop", async ({ page }) => {
    await openFixture(page, "triad");
    await settled(page);
    const d = await sceneDebug(page);
    expect(d.ghost).toBeNull();
    expect(d.glow).toBe(false);
    expect(d.glowAlpha).toBeNull();
  });
});
test.describe("the three palettes and the texture cache (items 1 and 3)", () => {
  test("setTheme changes the page tokens and the scene, the texture count stays at 24 or fewer, and the default is Candlelit manor", async ({ page }) => {
    await openManor(page);
    await settled(page);
    await revealLoop(page);
    expect((await sceneDebug(page)).theme).toBe("candlelit-manor");
    const door = (): Promise<string> => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--door").trim());
    const doorA = await door();
    for (const name of ["moonlit-crypt", "graveyard-fog", "candlelit-manor"] as const) {
      await page.evaluate((theme) => (window as unknown as { __hauntmap: { setTheme(n: string): void } }).__hauntmap.setTheme(theme), name);
      await page.waitForTimeout(150);
      const d = await sceneDebug(page);
      expect(d.theme).toBe(name);
      expect(d.textureCount).toBeLessThanOrEqual(24);
      expect(await page.evaluate(() => document.documentElement.dataset["theme"])).toBe(name);
      if (name === "candlelit-manor") expect(await door()).toBe(doorA);
      else expect(await door()).not.toBe(doorA);
    }
  });
});

// Every text the scene draws, not only names: wing titles, room names, the import counts on
// the corridors, the step numbers, and the `+` and `?` marks. Each is at least 12 CSS pixels on screen or is not drawn at that zoom.
/** The `0` key on the focused map fits every wing in the view. */
async function fitMap(page: Page): Promise<void> {
  await page.getByRole("application", { name: "Haunted map" }).focus();
  await page.keyboard.press("0");
  await expect.poll(async () => (await sceneDebug(page)).activeTweens).toBe(0);
}

async function everyTextAtLeast12(page: Page, what: string): Promise<Awaited<ReturnType<typeof sceneDebug>>["labels"]> {
  await expect.poll(async () => (await sceneDebug(page)).activeTweens).toBe(0);
  const labels = (await sceneDebug(page)).labels;
  for (const label of labels) expect(label.px, `${what}: ${label.kind} ${label.id} "${label.text}" is ${label.px} px`).toBeGreaterThanOrEqual(12);
  return labels;
}

for (const size of [
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
]) {
  test.describe(`every drawn text at ${size.width} x ${size.height} (item 5)`, () => {
    test.use({ viewport: size });

    test("subdued rooms: no text under 12 px, and the words `Not in this traversal` are not drawn in the room at any zoom (design pass 2, item 3)", async ({ page }) => {
      await openManor(page);
      await expandAllWings(page);
      await settled(page);
      await storeAction(page, "focusModule", "src/shared/money.ts");
      await settled(page);
      await expect.poll(async () => (await sceneDebug(page)).activeTweens).toBe(0);
      await fitMap(page);
      const fitted = await everyTextAtLeast12(page, "fitted");
      expect(fitted.filter((l) => l.kind === "room").length).toBeGreaterThan(0);
      expect(fitted.filter((l) => l.kind === "note")).toEqual([]);
      const layout = await layoutOf(page);
      const sample = layout.rooms[0] as { x: number; y: number; w: number; h: number };
      await storeAction(page, "setCamera", { x: sample.x + sample.w / 2, y: sample.y + sample.h / 2, zoom: 2.5 });
      const near = await everyTextAtLeast12(page, "zoomed in");
      // The cue that is not colour alone stays: a subdued room is drawn at reduced opacity with a dotted rail, and the legend names it.
      expect(near.filter((l) => l.kind === "note")).toEqual([]);
      expect(near.filter((l) => l.text.includes("Not in this")), "no room carries the words").toEqual([]);
      expect(near.filter((l) => l.kind === "room").length).toBeGreaterThan(0);
      await expect(page.getByRole("list", { name: "Legend entries" })).toContainText("Not in this traversal: subdued room");
    });
    test("a loop shown and a comparison: step numbers, import counts and the + and ? marks are 12 px or more, or not drawn", async ({ page }) => {
      await openManor(page);
      await settled(page);
      await revealLoop(page);
      const loop = await everyTextAtLeast12(page, "loop view");
      expect(loop.filter((l) => l.kind === "step").length, "step numbers are drawn").toBeGreaterThan(0);
      await fitMap(page);
      const fitted = await everyTextAtLeast12(page, "loop at the fitted view");
      expect(fitted.filter((l) => l.kind === "step").length, "step numbers are drawn at the fitted view too").toBeGreaterThan(0);
      const wing = (await layoutOf(page)).wings[0] as { x: number; y: number; w: number; h: number };
      await storeAction(page, "setCamera", { x: wing.x + wing.w / 2, y: wing.y + wing.h / 2, zoom: 1.6 });
      const near = await everyTextAtLeast12(page, "loop zoomed in");
      expect(near.filter((l) => l.kind === "count").length, "import counts are drawn when zoomed in").toBeGreaterThan(0);
      await compareAction(page, "compareWithSample");
      await page.waitForFunction(() => /^Comparison ready/.test(document.querySelector('[role="status"]')?.textContent ?? ""));
      await expandAllWings(page);
      await fitMap(page);
      const compared = await everyTextAtLeast12(page, "comparison at the fitted view");
      const glyphs = compared.filter((l) => l.kind === "glyph").map((l) => l.text);
      expect(glyphs, "the + of the added door is drawn").toContain("+");
      expect(glyphs, "the ? of a sealed doorway is drawn").toContain("?");
    });
  });
}
