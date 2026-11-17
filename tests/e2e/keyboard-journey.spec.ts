import { expect, test, type Page } from "@playwright/test";
import { openManor, shot } from "./helpers";
import { runKeyboardJourney } from "./journey";

// Requirement 11 on the release build (the `prod` project): the cycle journey with keyboard input
// only, the names and patterns of 11.4, and the viewport checks of 11.6.

/** Elements that need an accessible name, as the page computes it from aria-label, aria-labelledby, a label or text. */
async function unnamed(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const nameOf = (el: Element): string => {
      const label = el.getAttribute("aria-label");
      if (label !== null && label.trim() !== "") return label.trim();
      const by = el.getAttribute("aria-labelledby");
      if (by !== null) {
        const text = by
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
          .join(" ")
          .trim();
        if (text !== "") return text;
      }
      if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) {
        const text = Array.from(el.labels ?? [])
          .map((l) => l.textContent?.trim() ?? "")
          .join(" ")
          .trim();
        if (text !== "") return text;
      }
      return (el.textContent ?? "").trim();
    };
    const describe = (el: Element): string => `${el.tagName.toLowerCase()}${el.id !== "" ? `#${el.id}` : ""} "${(el.textContent ?? "").slice(0, 30)}"`;
    const out: string[] = [];
    for (const el of document.querySelectorAll("button, input, select")) if (nameOf(el) === "") out.push(`no name: ${describe(el)}`);
    for (const el of document.querySelectorAll("ul, ol")) if (nameOf(el) === "" || (el.getAttribute("aria-label") === null && el.getAttribute("aria-labelledby") === null)) out.push(`unnamed list: ${describe(el)}`);
    // A section that only wraps a named list (`.named-list`) is not a panel; every panel region is named.
    for (const el of document.querySelectorAll("section:not(.named-list)")) {
      if (el.getAttribute("aria-labelledby") === null && el.getAttribute("aria-label") === null) out.push(`section without a name: ${describe(el)}`);
    }
    return out;
  });
}

async function scrollsSideways(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
}

test.describe("keyboard-only journey and structure (release build)", () => {
  test("11.1 the cycle journey with the keyboard only, the inspector heading checked after every step", async ({ page }) => {
    await runKeyboardJourney(page, async () => {
      await shot(page, "docs/acceptance/img/keyboard-journey.png");
    });
  });

  test("11.2 the map wrapper has one Tab stop, its role, its name and its help text", async ({ page }) => {
    await openManor(page);
    const map = page.getByRole("application", { name: "Haunted map" });
    await expect(map).toHaveAttribute("tabindex", "0");
    const describedBy = await map.getAttribute("aria-describedby");
    expect(describedBy).not.toBeNull();
    await expect(page.locator(`[id="${describedBy ?? ""}"]`)).toHaveText(
      "Arrow keys pan, plus and minus zoom, 0 fits the map, F focuses the selected room, I moves to the inspector, Escape clears the selection, Tab leaves the map.",
    );
    expect(await page.locator("canvas[tabindex], canvas [tabindex]").count()).toBe(0);
  });

  test("11.4 every button, input, select and list has a name; tabs, regions and toggles carry their attributes", async ({ page }) => {
    await openManor(page);
    await page.getByRole("button", { name: "Dependency loops" }).click();
    await expect(page.getByRole("list", { name: "Loops" })).toBeVisible();
    expect(await unnamed(page)).toEqual([]);
    await expect(page.getByRole("complementary", { name: "Inspector" })).toBeVisible();
    await expect(page.getByRole("tablist", { name: "View" })).toBeVisible();
    const tabs = page.getByRole("tab");
    await expect(tabs).toHaveCount(2);
    await expect(page.getByRole("tab", { name: "Map" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tab", { name: "Evidence" })).toHaveAttribute("aria-selected", "false");
    await expect(page.getByRole("tabpanel")).toHaveCount(1);
    for (const region of ["Dependency loops (static-value)", "Investigation steps", "Legend"]) {
      await expect(page.getByRole("region", { name: region })).toBeVisible();
    }
    const legend = page.getByRole("button", { name: "Legend" });
    await expect(legend).toHaveAttribute("aria-expanded", "true");
    await legend.click();
    await expect(legend).toHaveAttribute("aria-expanded", "false");
    const motion = page.getByRole("button", { name: "Motion" });
    await expect(motion).toHaveAttribute("aria-pressed", "false");
    await motion.click();
    await expect(motion).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("tab", { name: "Evidence" }).click();
    expect(await unnamed(page)).toEqual([]);
    await expect(page.locator('[role="status"]')).toHaveCount(1);
    await expect(page.locator("[aria-live]")).toHaveCount(0);
  });

  test("11.6 no horizontal scroll at 1,024 x 640 and 1,280 x 720, with toolbar, map, inspector and trail visible", async ({ page }) => {
    for (const size of [
      { width: 1024, height: 640 },
      { width: 1280, height: 720 },
    ]) {
      await page.setViewportSize(size);
      await openManor(page);
      await page.getByRole("button", { name: "Dependency loops" }).click();
      await page.getByRole("list", { name: "Loops" }).getByRole("button").first().click();
      expect(await scrollsSideways(page), `${size.width} x ${size.height}`).toBe(false);
      await expect(page.getByRole("group", { name: "Toolbar" })).toBeVisible();
      await expect(page.getByRole("application", { name: "Haunted map" })).toBeVisible();
      await expect(page.getByRole("complementary", { name: "Inspector" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Evidence trail" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Evidence trail" }).getByRole("listitem")).toHaveCount(3);
      await page.reload();
    }
  });

  test("11.6 at 640 x 360 the inspector stacks under the map and the page scrolls vertically only", async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 360 });
    await openManor(page);
    expect(await scrollsSideways(page)).toBe(false);
    const boxes = await page.evaluate(() => {
      const map = document.querySelector(".map-wrapper")?.getBoundingClientRect();
      const inspector = document.querySelector('[aria-label="Inspector"]')?.getBoundingClientRect();
      return { mapBottom: map?.bottom ?? 0, mapLeft: map?.left ?? 0, inspectorTop: inspector?.top ?? 0, inspectorLeft: inspector?.left ?? 0 };
    });
    expect(boxes.inspectorTop).toBeGreaterThanOrEqual(boxes.mapBottom - 1);
    expect(boxes.inspectorLeft).toBe(boxes.mapLeft);
    // The inspector can be reached by scrolling the page, and the Evidence view works at this size.
    await page.getByRole("complementary", { name: "Inspector" }).scrollIntoViewIfNeeded();
    await expect(page.getByRole("complementary", { name: "Inspector" }).getByRole("heading", { level: 2 })).toBeInViewport();
    await page.getByRole("tab", { name: "Evidence" }).click();
    await expect(page.getByRole("heading", { name: "Evidence (static-value)" })).toBeVisible();
    expect(await scrollsSideways(page)).toBe(false);
  });
});
