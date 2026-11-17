import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

// Requirements 8.1 to 8.7 and 8.10: the Open live snapshot journey in the `dev` Playwright project
// of investigation-ui (a build made with VITE_HAUNTMAP_DEVHOOK=1, served by pnpm preview, where
// window.__hauntmap exists). The shape of window.__hauntmap used below (store.getState(),
// compareStore.getState().result, screenRectOf(id)) is the one design.md and requirement 4.4
// name; check it against the landed investigation-ui at task 11. Until investigation-ui installs
// Playwright this file is created but not collected.

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "live");
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), "utf8");

const MISSING = "No live snapshot yet. Run `pnpm hauntmap analyze samples/manor --out public/demo/live.json`, or let the Kiro hook write it.";

interface Hook {
  store: { getState(): Record<string, unknown> };
  compareStore: { getState(): { result: { removedRelations: { label?: string; relationId: string }[]; addedRelations: unknown[] } | null } };
  screenRectOf(id: string): { x: number; y: number; width: number; height: number } | null;
}
declare global {
  interface Window {
    __hauntmap: Hook;
  }
}

async function openManor(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore the manor" }).click();
  await expect(page.getByRole("application", { name: "Haunted map" })).toBeVisible();
}

async function stateWithoutStatus(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const state = { ...window.__hauntmap.store.getState() };
    delete state.status;
    return JSON.parse(JSON.stringify(state)) as unknown;
  });
}

async function openLive(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Open live snapshot" }).click();
}

const status = (page: Page) => page.getByRole("status");

test.describe("Open live snapshot", () => {
  test("8.1 Tab reaches Open live snapshot after the Compare revisions control", async ({ page }) => {
    await openManor(page);
    const compare = page.getByRole("button", { name: "Compare revisions" });
    await compare.focus();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Open live snapshot" })).toBeFocused();
  });

  for (const [name, respond] of [
    ["404", (route: import("@playwright/test").Route) => route.fulfill({ status: 404, body: "not found" })],
    ["hosting fallback", (route: import("@playwright/test").Route) => route.fulfill({ status: 200, contentType: "text/html", body: fixture("fallback.html") })],
  ] as const) {
    test(`8.3 ${name} shows the missing message and changes nothing else`, async ({ page }) => {
      await page.route("**/demo/live.json*", respond);
      await openManor(page);
      const before = await stateWithoutStatus(page);
      await openLive(page);
      await expect(status(page)).toHaveText(MISSING);
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
      await page.route("**/demo/live.json*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: fixture("valid-live.json") }));
      await openManor(page);
      const ids = await page.evaluate((mode) => {
        const state = window.__hauntmap.store.getState() as { investigation: { modules: { id: string }[] } };
        return { modules: state.investigation.modules.map((m) => m.id), mode };
      }, expanded);
      const rects = async () =>
        page.evaluate((modules) => modules.map((id) => [id, window.__hauntmap.screenRectOf(id)] as const), ids.modules);
      const before = await rects();
      const camera = await page.evaluate(() => JSON.stringify((window.__hauntmap.store.getState() as { camera: unknown }).camera));
      await openLive(page);
      await expect(status(page)).toContainText("Live snapshot loaded: live:samples/manor (40 modules) is the newer snapshot; manor/before is the older one.");
      const removed = page.getByRole("region", { name: /Removed relations/ });
      await expect(removed).toContainText("Removed relations (1)");
      await expect(removed.getByRole("listitem").first()).toContainText("src/notifications/receipt.ts imports src/orders/checkout.ts");
      await expect(page.getByRole("region", { name: /Added relations/ })).toContainText("None.");
      const after = await rects();
      for (const [id, rect] of before) expect(rect, `${id} had no drawn rectangle before`).not.toBeNull();
      expect(after).toEqual(before);
      expect(await page.evaluate(() => JSON.stringify((window.__hauntmap.store.getState() as { camera: unknown }).camera))).toBe(camera);
      const result = await page.evaluate(() => window.__hauntmap.compareStore.getState().result);
      expect(result?.removedRelations).toHaveLength(1);
      expect(result?.addedRelations).toHaveLength(0);
    });
  }

  test("8.10 the committed public/demo/live.json, served without routing, loads and shows the removed relation", async ({ page }) => {
    await openManor(page);
    await openLive(page);
    await expect(status(page)).toContainText("Live snapshot loaded: live:samples/manor");
    await expect(page.getByRole("region", { name: /Removed relations/ })).toContainText("Removed relations (1)");
  });
});
