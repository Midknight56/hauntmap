import { expect, test } from "@playwright/test";
import { openManor, sceneDebug, settled, storeAction } from "../../e2e/helpers";
import { READY_MANOR_PAIR, compareWithSample, waitForStatus } from "./helpers";

// Item 9 of the design pass, in the `dev` project: the dock block of the comparison, its legend, and the change shown on a collapsed wing.

test.describe("the comparison view of the design", () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test("the dock's left block is headed Compare revisions, holds the sentence in one element at 18 px with bold counts, and the legend lists ten entries", async ({ page }) => {
    await openManor(page);
    await settled(page);
    await compareWithSample(page);
    await waitForStatus(page, READY_MANOR_PAIR);
    await page.keyboard.press("Escape");
    const block = page.getByRole("region", { name: "Comparison summary" });
    await expect(block.getByRole("heading", { name: "Compare revisions" })).toBeVisible();
    const sentence = block.locator("p.comparison-sentence");
    await expect(sentence).toHaveCount(1);
    await expect(sentence).toHaveText(READY_MANOR_PAIR);
    const style = await sentence.evaluate((el) => ({
      size: getComputedStyle(el).fontSize,
      strong: [...el.querySelectorAll("strong")].map((s) => ({ text: s.textContent, weight: getComputedStyle(s).fontWeight })),
      dock: el.closest(".dock-left") !== null,
    }));
    expect(style.size).toBe("18px");
    expect(style.dock).toBe(true);
    expect(style.strong.map((s) => s.text)).toEqual(["1 removed", "1 added", "2 changed", "1 \u2192 0"]);
    for (const s of style.strong) expect(Number(s.weight)).toBeGreaterThanOrEqual(600);
    const entries = page.getByRole("list", { name: "Legend entries" }).getByRole("listitem");
    await expect(entries).toHaveCount(10);
    await expect(entries.nth(7)).toHaveText("Changed source: amber lamp");
    await expect(entries.nth(8)).toHaveText("Removed in the newer snapshot: ghost outline");
    await expect(entries.nth(9)).toHaveText("Added in the newer snapshot: green doorway");
    // The legend is two columns: the first entry and the second sit side by side.
    const [first, second] = await entries.evaluateAll((els) => els.slice(0, 2).map((el) => el.getBoundingClientRect().toJSON() as { top: number; left: number }));
    expect(Math.abs((first?.top ?? 0) - (second?.top ?? 99))).toBeLessThan(4);
    expect(second?.left ?? 0).toBeGreaterThan((first?.left ?? 0) + 100);
  });

  test("the removed door and the added door show on a collapsed wing as a dashed doorway and a doorway in moss", async ({ page }) => {
    await openManor(page);
    await settled(page);
    for (const wing of ["src/notifications", "src/orders"]) {
      await storeAction(page, "collapseWing", wing);
      await settled(page);
    }
    expect((await sceneDebug(page)).wingMarks).toEqual([]);
    await compareWithSample(page);
    await waitForStatus(page, READY_MANOR_PAIR);
    await page.keyboard.press("Escape");
    await settled(page);
    await expect.poll(async () => (await sceneDebug(page)).wingMarks.map((m) => `${m.wing}:${m.kind}`).sort()).toEqual([
      "src/notifications:added",
      "src/notifications:removed",
      "src/orders:added",
      "src/orders:removed",
    ]);
    // With the wings open the doors themselves are drawn and the wings carry no mark.
    for (const wing of ["src/notifications", "src/orders"]) {
      await storeAction(page, "expandWing", wing);
      await settled(page);
    }
    await expect.poll(async () => (await sceneDebug(page)).wingMarks).toEqual([]);
  });
});

test.describe("the comparison view on a phone", () => {
  test.use({ viewport: { width: 360, height: 640 } });

  test("the sentence is a card above the map, and the legend card lists the three comparison entries first", async ({ page }) => {
    await openManor(page);
    await settled(page);
    await page.getByRole("button", { name: "More" }).click();
    await compareWithSample(page);
    await waitForStatus(page, READY_MANOR_PAIR);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "More" }).click();
    const sentence = page.locator("p.comparison-sentence");
    await expect(sentence).toHaveText(READY_MANOR_PAIR);
    const [card, map] = await Promise.all([sentence.boundingBox(), page.locator(".map-wrapper").boundingBox()]);
    expect((card?.y ?? 9999) + (card?.height ?? 0)).toBeLessThanOrEqual(map?.y ?? 0);
    const first = await page.getByRole("list", { name: "Legend entries" }).getByRole("listitem").evaluateAll((els) => els.map((el) => ({ text: el.textContent, top: el.getBoundingClientRect().top })));
    const byTop = [...first].sort((a, b) => a.top - b.top).slice(0, 3).map((e) => e.text);
    expect(byTop).toEqual(["Changed source: amber lamp", "Removed in the newer snapshot: ghost outline", "Added in the newer snapshot: green doorway"]);
  });
});