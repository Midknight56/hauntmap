import { expect, test, type Page } from "@playwright/test";
import {
  expected,
  inStaticValue,
  inspectorHeading,
  offsetFromMapCenter,
  openManor,
  readStatus,
  roomPoint,
  sceneDebug,
  settled,
  snapshot,
} from "./helpers";

const manor = expected();
const search = (page: Page) => page.getByRole("combobox", { name: "Search modules" });
const wrapper = (page: Page) => page.getByRole("application", { name: "Haunted map" });

async function choose(page: Page, query: string): Promise<void> {
  await search(page).fill(query);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
}

test.describe("search, focus and camera", () => {
  test("4.1 the field is a combobox; `receipt` lists the matching modules with their count", async ({ page }) => {
    await openManor(page);
    await expect(search(page)).toHaveAttribute("aria-expanded", "false");
    await search(page).fill("receipt");
    await expect(search(page)).toHaveAttribute("aria-expanded", "true");
    const matches = manor.modules.map((m) => m.id).filter((id) => id.toLowerCase().includes("receipt")).sort();
    const options = page.getByRole("listbox").getByRole("option");
    expect(await options.allTextContents()).toEqual(matches);
    await expect(page.getByText(`${matches.length} matches`, { exact: true })).toBeVisible();
    await page.keyboard.press("ArrowDown");
    const active = await search(page).getAttribute("aria-activedescendant");
    await expect(page.locator(`[id="${active}"]`)).toHaveText(matches[0] ?? "");
  });

  test("4.2 choosing a result selects it, centers its room at zoom 1 or more and focuses the inspector heading", async ({ page }) => {
    await openManor(page);
    await choose(page, "receipt");
    await expect(inspectorHeading(page)).toHaveText("src/notifications/receipt.ts");
    await expect(inspectorHeading(page)).toBeFocused();
    await expect(search(page)).toHaveValue("receipt");
    await settled(page);
    await expect
      .poll(async () => {
        const offset = await offsetFromMapCenter(page, { kind: "room", id: "src/notifications/receipt.ts" });
        return offset === null ? 9999 : Math.max(Math.abs(offset.dx), Math.abs(offset.dy));
      })
      .toBeLessThan(4);
    expect((await snapshot(page)).camera.zoom).toBeGreaterThanOrEqual(1);
    expect((await snapshot(page)).expandedWings).toContain("src/notifications");
  });

  test("4.3 a query without a match says so in the list and the status region and leaves the selection alone", async ({ page }) => {
    await openManor(page);
    await choose(page, "checkout");
    await expect(inspectorHeading(page)).toHaveText("src/orders/checkout.ts");
    await search(page).fill('zzz"<b>');
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(page.getByText('No module matches "zzz"<b>".', { exact: true }).first()).toBeVisible();
    expect(await readStatus(page)).toBe('No module matches "zzz"<b>".');
    expect((await snapshot(page)).selection).toEqual({ kind: "module", id: "src/orders/checkout.ts" });
    expect(await page.locator("b").count()).toBe(0);
  });

  test("4.4 Focus subdues everything but the neighbours and says how many; Clear selection restores them", async ({ page }) => {
    await openManor(page);
    await choose(page, "checkout");
    await page.getByRole("complementary", { name: "Inspector" }).getByRole("button", { name: "Focus" }).click();
    const local = manor.imports.filter((r) => r.resolution === "local" && inStaticValue(r));
    const importers = [...new Set(local.filter((r) => r.to === "src/orders/checkout.ts").map((r) => r.from))].sort();
    const imports = [...new Set(local.filter((r) => r.from === "src/orders/checkout.ts").map((r) => r.to ?? ""))].sort();
    expect(await readStatus(page)).toBe(`Focused on src/orders/checkout.ts: ${importers.length} importers, ${imports.length} imports.`);
    const state = await snapshot(page);
    expect(state.routeFilter?.kind).toBe("focus");
    expect(state.routeFilter?.modules).toEqual([...new Set(["src/orders/checkout.ts", ...importers, ...imports])].sort());
    await page.getByRole("button", { name: "Clear selection" }).click();
    const cleared = await snapshot(page);
    expect(cleared.routeFilter).toBeNull();
    expect(cleared.selection).toEqual({ kind: "none" });
  });

  test("4.5 arrow keys pan 80 and 320 px, plus and minus zoom by 1.25, 0 fits, the toolbar buttons zoom and fit, zoom stays in [0.25, 4]", async ({ page }) => {
    await openManor(page);
    await wrapper(page).focus();
    const start = (await snapshot(page)).camera;
    await page.keyboard.press("ArrowRight");
    let now = (await snapshot(page)).camera;
    expect((now.x - start.x) * start.zoom).toBeCloseTo(80, 3);
    expect(now.y).toBeCloseTo(start.y, 6);
    await page.keyboard.press("Shift+ArrowDown");
    const next = (await snapshot(page)).camera;
    expect((next.y - now.y) * now.zoom).toBeCloseTo(320, 3);
    now = next;
    await page.keyboard.press("+");
    expect((await snapshot(page)).camera.zoom).toBeCloseTo(now.zoom * 1.25, 6);
    await page.keyboard.press("-");
    expect((await snapshot(page)).camera.zoom).toBeCloseTo(now.zoom, 6);
    await page.keyboard.press("=");
    expect((await snapshot(page)).camera.zoom).toBeCloseTo(now.zoom * 1.25, 6);
    await page.keyboard.press("0");
    const fitted = await snapshot(page);
    const bounds = fitted.layout?.bounds;
    expect(fitted.camera.x).toBeCloseTo((bounds?.x ?? 0) + (bounds?.w ?? 0) / 2, 3);
    expect(fitted.camera.y).toBeCloseTo((bounds?.y ?? 0) + (bounds?.h ?? 0) / 2, 3);
    await page.getByRole("button", { name: "Zoom in" }).click();
    expect((await snapshot(page)).camera.zoom).toBeCloseTo(fitted.camera.zoom * 1.25, 6);
    await page.getByRole("button", { name: "Zoom out" }).click();
    expect((await snapshot(page)).camera.zoom).toBeCloseTo(fitted.camera.zoom, 6);
    await page.getByRole("button", { name: "Fit to view" }).click();
    expect((await snapshot(page)).camera).toEqual(fitted.camera);
    await wrapper(page).focus();
    for (let i = 0; i < 30; i++) await page.keyboard.press("+");
    expect((await snapshot(page)).camera.zoom).toBe(4);
    for (let i = 0; i < 60; i++) await page.keyboard.press("-");
    expect((await snapshot(page)).camera.zoom).toBe(0.25);
  });

  test("4.6 a scene click, Focus, Clear selection and the loops panel leave the camera alone", async ({ page }) => {
    await openManor(page);
    const start = (await snapshot(page)).camera;
    const point = await roomPoint(page, "src/orders/order.ts");
    expect(point).not.toBeNull();
    await page.mouse.click(point!.x, point!.y);
    await expect(inspectorHeading(page)).toHaveText("src/orders/order.ts");
    expect((await snapshot(page)).camera).toEqual(start);
    await page.getByRole("complementary", { name: "Inspector" }).getByRole("button", { name: "Focus" }).click();
    expect((await snapshot(page)).camera).toEqual(start);
    await page.getByRole("button", { name: "Dependency loops" }).click();
    expect((await snapshot(page)).panelKind).toBe("loops");
    expect((await snapshot(page)).camera).toEqual(start);
    await page.getByRole("button", { name: "Clear selection" }).click();
    expect((await snapshot(page)).camera).toEqual(start);
  });

  test("4.7 a click on the minimap moves the camera center to that point", async ({ page }) => {
    await openManor(page);
    await page.getByRole("button", { name: "Fit to view" }).click();
    const before = (await snapshot(page)).camera;
    const box = await page.locator(".minimap").boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + 10, box!.y + 10);
    const after = (await snapshot(page)).camera;
    expect(after.x).toBeLessThan(before.x);
    expect(after.y).toBeLessThan(before.y);
    expect(after.zoom).toBe(before.zoom);
    expect((await sceneDebug(page)).tickerRunning).toBe(true);
  });
});
