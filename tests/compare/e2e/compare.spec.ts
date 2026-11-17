import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_ANALYSIS_OPTIONS, selectSources } from "../../../src/analysis";
import { assertFocusVisibleAndUnobscured, expandAllWings, focusedName, openManor, readStatus, sceneDebug, settled, shot, snapshot, storeAction } from "../../e2e/helpers";
import { READY_MANOR_PAIR, roomRects, waitForStatus, waitForStatusStart, wingNames, wingRects, sceneStates } from "./helpers";
import { camera, compareAction, compareView, fixtureJson, hookCompareWith, liveFromNewer, sampleTweens } from "./scene";

const RECEIPT = "src/notifications/receipt.ts";
const CHECKOUT = "src/orders/checkout.ts";
const REMOVED = JSON.stringify([RECEIPT, ["local", CHECKOUT], "import", "value"]);
const ADDED = JSON.stringify([RECEIPT, ["local", "src/orders/summary.ts"], "import", "value"]);

/** Every drawn room ID of the open layout. */
async function drawnRoomIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const hook = (window as unknown as { __hauntmap?: { store: { getState(): { layout: { rooms: { id: string }[] } | null } } } }).__hauntmap;
    return hook?.store.getState().layout?.rooms.map((r) => r.id) ?? [];
  });
}

/**
 * Screen rectangles relative to the center of the map area. The camera keeps the scene point at that center, and
 * the map area changes height during a comparison without any room moving: the legend lists three more entries
 * (5.3, 12.5 px measured at 1,280 x 720) and the status region grows by 1 px for the ready message. Measured from
 * the center, a rectangle changes only when its room or wing moves in the scene.
 */
async function fromMapCenter(page: Page, rects: Record<string, { x: number; y: number; width: number; height: number } | null>) {
  const box = await page.evaluate(() => {
    const r = document.querySelector(".map-wrapper")?.getBoundingClientRect();
    if (r === undefined) throw new Error("no map wrapper");
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  });
  const round = (n: number): number => Math.round(n * 100) / 100;
  return Object.fromEntries(
    Object.entries(rects).map(([id, r]) => [id, r === null ? null : { x: round(r.x - box.cx), y: round(r.y - box.cy), width: round(r.width), height: round(r.height) }]),
  );
}

/** The scene-unit boxes of every room and wing of the store's layout. */
async function layoutBoxes(page: Page) {
  return page.evaluate(() => {
    type L = { rooms: { id: string; x: number; y: number; w: number; h: number }[]; wings: { wing: string; x: number; y: number; w: number; h: number }[] };
    const layout = (window as unknown as { __hauntmap: { store: { getState(): { layout: L | null } } } }).__hauntmap.store.getState().layout;
    if (layout === null) throw new Error("no layout");
    return { rooms: layout.rooms.map((r) => [r.id, r.x, r.y, r.w, r.h]), wings: layout.wings.map((w) => [w.wing, w.x, w.y, w.w, w.h]) };
  });
}

/** Room and wing rectangles; a room or wing that is not drawn fails the case. */
async function rectangles(page: Page, rooms: string[], wings: string[]) {
  const r = await roomRects(page, rooms);
  const w = await wingRects(page, wings);
  for (const [id, rect] of [...Object.entries(r), ...Object.entries(w)]) expect(rect, `${id} has a rectangle`).not.toBeNull();
  return { rooms: await fromMapCenter(page, r), wings: await fromMapCenter(page, w) };
}

// The comparison journeys run in the `dev` project (the build made with `--mode devhook`). Tasks 11 and 12
// of the snapshot-comparison spec fill the scene, panel, keyboard and failure cases.

/** A live-shaped snapshot: the open investigation with the label `live:samples/manor` and one changed hash. */
async function compareWithLive(page: Page): Promise<void> {
  await page.evaluate(async () => {
    type Hook = { store: { getState(): { investigation: { sourceLabel: string; modules: { id: string; sourceHash: string }[] } } }; compareWith(after: unknown, layoutKey?: string | null): Promise<void> };
    const hook = (window as unknown as { __hauntmap?: Hook }).__hauntmap;
    if (hook === undefined) throw new Error("window.__hauntmap is missing");
    const inv = hook.store.getState().investigation;
    const live = { ...inv, sourceLabel: "live:samples/manor", modules: inv.modules.map((m, i) => (i === 0 ? { ...m, sourceHash: "d".repeat(64) } : m)) };
    await hook.compareWith(live);
  });
}

