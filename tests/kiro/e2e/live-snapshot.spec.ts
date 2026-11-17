import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";
import { expandAllWings, focusedName, openManor, readStatus, sceneDebug, settled, snapshot, storeAction } from "../../e2e/helpers";
import type { HookRect } from "../../e2e/helpers";
import { openComparePanel, roomRects, wingNames, wingRects, sceneStates } from "../../compare/e2e/helpers";

// Requirements 8.1 to 8.7 and 8.9: the Open live snapshot journey in the `dev` Playwright project (the build
// made with `--mode devhook`, where `window.__hauntmap` exists, including the comparison feature's
// `compareStore`). The fixtures are the files of tests/kiro/fixtures/live.

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "live");
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), "utf8");

// The status region renders the backtick segment as <code>, so its text has no backticks.
const MISSING = "No live snapshot yet. Run pnpm hauntmap analyze samples/manor --out public/demo/live.json, or let the Kiro hook write it.";
const MISSING_COMMAND = "pnpm hauntmap analyze samples/manor --out public/demo/live.json";
const LOADED = "Live snapshot loaded: live:samples/manor (40 modules) is the newer snapshot; manor/before is the older one.";
const NO_SOURCE = "Source not included in this snapshot; evidence is path, line and specifier.";
const RECEIPT = "src/notifications/receipt.ts";
const CHECKOUT = "src/orders/checkout.ts";
const DEMO_RELATION = JSON.stringify([RECEIPT, ["local", CHECKOUT], "import", "value"]);

type Hook = { compareStore: { getState(): { result: { removedRelations: { relationId: string }[]; addedRelations: unknown[] } | null } } };

const routeValid = (route: Route): Promise<void> => route.fulfill({ status: 200, contentType: "application/json", body: fixture("valid-live.json") });

async function stateWithoutStatus(page: Page): Promise<unknown> {
  const copy: Partial<Awaited<ReturnType<typeof snapshot>>> = { ...(await snapshot(page)) };
  delete copy.status;
  return copy;
}

const openLive = (page: Page): Promise<void> => page.getByRole("button", { name: "Open live snapshot" }).click();
const status = (page: Page) => page.getByRole("status");

/** Rectangles relative to the center of the map area (the legend grows during a comparison, which resizes the area). */
async function fromMapCenter(page: Page, rects: Record<string, HookRect | null>): Promise<Record<string, unknown>> {
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

async function drawnRoomIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const hook = (window as unknown as { __hauntmap: { store: { getState(): { layout: { rooms: { id: string }[] } | null } } } }).__hauntmap;
    return hook.store.getState().layout?.rooms.map((r) => r.id) ?? [];
  });
}

async function rectangles(page: Page, rooms: string[], wings: string[]): Promise<{ rooms: unknown; wings: unknown }> {
  const r = await roomRects(page, rooms);
  const w = await wingRects(page, wings);
  for (const [id, rect] of [...Object.entries(r), ...Object.entries(w)]) expect(rect, `${id} has a rectangle`).not.toBeNull();
  return { rooms: await fromMapCenter(page, r), wings: await fromMapCenter(page, w) };
}

async function activeTweensIsZero(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as unknown as { __hauntmap: { scene(): { debug(): { activeTweens: number } } } }).__hauntmap.scene().debug().activeTweens === 0);
}

