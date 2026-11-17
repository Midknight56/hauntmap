import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { focusedName, sceneDebug, settled, snapshot, tabTo } from "../../e2e/helpers";
import { roomRects } from "../../compare/e2e/helpers";

// The app side of the recorded H9 session (requirements 9.3 and 9.4): keyboard only, 1,280 x 720, video on. It runs
// against the dev server after the headless Kiro session has made the analyze-live hook rewrite public/demo/live.json.

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const OUT = join(REPO, "docs", "acceptance", "h9-session");
const RECEIPT = "src/notifications/receipt.ts";
const CHECKOUT = "src/orders/checkout.ts";
const DEMO_RELATION = JSON.stringify([RECEIPT, ["local", CHECKOUT], "import", "value"]);
const LOADED = "Live snapshot loaded: live:samples/manor (40 modules) is the newer snapshot; manor/before is the older one.";

type Result = { removedRelations: { relationId: string }[]; addedRelations: unknown[] };

/** Press Tab until the focused element is inside the named list. */
async function tabIntoList(page: Page, listName: string): Promise<void> {
  for (let presses = 0; presses < 200; presses++) {
    const inside = await page.evaluate((name) => {
      const active = document.activeElement;
      return active !== null && active.closest(`[aria-label="${name}"]`) !== null;
    }, listName);
    if (inside) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`no element of the list "${listName}" received focus in 200 Tab presses`);
}

async function drawnRoomIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const hook = (window as unknown as { __hauntmap: { store: { getState(): { layout: { rooms: { id: string }[] } | null } } } }).__hauntmap;
    return hook.store.getState().layout?.rooms.map((r) => r.id) ?? [];
  });
}

/** Rectangles relative to the center of the map area, because the legend grows during a comparison and resizes the area. */
async function fromMapCenter(page: Page, ids: string[]): Promise<Record<string, unknown>> {
  const rects = await roomRects(page, ids);
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

test("H9 app: open the manor, select its loop, activate Open live snapshot, the corridor closes", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.goto("/");
  await tabTo(page, "Explore the manor");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => performance.getEntriesByName("hauntmap:usable").length > 0);

  await tabTo(page, "Dependency loops");
  await page.keyboard.press("Enter");
  await tabIntoList(page, "Loops");
  await page.keyboard.press("Enter");
  await settled(page);
  expect((await snapshot(page)).routeFilter, "the loop's witness is the route filter").not.toBeNull();

  const rooms = await drawnRoomIds(page);
  expect(rooms.length).toBeGreaterThan(0);
  // Choosing a loop from the DOM centers the camera on its first door with a 240 ms transition (investigation-ui 4.2).
  // The baseline is read only once that transition is over: two reads 300 ms apart agree and no tween is running.
  let first = await fromMapCenter(page, rooms);
  for (let reads = 0; reads < 20; reads++) {
    await page.waitForFunction(() => (window as unknown as { __hauntmap: { scene(): { debug(): { activeTweens: number } } } }).__hauntmap.scene().debug().activeTweens === 0);
    await page.waitForTimeout(300);
    const again = await fromMapCenter(page, rooms);
    const steady = JSON.stringify(again) === JSON.stringify(first);
    first = again;
    if (steady) break;
  }
  for (const [id, rect] of Object.entries(first)) expect(rect, `${id} is drawn before`).not.toBeNull();
  await page.screenshot({ path: join(OUT, "app-before.png") });

  await tabTo(page, "Open live snapshot");
  expect(await focusedName(page)).toBe("Open live snapshot");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toHaveText(LOADED, { timeout: 20_000 });
  await settled(page);
  await page.waitForFunction(() => (window as unknown as { __hauntmap: { scene(): { debug(): { activeTweens: number } } } }).__hauntmap.scene().debug().activeTweens === 0);
  expect((await sceneDebug(page)).activeTweens).toBe(0);
  await page.screenshot({ path: join(OUT, "app-after.png") });

  await page.getByRole("button", { name: "Compare revisions" }).focus();
  await page.keyboard.press("Enter");
  const removed = page.getByRole("list", { name: "Removed relations (1)" });
  await expect(removed.getByRole("listitem")).toHaveCount(1);
  await expect(removed.getByRole("listitem").first()).toContainText(`${RECEIPT} imports ${CHECKOUT}`);
  await expect(page.getByRole("heading", { name: "Added relations (0)" })).toBeVisible();

  expect(await drawnRoomIds(page)).toEqual(rooms);
  expect(await fromMapCenter(page, rooms), "every room keeps its position").toEqual(first);

  const result = await page.evaluate(() => (window as unknown as { __hauntmap: { compareStore: { getState(): { result: Result | null } } } }).__hauntmap.compareStore.getState().result);
  expect(result).not.toBeNull();
  expect(result?.removedRelations.map((r) => r.relationId)).toEqual([DEMO_RELATION]);
  expect(result?.addedRelations).toEqual([]);
  writeFileSync(join(OUT, "app-comparison.json"), `${JSON.stringify({ comparison: { result } }, null, 2)}\n`, "utf8");
  expect((JSON.parse(readFileSync(join(OUT, "app-comparison.json"), "utf8")) as { comparison: { result: Result } }).comparison.result.removedRelations).toHaveLength(1);

  const video = page.video();
  await page.close();
  await video?.saveAs(join(OUT, "app-recording.webm"));
});