test.describe("comparison wiring (task 10)", () => {
  test("10 the development hook's compareWith compares a live-shaped snapshot and the status region says it is ready", async ({ page }) => {
    await openManor(page);
    await compareWithLive(page);
    const status = await waitForStatusStart(page, "Comparison ready: ");
    expect(status).toBe("Comparison ready: 0 removed, 0 added, 1 changed modules; loops 1 \u2192 1. Showing the newer snapshot.");
    expect(await page.evaluate(() => typeof (window as unknown as { __hauntmap?: { compareStore?: unknown } }).__hauntmap?.compareStore)).toBe("object");
    expect(await readStatus(page)).toBe(status);
  });
});

/** The view state that a failed comparison must leave as it was (status aside), read through the hook. */
async function kept(page: Page) {
  const s = await snapshot(page);
  return { camera: s.camera, selection: s.selection, routeFilter: s.routeFilter, expandedWings: s.expandedWings, layout: s.layout, label: await page.evaluate(() => (window as unknown as { __hauntmap: { store: { getState(): { investigation: { sourceLabel: string } | null } } } }).__hauntmap.store.getState().investigation?.sourceLabel) };
}

/** Press Tab until the focused element has this name, checking the focus ring after every press (7.6). */
async function tabWithRing(page: Page, name: string): Promise<void> {
  for (let presses = 0; presses < 120; presses++) {
    if ((await focusedName(page)) === name) return;
    await page.keyboard.press("Tab");
    await assertFocusVisibleAndUnobscured(page);
  }
  throw new Error(`no element named "${name}" received focus`);
}

const PAIR_SENTENCE = "Replaces the current investigation with manor/before and compares it with manor/after.";

async function openAnnex(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore the annex" }).click();
  // The annex opens with every wing collapsed, so no room is drawn and `hauntmap:usable` is not marked.
  await page.waitForFunction(() => {
    const s = (window as unknown as { __hauntmap?: { store: { getState(): { investigation: { sourceLabel: string } | null; layoutStatus: string; layout: unknown } } } }).__hauntmap?.store.getState();
    return s?.investigation?.sourceLabel === "annex" && s.layoutStatus === "idle" && s.layout !== null;
  });
}