test.describe("Open live snapshot", () => {
  test("8.1 Tab order: Open live snapshot comes right after Compare revisions", async ({ page }) => {
    await openManor(page);
    const compare = page.getByRole("button", { name: "Compare revisions" });
    await compare.focus();
    await page.keyboard.press("Tab");
    expect(await focusedName(page)).toBe("Open live snapshot");
  });

  for (const [name, respond] of [
    ["404", (route: Route) => route.fulfill({ status: 404, body: "not found" })],
    ["hosting fallback", (route: Route) => route.fulfill({ status: 200, contentType: "text/html", body: fixture("fallback.html") })],
  ] as const) {
    test(`8.3 ${name} shows the missing message with the command in <code> and changes nothing else`, async ({ page }) => {
      await page.route("**/demo/live.json*", respond);
      await openManor(page);
      const before = await stateWithoutStatus(page);
      await openLive(page);
      await expect(status(page)).toHaveText(MISSING);
      await expect(status(page).locator("code")).toHaveText(MISSING_COMMAND);
      expect(await stateWithoutStatus(page)).toEqual(before);
    });
  }

  test("8.4 a document with schemaVersion 2 is reported and the view is unchanged", async ({ page }) => {
    await page.route("**/demo/live.json*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: fixture("malformed-live.json") }));
    await openManor(page);
    const before = await stateWithoutStatus(page);
    await openLive(page);
    await expect(status(page)).toHaveText("The live snapshot at demo/live.json is not valid: schemaVersion must be 1 (found 2). The current view is unchanged.");
    expect(await stateWithoutStatus(page)).toEqual(before);
  });

  test("8.4 truncated JSON is reported as not JSON and the view is unchanged", async ({ page }) => {
    await page.route("**/demo/live.json*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: fixture("not-json-live.txt") }));
    await openManor(page);
    const before = await stateWithoutStatus(page);
    await openLive(page);
    await expect(status(page)).toContainText("The live snapshot at demo/live.json is not valid: file is not JSON (");
    expect(await stateWithoutStatus(page)).toEqual(before);
  });

  test("8.5 an aborted request is reported with the error name and the view is unchanged", async ({ page }) => {
    await page.route("**/demo/live.json*", (route) => route.abort());
    await openManor(page);
    const before = await stateWithoutStatus(page);
    await openLive(page);
    await expect(status(page)).toContainText("The live snapshot could not be fetched (");
    await expect(status(page)).toContainText("The current view is unchanged.");
    expect(await stateWithoutStatus(page)).toEqual(before);
  });

  for (const expanded of ["every wing", "src/orders only"] as const) {
    test(`8.6 and 8.7 valid-live.json loads over manor/before with ${expanded} expanded and no room or wing moves`, async ({ page }) => {
      await page.route("**/demo/live.json*", routeValid);
      await openManor(page);
      if (expanded === "every wing") await expandAllWings(page);
      else {
        await storeAction(page, "expandWing", "src/orders");
        await settled(page);
      }
      const modules = await drawnRoomIds(page);
      if (expanded === "every wing") expect(modules).toHaveLength(40);
      else expect(modules.length).toBeGreaterThan(0);
      const wings = await wingNames(page);
      const first = await rectangles(page, modules, wings);
      const cameraBefore = (await snapshot(page)).camera;
      const wingsBefore = (await snapshot(page)).expandedWings;
      await openLive(page);
      await expect(status(page)).toHaveText(LOADED);
      await settled(page);
      await openComparePanel(page);

      const removed = page.getByRole("list", { name: "Removed relations (1)" });
      await expect(removed.getByRole("listitem")).toHaveCount(1);
      await expect(removed.getByRole("listitem").first()).toContainText(`${RECEIPT} imports ${CHECKOUT}`);
      await expect(page.getByRole("heading", { name: "Added relations (0)" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Added relations (0)" }).locator("xpath=following-sibling::p[1]")).toHaveText("None.");

      expect(await rectangles(page, modules, wings)).toEqual(first);
      expect(await drawnRoomIds(page)).toEqual(modules);
      const after = await snapshot(page);
      expect(after.camera).toEqual(cameraBefore);
      expect(after.expandedWings).toEqual(wingsBefore);
      const result = await page.evaluate(() => (window as unknown as { __hauntmap: Hook }).__hauntmap.compareStore.getState().result);
      expect(result?.removedRelations.map((r) => r.relationId)).toEqual([DEMO_RELATION]);
      expect(result?.addedRelations).toHaveLength(0);
      if (expanded === "every wing") {
        const states = await sceneStates(page);
        expect(states[DEMO_RELATION]).toBe("comparison-removed");
        expect(Object.keys(states).filter((id) => states[id] === "comparison-added")).toEqual([]);
        const view = await page.evaluate(() => (window as unknown as { __hauntmap: { store: { getState(): { investigation: { modules: unknown[] } } } } }).__hauntmap.store.getState().investigation.modules.length);
        expect(view).toBe(40);
      }
    });
  }

  test("8.6 with the manor's loop selected first, the handoff drops the route filter and the tweens return to 0", async ({ page }) => {
    await page.route("**/demo/live.json*", routeValid);
    await openManor(page);
    await storeAction(page, "openLoops");
    await storeAction(page, "chooseLoop", 0);
    await settled(page);
    expect((await snapshot(page)).routeFilter).not.toBeNull();
    await openLive(page);
    await expect(status(page)).toHaveText(LOADED);
    await settled(page);
    expect((await snapshot(page)).routeFilter).toBeNull();
    await activeTweensIsZero(page);
    expect((await sceneDebug(page)).activeTweens).toBe(0);
  });

  test("8.6 with the manor's loop chosen in the loops panel, Open live snapshot keeps the camera and every room where it was", async ({ page }) => {
    await page.route("**/demo/live.json*", routeValid);
    await openManor(page);
    await page.getByRole("button", { name: "Dependency loops" }).click();
    await page.getByRole("list", { name: "Loops" }).getByRole("button").first().click();
    await settled(page);
    expect((await snapshot(page)).routeFilter).not.toBeNull();
    const modules = await drawnRoomIds(page);
    expect(modules.length).toBeGreaterThan(0);
    await activeTweensIsZero(page);
    const first = await fromMapCenter(page, await roomRects(page, modules));
    const cameraBefore = (await snapshot(page)).camera;
    await openLive(page);
    await expect(status(page)).toHaveText(LOADED);
    await settled(page);
    await activeTweensIsZero(page);
    expect((await snapshot(page)).camera).toEqual(cameraBefore);
    expect(await fromMapCenter(page, await roomRects(page, modules))).toEqual(first);
  });

  test("8.9 the Evidence view's inspector shows the no-source note for an occurrence of the newer snapshot", async ({ page }) => {
    await page.route("**/demo/live.json*", routeValid);
    await openManor(page);
    await openLive(page);
    await expect(status(page)).toHaveText(LOADED);
    await openComparePanel(page);
    await page.getByRole("radio", { name: /^Newer \(live:samples\/manor\)/ }).check();
    await page.keyboard.press("Escape");
    await page.getByRole("tab", { name: "Evidence" }).click();
    const relations = page.getByRole("list", { name: /^Relations \(/ });
    await relations.getByRole("button").first().click();
    const inspector = page.locator('[aria-label="Inspector"]');
    await inspector.getByRole("list", { name: /^Occurrences \(/ }).getByRole("button").first().click();
    await expect(inspector).toContainText(NO_SOURCE);
  });

  test("8.1 keyboard only: Tab to Open live snapshot, Enter loads the removed relation", async ({ page }) => {
    await page.route("**/demo/live.json*", routeValid);
    await openManor(page);
    await page.getByRole("button", { name: "Compare revisions" }).focus();
    await page.keyboard.press("Tab");
    expect(await focusedName(page)).toBe("Open live snapshot");
    await page.keyboard.press("Enter");
    await expect(status(page)).toHaveText(LOADED);
    expect(await readStatus(page)).toBe(LOADED);
    await page.keyboard.press("Shift+Tab");
    expect(await focusedName(page)).toBe("Compare revisions");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("list", { name: "Removed relations (1)" }).getByRole("listitem")).toHaveCount(1);
  });

  test("8.10 the committed public/demo/live.json, served without routing, loads; it removes the demo relation exactly when the file lacks it", async ({ page }) => {
    // The pre-edit snapshot (task 7) holds the demo relation, so nothing is removed; the session's snapshot (task 12) lacks it.
    const committed = JSON.parse(readFileSync(join(FIXTURES, "..", "..", "..", "..", "public", "demo", "live.json"), "utf8")) as { imports: { relationId: string }[] };
    const removedCount = committed.imports.some((r) => r.relationId === DEMO_RELATION) ? 0 : 1;
    await openManor(page);
    await openLive(page);
    await expect(status(page)).toContainText("Live snapshot loaded: live:samples/manor");
    await openComparePanel(page);
    await expect(page.getByRole("heading", { name: `Removed relations (${removedCount})` })).toBeVisible();
  });
});