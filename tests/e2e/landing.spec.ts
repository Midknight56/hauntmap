import { expect, test, type Page } from "@playwright/test";
import { readStatus, shot } from "./helpers";

/** Open a sample and wait for the first room to be drawn; skip the case when headless Chromium has no WebGL. */
async function openSample(page: Page, name: "Explore the manor" | "Explore the annex"): Promise<void> {
  await page.getByRole("button", { name }).click();
  const outcome = await Promise.race([
    page.waitForFunction(() => performance.getEntriesByName("hauntmap:usable").length > 0).then(() => "usable"),
    page.getByRole("button", { name: "Retry map" }).waitFor({ timeout: 20_000 }).then(() => "banner"),
  ]);
  test.skip(outcome === "banner", "no WebGL in headless Chromium");
}

const SENTENCE =
  "Find how the modules of a JavaScript or TypeScript project import each other: rooms are files, doors are imports, and a corridor that returns to its start is a dependency cycle.";

async function focusedName(page: Page): Promise<string> {
  return page.evaluate(() => (document.activeElement as HTMLElement | null)?.textContent?.trim() ?? "");
}

test.describe("landing screen", () => {
  test("1.1 heading, sentence and two buttons in order; the first Tab lands on Explore the manor", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "HauntMap" })).toBeVisible();
    await expect(page.getByText(SENTENCE, { exact: true })).toBeVisible();
    const names = await page.getByRole("button").evaluateAll((els) => els.map((el) => el.textContent?.trim()));
    expect(names).toEqual(["Explore the manor", "Explore the annex"]);
    await page.keyboard.press("Tab");
    expect(await focusedName(page)).toBe("Explore the manor");
    await page.keyboard.press("Tab");
    expect(await focusedName(page)).toBe("Explore the annex");
    await shot(page, "docs/acceptance/img/landing.png");
  });

  test("1.2 no modal, buttons enabled on first paint", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Explore the manor" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Explore the annex" })).toBeEnabled();
    await expect(page.locator('[role="dialog"], [aria-modal="true"]')).toHaveCount(0);
  });

  test("1.6 a sample request that fails keeps the landing screen and leaves focus on the button", async ({ page }) => {
    await page.route("**/demo/manor/before/sources.json", (route) => route.fulfill({ status: 500, body: "nope" }));
    await page.goto("/");
    await page.getByRole("button", { name: "Explore the manor" }).click();
    await expect(page.locator('[role="status"]')).toHaveText("The manor sample could not be loaded (500). Reload the page.");
    await expect(page.getByRole("heading", { name: "HauntMap" })).toBeVisible();
    expect(await focusedName(page)).toBe("Explore the manor");
  });

  test("1.10 an analysis that rejects keeps the landing screen and writes the analysis message", async ({ page }) => {
    const files = Array.from({ length: 1001 }, (_, i) => ({ path: `src/m${String(i).padStart(4, "0")}.ts`, text: "export {};\n" }));
    await page.route("**/demo/manor/before/sources.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ files }) }));
    await page.goto("/");
    await page.getByRole("button", { name: "Explore the manor" }).click();
    await expect(page.locator('[role="status"]')).toContainText("The manor sample could not be analyzed (");
    expect(await readStatus(page)).toMatch(/^The manor sample could not be analyzed \(.+\)\. Reload the page\.$/);
    await expect(page.getByRole("heading", { name: "HauntMap" })).toBeVisible();
    expect(await focusedName(page)).toBe("Explore the manor");
  });

  test("the release build has no window.__hauntmap", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "HauntMap" })).toBeVisible();
    expect(await page.evaluate(() => "__hauntmap" in window)).toBe(false);
  });

  test("1.3 the manor opens from one request, with src/orders expanded and the camera fitted to it; the annex opens without steps", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.url().endsWith("sources.json")) requests.push(new URL(request.url()).pathname);
    });
    await page.goto("/");
    await openSample(page, "Explore the manor");
    expect(requests).toEqual(["/demo/manor/before/sources.json"]);
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toHaveText("manor/before \u203A src/orders");
    await expect(page.getByRole("application", { name: "Haunted map" })).toBeVisible();
    const canvas = await page.locator("canvas").boundingBox();
    expect(canvas?.width ?? 0).toBeGreaterThan(300);
    await expect(page.getByRole("button", { name: "Show steps" })).toBeVisible();
    await shot(page, "docs/acceptance/img/manor-map.png");

    await page.getByRole("button", { name: "Restart demo" }).click();
    await page.getByRole("button", { name: "Explore the annex" }).click();
    await page.getByRole("application", { name: "Haunted map" }).waitFor();
    await expect(page.getByRole("button", { name: "Show steps" })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("annex");
  });

  test("1.7 Restart demo returns to the landing screen and keeps only the preferences record in localStorage", async ({ page }) => {
    await page.goto("/");
    await openSample(page, "Explore the manor");
    await page.getByRole("button", { name: "Legend" }).click();
    await page.getByRole("button", { name: "Restart demo" }).click();
    await expect(page.getByRole("heading", { name: "HauntMap" })).toBeVisible();
    await expect(page.getByRole("application", { name: "Haunted map" })).toHaveCount(0);
    const keys = await page.evaluate(() => Object.keys(localStorage));
    expect(keys).toEqual(["hauntmap.prefs.v1"]);
    await expect(page.locator("canvas")).toHaveCount(0);
  });

  test("1.8 the manor map opens in a fresh context with empty storage and no account, key, cookie banner or download (not the hosted-build check)", async ({ page }) => {
    const origins = new Set<string>();
    let downloads = 0;
    page.on("request", (request) => origins.add(new URL(request.url()).origin));
    page.on("download", () => downloads++);
    await page.goto("/");
    expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
    await openSample(page, "Explore the manor");
    expect([...origins]).toHaveLength(1);
    expect(downloads).toBe(0);
    expect(await page.evaluate(() => document.cookie)).toBe("");
    await expect(page.locator('[role="dialog"], [aria-modal="true"]')).toHaveCount(0);
    await expect(page.getByRole("textbox")).toHaveCount(0);
  });
});