test.describe("comparison panel, keyboard and failure journeys", () => {
  test("1.1 the panel on the manor offers Revised manor sample; on the annex Bundled manor pair", async ({ page }) => {
    await openManor(page);
    const control = page.getByRole("button", { name: "Compare revisions" });
    await expect(control).toHaveAttribute("aria-expanded", "false");
    await control.click();
    await expect(control).toHaveAttribute("aria-expanded", "true");
    const panel = page.getByRole("region", { name: "Compare revisions" });
    await expect(panel.getByText("Compare manor/before with a newer snapshot.", { exact: true })).toBeVisible();
    await expect(panel.getByRole("button")).toHaveText(["Revised manor sample"]);
    await openAnnex(page);
    await page.getByRole("button", { name: "Compare revisions" }).click();
    await expect(panel.getByText("Compare annex with a newer snapshot.", { exact: true })).toBeVisible();
    await expect(panel.getByRole("button")).toHaveText(["Bundled manor pair"]);
    await expect(panel.getByText(PAIR_SENTENCE, { exact: true })).toBeVisible();
  });

  test("1.2 and 6.1 Revised manor sample: one sources.json request, nothing fetched after it, the exact ready status", async ({ page }) => {
    await openManor(page);
    await page.getByRole("button", { name: "Compare revisions" }).click();
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    await page.getByRole("button", { name: "Revised manor sample" }).click();
    await waitForStatus(page, READY_MANOR_PAIR);
    const paths = requests.map((url) => new URL(url).pathname);
    expect(paths.filter((p) => p.endsWith("/demo/manor/after/sources.json"))).toHaveLength(1);
    const after = paths.slice(paths.findIndex((p) => p.endsWith("/demo/manor/after/sources.json")) + 1);
    expect(after).toEqual([]);
    expect(paths).toEqual(["/demo/manor/after/sources.json"]);
  });

  test("1.3 Bundled manor pair from the annex opens manor/before and compares it with manor/after", async ({ page }) => {
    await openAnnex(page);
    await page.getByRole("button", { name: "Compare revisions" }).click();
    await page.getByRole("button", { name: "Bundled manor pair" }).click();
    await waitForStatus(page, READY_MANOR_PAIR);
    const view = await compareView(page);
    expect(view.status).toBe("active");
    expect(view.removed).toEqual([REMOVED]);
    const panel = page.getByRole("region", { name: "Compare revisions" });
    await expect(panel.getByText("Earlier: manor/before \u00b7 40 modules \u00b7 72 relations", { exact: true })).toBeVisible();
    await expect(panel.getByText("Newer: manor/after \u00b7 40 modules \u00b7 72 relations", { exact: true })).toBeVisible();
  });

  test("6.2 the loops panel reads 1 loops for the earlier snapshot and 0 loops for the newer one; 6.6 End comparison", async ({ page }) => {
    await openManor(page);
    await page.getByRole("button", { name: "Compare revisions" }).click();
    await page.getByRole("button", { name: "Revised manor sample" }).click();
    await waitForStatus(page, READY_MANOR_PAIR);
    await storeAction(page, "openLoops");
    const loops = page.getByRole("region", { name: "Dependency loops (static-value)" });
    await expect(loops.getByText("0 loops", { exact: true })).toBeVisible();
    await page.getByRole("radio", { name: "Earlier (manor/before)" }).check();
    await waitForStatus(page, "Showing the earlier snapshot (manor/before).");
    await expect(loops.getByText("1 loops", { exact: true })).toBeVisible();
    await page.getByRole("radio", { name: "Newer (manor/after)" }).check();
    await waitForStatus(page, "Showing the newer snapshot (manor/after).");
    await expect(loops.getByText("0 loops", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "End comparison" }).click();
    await waitForStatus(page, "Comparison ended. Showing manor/before.");
    await expect(loops.getByText("1 loops", { exact: true })).toBeVisible();
    expect((await compareView(page)).status).toBe("idle");
    await expect(page.getByRole("button", { name: "Compare revisions" })).toBeFocused();
  });

  test("7.6 the keyboard-only journey with a visible, unobscured focus ring after every Tab", async ({ page }) => {
    await openManor(page);
    await tabWithRing(page, "Compare revisions");
    await page.keyboard.press("Enter");
    await tabWithRing(page, "Revised manor sample");
    await page.keyboard.press("Enter");
    await waitForStatus(page, READY_MANOR_PAIR);
    await tabWithRing(page, "Newer (manor/after)");
    await page.keyboard.press("ArrowLeft");
    expect(await focusedName(page)).toBe("Earlier (manor/before)");
    await waitForStatus(page, "Showing the earlier snapshot (manor/before).");
    await page.keyboard.press("ArrowRight");
    expect(await focusedName(page)).toBe("Newer (manor/after)");
    await waitForStatus(page, "Showing the newer snapshot (manor/after).");
    await tabWithRing(page, "src/notifications/receipt.ts imports src/orders/checkout.ts \u00b7 import \u00b7 value");
    await page.keyboard.press("Enter");
    const card = page.getByRole("region", { name: "Selected change" });
    await expect(card.getByText("Removed in manor/after", { exact: true })).toBeVisible();
    expect(await focusedName(page)).toBe("src/notifications/receipt.ts imports src/orders/checkout.ts \u00b7 import \u00b7 value");
    await tabWithRing(page, "End comparison");
    await page.keyboard.press("Enter");
    await waitForStatus(page, "Comparison ended. Showing manor/before.");
  });

  test("14 the acceptance screenshots of the newer and the earlier snapshot (written only with HAUNTMAP_SHOTS=1)", async ({ page }) => {
    await openManor(page);
    await expandAllWings(page);
    await page.getByRole("button", { name: "Compare revisions" }).click();
    await page.getByRole("button", { name: "Revised manor sample" }).click();
    await waitForStatus(page, READY_MANOR_PAIR);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => (window as unknown as { __hauntmap: { scene(): { debug(): { activeTweens: number } } } }).__hauntmap.scene().debug().activeTweens === 0);
    await shot(page, "docs/acceptance/img/compare-newer.png");
    await compareAction(page, "show", "before");
    await waitForStatus(page, "Showing the earlier snapshot (manor/before).");
    await page.waitForFunction(() => (window as unknown as { __hauntmap: { scene(): { debug(): { activeTweens: number } } } }).__hauntmap.scene().debug().activeTweens === 0);
    await shot(page, "docs/acceptance/img/compare-earlier.png");
    expect((await compareView(page)).shown).toBe("before");
  });

  test("7.7 the escaped pair through the hook: the module ID and specifier appear verbatim and no img exists", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => (window as unknown as { __hauntmap?: unknown }).__hauntmap !== undefined);
    await page.evaluate((inv) => (window as unknown as { __hauntmap: { openInvestigation(i: unknown): void } }).__hauntmap.openInvestigation(inv), fixtureJson("escaped", "before"));
    await settled(page);
    expect(await hookCompareWith(page, fixtureJson("escaped", "after"))).toBeNull();
    await page.getByRole("button", { name: "Compare revisions" }).click();
    const panel = page.getByRole("region", { name: "Compare revisions" });
    await expect(panel.getByRole("button", { name: 'src/a&b.ts \u2192 "./<img src=x onerror=alert(1)>" \u00b7 unresolved' })).toBeVisible();
    await expect(panel.getByRole("button", { name: "src/a&b.ts \u00b7 import statements 0 \u2192 1 \u00b7 0 relations removed, 1 added" })).toBeVisible();
    expect(await page.evaluate(() => document.querySelector("img") === null)).toBe(true);
  });

  test("10.1 a routed HTTP 500 for manor/after: the exact message, focus kept, and the view state unchanged", async ({ page }) => {
    await openManor(page);
    await storeAction(page, "select", { kind: "module", id: CHECKOUT }, { from: "dom" });
    await settled(page);
    await page.route("**/demo/manor/after/sources.json", (route) => route.fulfill({ status: 500, body: "error" }));
    await page.getByRole("button", { name: "Compare revisions" }).click();
    await page.waitForTimeout(400);
    const before = await kept(page);
    const button = page.getByRole("button", { name: "Revised manor sample" });
    await button.click();
    await waitForStatus(page, "The revised manor sample could not be loaded (500). The current investigation is unchanged.");
    expect(await kept(page)).toEqual(before);
    await expect(button).toBeFocused();
    await expect(button).toHaveAttribute("aria-disabled", "false");
    expect((await compareView(page)).status).toBe("idle");
  });

  test("10.2 an analysis that rejects (the file cap of the worker): the exact message and the view state unchanged", async ({ page }) => {
    const files = Array.from({ length: DEFAULT_ANALYSIS_OPTIONS.maxFiles + 1 }, (_, i) => ({ path: `src/f${String(i).padStart(4, "0")}.ts`, text: "export {};\n" }));
    const selected = selectSources(
      files.map((f) => ({ ...f, bytes: Buffer.byteLength(f.text, "utf8") })),
      "manor/after",
      DEFAULT_ANALYSIS_OPTIONS,
    );
    if (selected.ok) throw new Error("the stub must exceed the file cap");
    const detail = selected.diagnostics.map((d) => `${d.code}: ${d.message}`).join(" ");
    await openManor(page);
    await settled(page);
    await page.route("**/demo/manor/after/sources.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ files }) }));
    const before = await kept(page);
    await compareAction(page, "compareWithSample");
    await waitForStatus(page, `The newer snapshot could not be analyzed (${detail}). The current investigation is unchanged.`);
    expect(await kept(page)).toEqual(before);
    expect((await compareView(page)).status).toBe("idle");
  });
});

