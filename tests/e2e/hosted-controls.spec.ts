import { expect, test, type Page } from "@playwright/test";
import { openFixture, tabTo } from "./helpers";

interface StubHook {
  h(type: string, props: unknown, ...children: unknown[]): unknown;
  registry: { registerControl(slot: string, component: () => unknown): void };
}

async function toolbarNames(page: Page): Promise<string[]> {
  return page
    .locator('[aria-label="Toolbar"]')
    .locator("button, select, input, [role=tab]")
    .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") ?? el.textContent?.trim() ?? ""));
}

test.describe("hosted controls (dev build)", () => {
  test("10.1 the toolbar lists its controls in order, and a slot renders only what is registered", async ({ page }) => {
    await openFixture(page, "triad");
    await expect(page.getByRole("button", { name: "Restart demo" })).toBeVisible();
    expect(await toolbarNames(page)).toEqual([
      "Restart demo",
      "Relation preset",
      "Dependency loops",
      "Legend",
      "Motion",
      "Zoom in",
      "Zoom out",
      "Fit to view",
      "Clear selection",
      "Map",
      "Evidence",
    ]);
    await page.evaluate(() => {
      const hook = (window as unknown as { __hauntmap: StubHook }).__hauntmap;
      const stub = (name: string) => () => hook.h("button", { type: "button" }, name);
      hook.registry.registerControl("live-snapshot", stub("Open live snapshot"));
      hook.registry.registerControl("export", stub("Export investigation"));
      hook.registry.registerControl("compare", stub("Compare revisions"));
    });
    const names = await toolbarNames(page);
    expect(names.slice(-3)).toEqual(["Export investigation", "Compare revisions", "Open live snapshot"]);
    await tabTo(page, "Compare revisions");
  });

  test("10.2 there is one live region", async ({ page }) => {
    await openFixture(page, "triad");
    await expect(page.getByRole("button", { name: "Restart demo" })).toBeVisible();
    await expect(page.locator('[role="status"]')).toHaveCount(1);
    await expect(page.locator("[aria-live]")).toHaveCount(0);
  });
});