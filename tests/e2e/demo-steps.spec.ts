import { expect, test, type Page } from "@playwright/test";
import { inspectorHeading, openManor, settled } from "./helpers";

// The investigation steps panel (requirement 8) on the bundled manor, in the dev build.

interface StubRegistry {
  registerHandoff(name: "compare", fn: (args: unknown) => Promise<void>): void;
}
type StubWindow = Window & { __hauntmap: { registry: StubRegistry }; __compareCalls?: { after: unknown; hasBefore: boolean; layoutKey: unknown }[] };

const CHECKOUT = "src/orders/checkout.ts";

function panel(page: Page) {
  return page.getByRole("region", { name: "Investigation steps" });
}

function step(page: Page, id: string) {
  return page.locator(`[data-step="${id}"]`);
}

async function focusedText(page: Page): Promise<string> {
  return page.evaluate(() => (document.activeElement as HTMLElement | null)?.textContent?.trim() ?? "");
}

async function registerCompare(page: Page, mode: "resolve" | "reject"): Promise<void> {
  await page.evaluate((how) => {
    const w = window as unknown as StubWindow;
    w.__compareCalls = [];
    w.__hauntmap.registry.registerHandoff("compare", async (args) => {
      const a = args as { before: unknown; after: unknown; layoutKey: unknown };
      w.__compareCalls?.push({ after: a.after, hasBefore: typeof a.before === "object" && a.before !== null, layoutKey: a.layoutKey });
      if (how === "reject") throw new Error("stub failure");
    });
  }, mode);
}