test.describe("comparison scene journeys", () => {
  for (const mode of ["every wing expanded", "only src/orders expanded"] as const) {
    test(`4.8 @scene ${mode}: rooms and wings keep their rectangles before, while the newer and while the earlier snapshot is shown`, async ({ page }) => {
      await openManor(page);
      if (mode === "every wing expanded") await expandAllWings(page);
      await settled(page);
      const boxes = await layoutBoxes(page);
      const rooms = await drawnRoomIds(page);
      if (mode === "every wing expanded") expect(rooms).toHaveLength(40);
      else expect(rooms.length).toBeGreaterThan(0);
      const wings = await wingNames(page);
      const first = await rectangles(page, rooms, wings);
      await compareAction(page, "compareWithSample");
      await waitForStatus(page, READY_MANOR_PAIR);
      expect(await readStatus(page)).not.toMatch(/rooms moved/);
      expect((await compareView(page)).layoutPath).toBe("extended");
      expect(await rectangles(page, rooms, wings)).toEqual(first);
      await compareAction(page, "show", "before");
      expect(await rectangles(page, rooms, wings)).toEqual(first);
      await compareAction(page, "show", "after");
      expect(await rectangles(page, rooms, wings)).toEqual(first);
      expect(await drawnRoomIds(page)).toEqual(rooms);
      expect(await layoutBoxes(page)).toEqual(boxes);
    });
  }

  test("5.1 @scene the removed door, the added door and the two changed rooms report their comparison states", async ({ page }) => {
    await openManor(page);
    await expandAllWings(page);
    await compareAction(page, "compareWithSample");
    await waitForStatus(page, READY_MANOR_PAIR);
    const states = await sceneStates(page);
    expect(states[REMOVED]).toBe("comparison-removed");
    expect(states[ADDED]).toBe("comparison-added");
    expect(states[RECEIPT]).toBe("comparison-changed");
    expect(states[CHECKOUT]).toBe("comparison-changed");
    expect(states["src/orders/summary.ts"]).toBe("default");
    await compareAction(page, "show", "before");
    const earlier = await sceneStates(page);
    expect(earlier[REMOVED]).toBe("default");
    expect(earlier[ADDED]).toBe("hidden");
    expect(earlier[RECEIPT]).toBe("comparison-changed");
  });

  test("5.1 @scene the cycle-closes pair loaded through the hook ghosts the y to x door", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => (window as unknown as { __hauntmap?: unknown }).__hauntmap !== undefined);
    await page.evaluate((inv) => (window as unknown as { __hauntmap: { openInvestigation(i: unknown): void } }).__hauntmap.openInvestigation(inv), fixtureJson("cycle-closes", "before"));
    await settled(page);
    await storeAction(page, "expandWing", "src");
    await settled(page);
    expect(await hookCompareWith(page, fixtureJson("cycle-closes", "after"))).toBeNull();
    const yx = JSON.stringify(["src/y.ts", ["local", "src/x.ts"], "import", "value"]);
    expect((await sceneStates(page))[yx]).toBe("comparison-removed");
  });

  test("5.3 @scene the three legend entries are listed only while the comparison is active", async ({ page }) => {
    await openManor(page);
    const legend = page.getByRole("list", { name: "Legend entries" });
    const entries = ["Changed source \u2014 amber lamp", "Removed in the newer snapshot \u2014 ghost outline", "Added in the newer snapshot \u2014 green doorway"];
    if ((await legend.count()) === 0) await page.getByRole("button", { name: "Legend" }).click();
    for (const e of entries) await expect(legend.getByText(e, { exact: true })).toHaveCount(0);
    await compareAction(page, "compareWithSample");
    await waitForStatus(page, READY_MANOR_PAIR);
    for (const e of entries) await expect(legend.getByText(e, { exact: true })).toHaveCount(1);
    await compareAction(page, "end");
    await waitForStatus(page, "Comparison ended. Showing manor/before.");
    for (const e of entries) await expect(legend.getByText(e, { exact: true })).toHaveCount(0);
  });

  test("6.3 @scene choosing the manor loop and comparing closes the corridor: tweens back to 0 within 700 ms, rooms unmoved", async ({ page }) => {
    await openManor(page);
    await expandAllWings(page);
    await storeAction(page, "openLoops");
    await storeAction(page, "chooseLoop", 0);
    await settled(page);
    await page.waitForFunction(() => (window as unknown as { __hauntmap: { scene(): { debug(): { activeTweens: number } } } }).__hauntmap.scene().debug().activeTweens === 0);
    const rooms = await drawnRoomIds(page);
    const wings = await wingNames(page);
    const first = await rectangles(page, rooms, wings);
    const measured = await page.evaluate(async () => {
      type Hook = { compareStore: { actions: { compareWithSample(): Promise<void> } }; scene(): { debug(): { activeTweens: number } } };
      const hook = (window as unknown as { __hauntmap: Hook }).__hauntmap;
      await hook.compareStore.actions.compareWithSample();
      const t0 = performance.now();
      let max = 0;
      for (;;) {
        await new Promise((r) => setTimeout(r, 20));
        const n = hook.scene().debug().activeTweens;
        max = Math.max(max, n);
        if (n === 0 && performance.now() - t0 > 60) return { max, ms: performance.now() - t0 };
        if (performance.now() - t0 > 3000) return { max, ms: performance.now() - t0 };
      }
    });
    expect(measured.max, "the closing corridor ran as a tween").toBeGreaterThan(0);
    expect(measured.ms).toBeLessThanOrEqual(700);
    const view = await compareView(page);
    expect(view.closingRelationIds).toEqual([REMOVED]);
    const debug = await sceneDebug(page);
    expect(debug.particleCount).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __hauntmap: { store: { getState(): { routeFilter: unknown } } } }).__hauntmap.store.getState().routeFilter)).toBeNull();
    expect(await rectangles(page, rooms, wings)).toEqual(first);
    expect((await sceneStates(page))[REMOVED]).toBe("comparison-removed");
  });

  for (const how of ["emulated prefers-reduced-motion", "the Motion toggle set to Reduce"] as const) {
    test(`6.4 @scene with ${how} no tween exists at any 250 ms sample`, async ({ page }) => {
      if (how === "emulated prefers-reduced-motion") await page.emulateMedia({ reducedMotion: "reduce" });
      await openManor(page);
      if (how === "the Motion toggle set to Reduce") await storeAction(page, "setMotion", "reduce");
      await expandAllWings(page);
      await storeAction(page, "openLoops");
      await storeAction(page, "chooseLoop", 0);
      await settled(page);
      const samples = sampleTweens(page, 1500, 250);
      await compareAction(page, "compareWithSample");
      const seen = await samples;
      await waitForStatus(page, READY_MANOR_PAIR);
      expect(seen.length).toBeGreaterThanOrEqual(6);
      expect(seen.every((n) => n === 0)).toBe(true);
      await compareAction(page, "show", "before");
      await compareAction(page, "show", "after");
      expect((await sampleTweens(page, 500, 250)).every((n) => n === 0)).toBe(true);
    });
  }

  test("6.5 @scene a focus filter without a removed relation survives the toggle, and the camera stays", async ({ page }) => {
    await openManor(page);
    await expandAllWings(page);
    await storeAction(page, "focusModule", "src/shared/money.ts");
    await storeAction(page, "setCamera", { x: 120, y: 80, zoom: 1.25 });
    const filter = await page.evaluate(() => (window as unknown as { __hauntmap: { store: { getState(): { routeFilter: unknown } } } }).__hauntmap.store.getState().routeFilter);
    expect(filter).not.toBeNull();
    await compareAction(page, "compareWithSample");
    await waitForStatus(page, READY_MANOR_PAIR);
    const read = () => page.evaluate(() => (window as unknown as { __hauntmap: { store: { getState(): { routeFilter: unknown } } } }).__hauntmap.store.getState().routeFilter);
    expect(await read()).toEqual(filter);
    expect(await camera(page)).toEqual({ x: 120, y: 80, zoom: 1.25 });
    await compareAction(page, "show", "before");
    expect(await read()).toEqual(filter);
    expect(await camera(page)).toEqual({ x: 120, y: 80, zoom: 1.25 });
    await compareAction(page, "show", "after");
    expect(await read()).toEqual(filter);
  });

  test("6.8 @scene a second compareWith with a hand-built live snapshot keeps every rectangle and ghosts the removed door", async ({ page }) => {
    await openManor(page);
    await expandAllWings(page);
    const rooms = await drawnRoomIds(page);
    const wings = await wingNames(page);
    const first = await rectangles(page, rooms, wings);
    await compareAction(page, "compareWithSample");
    await waitForStatus(page, READY_MANOR_PAIR);
    const live = await liveFromNewer(page, "live:samples/manor");
    expect(await hookCompareWith(page, live)).toBeNull();
    const view = await compareView(page);
    expect(view.status).toBe("active");
    expect(view.layoutPath).toBe("extended");
    expect(view.removed).toEqual([REMOVED]);
    expect(await rectangles(page, rooms, wings)).toEqual(first);
    expect((await sceneStates(page))[REMOVED]).toBe("comparison-removed");
    expect(await readStatus(page)).toBe(READY_MANOR_PAIR);
  });
});