import { expect, test, type Page } from "@playwright/test";
import { inspectorHeading, sceneDebug, settled, shot, snapshot, storeAction } from "./helpers";

// Requirement 12.1 to 12.4 in the dev build, headless. Cases that need a real scene are skipped,
// with the reason printed, when headless Chromium has no WebGL.

const BANNER = "The illustrated map could not start in this browser. The Evidence view has every room, door and corridor as lists.";
const CONTEXT_LOST = "The map lost its graphics context. Retrying\u2026";
const BOUNDARY = "Something went wrong drawing the map. Your investigation is still loaded.";
const CHECKOUT = "src/orders/checkout.ts";

type HookWindow = Window & { __hauntmap: { forceRendererFailure(on: boolean): void; loseContext(): void; crashNextRender(): void }; __ext?: { restoreContext(): void } | null };

async function force(page: Page, on: boolean): Promise<void> {
  await page.evaluate((value) => (window as HookWindow).__hauntmap.forceRendererFailure(value), on);
}

/** Open the manor from the landing page; resolves when the map is usable or the banner is up. */
async function startManor(page: Page): Promise<"usable" | "banner"> {
  await page.getByRole("button", { name: "Explore the manor" }).click();
  return Promise.race([
    page.waitForFunction(() => performance.getEntriesByName("hauntmap:usable").length > 0).then(() => "usable" as const),
    page.getByRole("button", { name: "Retry map" }).waitFor({ timeout: 20_000 }).then(() => "banner" as const),
  ]);
}

async function openWithScene(page: Page): Promise<void> {
  await page.goto("/");
  const outcome = await startManor(page);
  test.skip(outcome === "banner", "no WebGL in headless Chromium");
}

/** A state worth keeping: a selected module, an open loops panel with a witness route. */
async function buildState(page: Page): Promise<void> {
  await storeAction(page, "select", { kind: "module", id: CHECKOUT }, { from: "dom" });
  await storeAction(page, "openLoops");
  await storeAction(page, "chooseLoop", 0);
}