test.describe("investigation steps (dev build)", () => {
  test("8.1 the manor opens with the panel, three steps with the registered compare handoff, each with Do it and Skip", async ({ page }) => {
    await openManor(page);
    await expect(panel(page).getByRole("heading", { name: "Investigate the manor", level: 2 })).toBeVisible();
    await expect(panel(page).getByText("0 of 3 steps")).toBeVisible();
    await expect(panel(page).locator("[data-step]")).toHaveCount(3);
    await expect(step(page, "compare")).toContainText("Compare revisions");
    await expect(step(page, "follow")).toContainText("Follow a dependency");
    await expect(step(page, "follow")).toContainText("Select src/orders/checkout.ts and open one of its doors.");
    await expect(step(page, "follow")).toContainText("To do");
    await expect(step(page, "loop")).toContainText("Reveal a loop");
    await expect(step(page, "loop")).toContainText("Open Dependency loops and choose the 3-module loop.");
    await expect(panel(page).getByRole("button", { name: "Do it" })).toHaveCount(3);
    await expect(panel(page).getByRole("button", { name: "Skip" })).toHaveCount(3);
    await expect(panel(page).getByRole("button", { name: "Close" })).toBeVisible();
    await expect(page.locator('[role="dialog"], [aria-modal="true"]')).toHaveCount(0);
  });

  test("8.2 Do it on step 1 selects checkout.ts, centers it, focuses the first Imports button and completes on a door", async ({ page }) => {
    await openManor(page);
    await step(page, "follow").getByRole("button", { name: "Do it" }).click();
    await expect(inspectorHeading(page)).toHaveText(CHECKOUT);
    await settled(page);
    await expect(page.locator('[aria-label="Inspector"] h3', { hasText: /^Imports \(/ })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest('[aria-label="Inspector"]') !== null)).toBe(true);
    const firstImports = page.locator('[aria-label="Inspector"] section', { has: page.locator("h3", { hasText: /^Imports \(/ }) }).getByRole("button").first();
    await expect(firstImports).toBeFocused();
    await expect(step(page, "follow")).toContainText("To do");
    await firstImports.click();
    await expect(step(page, "follow")).toContainText("Done");
    await expect(panel(page).getByText("1 of 3 steps")).toBeVisible();
  });

  test("8.3 Do it on step 2 opens the loops panel with focus on its first component, and choosing it completes the step", async ({ page }) => {
    await openManor(page);
    await step(page, "loop").getByRole("button", { name: "Do it" }).click();
    const first = page.getByRole("list", { name: "Loops" }).getByRole("button").first();
    await expect(first).toBeFocused();
    await expect(step(page, "loop")).toContainText("To do");
    await page.keyboard.press("Enter");
    await expect(step(page, "loop")).toContainText("Done");
    await expect(panel(page).getByText("1 of 3 steps")).toBeVisible();
  });

  test("8.5 steps can be done in any order; Skip marks Skipped as text and a skipped step can still become Done", async ({ page }) => {
    await openManor(page);
    await step(page, "follow").getByRole("button", { name: "Skip" }).click();
    await expect(step(page, "follow")).toContainText("Skipped");
    await expect(panel(page).getByText("0 of 3 steps")).toBeVisible();
    await step(page, "loop").getByRole("button", { name: "Do it" }).click();
    await page.keyboard.press("Enter");
    await expect(step(page, "loop")).toContainText("Done");
    await step(page, "follow").getByRole("button", { name: "Do it" }).click();
    await page.locator('[aria-label="Inspector"] section', { has: page.locator("h3", { hasText: /^Imports \(/ }) }).getByRole("button").first().click();
    await expect(step(page, "follow")).toContainText("Done");
    await expect(panel(page).getByText("2 of 3 steps")).toBeVisible();
  });

  test("8.7 Close hides the panel and returns focus to Show steps; Show steps reopens it with the same state; Restart demo resets", async ({ page }) => {
    await openManor(page);
    await step(page, "follow").getByRole("button", { name: "Skip" }).click();
    await panel(page).getByRole("button", { name: "Close" }).click();
    await expect(panel(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Show steps" })).toBeFocused();
    expect(await focusedText(page)).toBe("Show steps");
    await page.getByRole("button", { name: "Show steps" }).click();
    await expect(panel(page)).toBeVisible();
    await expect(step(page, "follow")).toContainText("Skipped");
    await page.getByRole("button", { name: "Restart demo" }).click();
    await page.getByRole("button", { name: "Explore the manor" }).click();
    await expect(step(page, "follow")).toContainText("To do");
  });

  test("8.6 the annex has no steps panel and no Show steps button", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Explore the annex" }).click();
    await page.getByRole("application", { name: "Haunted map" }).waitFor();
    await expect(panel(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Show steps" })).toHaveCount(0);
  });

  test("8.4 step 3 is present with the registered handoff; with a stub handoff replacing it, Do it passes the arguments and completes", async ({ page }) => {
    await openManor(page);
    await expect(step(page, "compare")).toHaveCount(1);
    await registerCompare(page, "resolve");
    await expect(step(page, "compare")).toContainText("Compare revisions");
    await expect(step(page, "compare")).toContainText("Load the revised manor and watch which door disappears.");
    await expect(panel(page).getByText("0 of 3 steps")).toBeVisible();
    await settled(page);
    await step(page, "compare").getByRole("button", { name: "Do it" }).click();
    await expect(step(page, "compare")).toContainText("Done");
    await expect(panel(page).getByText("1 of 3 steps")).toBeVisible();
    const calls = await page.evaluate(() => (window as unknown as StubWindow).__compareCalls);
    expect(calls).toHaveLength(1);
    expect(calls?.[0]?.after).toEqual({ sample: "manor/after" });
    expect(calls?.[0]?.hasBefore).toBe(true);
    expect(typeof calls?.[0]?.layoutKey).toBe("string");
  });

  test("8.4 a rejecting handoff leaves step 3 as To do and writes no second status message", async ({ page }) => {
    await openManor(page);
    await registerCompare(page, "reject");
    const before = await page.locator('[role="status"]').textContent();
    await step(page, "compare").getByRole("button", { name: "Do it" }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as StubWindow).__compareCalls?.length)).toBe(1);
    await expect(step(page, "compare")).toContainText("To do");
    await expect(panel(page).getByText("0 of 3 steps")).toBeVisible();
    expect(await page.locator('[role="status"]').textContent()).toBe(before);
  });
});