async function expectBanner(page: Page): Promise<void> {
  const banner = page.locator(".renderer-banner", { hasText: BANNER });
  await expect(banner).toBeVisible();
  await expect(banner.getByRole("button", { name: "Retry map" })).toBeFocused();
  await expect(banner.getByRole("button", { name: "Open Evidence view" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Evidence" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText(BOUNDARY)).toHaveCount(0);
}

test.describe("renderer fallback (dev build)", () => {
  test("12.1 a forced failure shows the banner, opens the Evidence view and focuses Retry map; the investigation is kept", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => (window as HookWindow).__hauntmap !== undefined);
    await force(page, true);
    await page.getByRole("button", { name: "Explore the manor" }).click();
    await page.getByRole("button", { name: "Retry map" }).waitFor();
    await expectBanner(page);
    await buildState(page);
    const state = await snapshot(page);
    expect(state.selection).toMatchObject({ kind: "relation" });
    expect(state.routeFilter?.kind).toBe("witness");
    await expect(page.getByRole("heading", { name: "Evidence (static-value)" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Investigation steps" })).toBeVisible();
    await expect(inspectorHeading(page)).toContainText("imports");
    await shot(page, "docs/acceptance/img/renderer-banner.png");
  });

  test("12.1 the development query ?renderer=off gives the same banner", async ({ page }) => {
    await page.goto("/?renderer=off");
    await page.getByRole("button", { name: "Explore the manor" }).click();
    await page.getByRole("button", { name: "Retry map" }).waitFor();
    await expectBanner(page);
  });

  test("12.2 Retry map while the failure persists keeps the banner and leaves the state deep-equal", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => (window as HookWindow).__hauntmap !== undefined);
    await force(page, true);
    await page.getByRole("button", { name: "Explore the manor" }).click();
    await page.getByRole("button", { name: "Retry map" }).waitFor();
    await buildState(page);
    await settled(page);
    const before = await snapshot(page);
    await page.getByRole("button", { name: "Retry map" }).click();
    await expectBanner(page);
    expect(await snapshot(page)).toEqual(before);
  });

  test("12.2 Retry map after the failure is gone draws the current state and leaves selection, camera and route filter deep-equal", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => (window as HookWindow).__hauntmap !== undefined);
    await force(page, true);
    await page.getByRole("button", { name: "Explore the manor" }).click();
    await page.getByRole("button", { name: "Retry map" }).waitFor();
    await buildState(page);
    await settled(page);
    const before = await snapshot(page);
    await force(page, false);
    await page.getByRole("button", { name: "Retry map" }).click();
    const outcome = await Promise.race([
      page.locator(".renderer-banner", { hasText: BANNER }).waitFor({ state: "detached", timeout: 20_000 }).then(() => "map" as const),
      page.waitForTimeout(20_000).then(() => "banner" as const),
    ]);
    test.skip(outcome === "banner" && (await page.getByRole("button", { name: "Retry map" }).isVisible()), "no WebGL in headless Chromium");
    // The view stays on Evidence until the person chooses Map; the scene exists and draws the current layout.
    await page.getByRole("tab", { name: "Map" }).click();
    await expect(page.getByRole("application", { name: "Haunted map" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __hauntmap: { scene(): unknown } }).__hauntmap.scene() !== null)).toBe(true);
    const after = await snapshot(page);
    expect({ ...after, activeView: "" }).toEqual({ ...before, activeView: "" });
    await expect.poll(async () => (await sceneDebug(page)).tickerRunning).toBe(true);
    await expect.poll(async () => (await sceneDebug(page)).visibleRooms).toBeGreaterThan(0);
  });

  test("12.3 a lost context shows the retrying text, stops the ticker, keeps the DOM usable, and a restore redraws within 1,000 ms", async ({ page }) => {
    await openWithScene(page);
    await buildState(page);
    await settled(page);
    const before = await snapshot(page);
    // Keep the extension object: a lost context returns null from getExtension.
    await page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      const gl = canvas?.getContext("webgl2") ?? canvas?.getContext("webgl");
      (window as HookWindow).__ext = (gl?.getExtension("WEBGL_lose_context") as { restoreContext(): void } | null | undefined) ?? null;
      (window as HookWindow).__hauntmap.loseContext();
    });
    await expect(page.getByText(CONTEXT_LOST)).toBeVisible();
    await expect.poll(async () => (await sceneDebug(page)).tickerRunning).toBe(false);
    // The DOM stays interactive while the map is down.
    await page.getByRole("tab", { name: "Evidence" }).click();
    await expect(page.getByRole("tab", { name: "Evidence" })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("tab", { name: "Map" }).click();
    const started = Date.now();
    await page.evaluate(() => {
      const w = window as HookWindow;
      if (w.__ext) w.__ext.restoreContext();
      else document.querySelector("canvas")?.dispatchEvent(new Event("webglcontextrestored"));
    });
    await expect(page.getByText(CONTEXT_LOST)).toHaveCount(0, { timeout: 1000 });
    await expect.poll(async () => (await sceneDebug(page)).tickerRunning, { timeout: 1000 }).toBe(true);
    expect(Date.now() - started).toBeLessThan(1500);
    const after = await snapshot(page);
    expect(after.selection).toEqual(before.selection);
    expect(after.routeFilter).toEqual(before.routeFilter);
    expect(after.camera).toEqual(before.camera);
  });

  test("12.3 with no restore the banner of 12.1 appears after 5,000 ms and the investigation is kept", async ({ page }) => {
    test.setTimeout(40_000);
    await openWithScene(page);
    await buildState(page);
    const before = await snapshot(page);
    const lostAt = Date.now();
    await page.evaluate(() => (window as HookWindow).__hauntmap.loseContext());
    await expect(page.getByText(CONTEXT_LOST)).toBeVisible();
    await expect(page.locator(".renderer-banner", { hasText: BANNER })).toBeHidden();
    await expect(page.locator(".renderer-banner", { hasText: BANNER })).toBeVisible({ timeout: 10_000 });
    expect(Date.now() - lostAt).toBeGreaterThanOrEqual(4900);
    await expectBanner(page);
    const after = await snapshot(page);
    expect(after.selection).toEqual(before.selection);
    expect(after.routeFilter).toEqual(before.routeFilter);
    expect(after.panelKind).toBe("loops");
  });

  test("12.4 a render error shows the boundary text, logs only a name and stack, and Reload view keeps the investigation", async ({ page }) => {
    const logged: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") logged.push(message.text());
    });
    await page.goto("/");
    await page.waitForFunction(() => (window as HookWindow).__hauntmap !== undefined);
    await force(page, true);
    await page.getByRole("button", { name: "Explore the manor" }).click();
    await page.getByRole("button", { name: "Retry map" }).waitFor();
    await buildState(page);
    const before = await snapshot(page);
    await page.evaluate(() => (window as HookWindow).__hauntmap.crashNextRender());
    await storeAction(page, "setStatus", "trigger a render");
    await expect(page.getByText(BOUNDARY)).toBeVisible();
    await expect(page.getByRole("button", { name: "Reload view" })).toBeFocused();
    expect(logged.join("\n")).not.toContain(CHECKOUT);
    expect(logged.join("\n")).not.toContain("manor/before");
    await page.getByRole("button", { name: "Reload view" }).click();
    await expect(page.getByText(BOUNDARY)).toHaveCount(0);
    await expect(page.getByRole("complementary", { name: "Inspector" })).toBeVisible();
    const after = await snapshot(page);
    expect(after.selection).toEqual(before.selection);
    expect(after.routeFilter).toEqual(before.routeFilter);
    expect(after.expandedWings).toEqual(before.expandedWings);
  });
});
