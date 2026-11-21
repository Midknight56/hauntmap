import { expect, test, type Page } from "@playwright/test";
import { openManor, sceneDebug, settled } from "./helpers";

// The faults that three first-time testers found on 20 November 2026 (docs/acceptance/blind-test-fixes-2026-11-20.md).
// Each case failed on the build before the fix, for the reason its name gives.

const TESTER_DESKTOP = { width: 1440, height: 900 };
const DESKTOP = { width: 1920, height: 1080 };
const PHONE = { width: 360, height: 640 };

function step(page: Page, id: string) {
  return page.locator(`[data-step="${id}"]`);
}

async function openAnnex(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore the annex" }).click();
  await page.getByRole("application", { name: "Haunted map" }).waitFor();
  await page.waitForFunction(() => (window as unknown as { __hauntmap?: { scene(): unknown } }).__hauntmap?.scene() != null);
  await settled(page);
}

/** The lines (tops of the line boxes, rounded) that a piece of text of an element covers. */
async function linesOf(page: Page, selector: string, piece: string): Promise<number[]> {
  return page.evaluate(
    ([sel, text]) => {
      const root = document.querySelector(sel as string);
      if (root === null) throw new Error(`no ${sel as string}`);
      const full = root.textContent ?? "";
      const start = full.indexOf(text as string);
      if (start < 0) throw new Error(`"${text as string}" is not in ${sel as string}`);
      // Walk the text nodes to the start and the end of the piece.
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      let seen = 0;
      let startSet = false;
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const length = node.textContent?.length ?? 0;
        if (!startSet && start < seen + length) {
          range.setStart(node, start - seen);
          startSet = true;
        }
        if (startSet && start + (text as string).length <= seen + length) {
          range.setEnd(node, start + (text as string).length - seen);
          break;
        }
        seen += length;
      }
      const tops = [...range.getClientRects()].filter((r) => r.width > 0.5).map((r) => Math.round(r.top));
      return [...new Set(tops)];
    },
    [selector, piece] as const,
  );
}

test.describe("the tour on a desktop of the testers' size (1440 x 900)", () => {
  test.use({ viewport: TESTER_DESKTOP });

  test("Do it on Follow a dependency completes the step and the counter reads 1 of 3 steps", async ({ page }) => {
    await openManor(page);
    await step(page, "follow").getByRole("button", { name: "Do it" }).click();
    await expect(step(page, "follow")).toContainText("Done");
    await expect(page.getByRole("region", { name: "Investigation steps" }).getByText("1 of 3 steps")).toBeVisible();
  });

  test("after Do it on Follow a dependency the step list stays on the screen", async ({ page }) => {
    await openManor(page);
    await step(page, "follow").getByRole("button", { name: "Do it" }).click();
    await settled(page);
    await page.waitForTimeout(400);
    const box = await step(page, "follow").boundingBox();
    expect(box, "the step is drawn").not.toBeNull();
    expect(box?.y ?? -1, "the top of the step is on the screen").toBeGreaterThanOrEqual(0);
    expect((box?.y ?? 0) + (box?.height ?? 0), "the bottom of the step is on the screen").toBeLessThanOrEqual(TESTER_DESKTOP.height);
  });

  test("the file name in step 1 breaks only after a slash", async ({ page }) => {
    await openManor(page);
    for (const part of ["src/", "orders/", "checkout.ts"]) {
      expect(await linesOf(page, '[data-step="follow"] p', part), `"${part}" is on one line`).toHaveLength(1);
    }
  });

  test("the status of every step stays on one line with its colon", async ({ page }) => {
    await openManor(page);
    for (const id of ["follow", "loop", "compare"]) {
      expect(await linesOf(page, `[data-step="${id}"] h3`, ": To do"), `${id}: "To do"`).toHaveLength(1);
    }
  });
});

test.describe("the tour on a phone (360 x 640)", () => {
  test.use({ viewport: PHONE });

  test("the step list shows without opening More, also after Do it on step 1", async ({ page }) => {
    await openManor(page);
    const panel = page.getByRole("region", { name: "Investigation steps" });
    await expect(panel).toBeVisible();
    await step(page, "follow").getByRole("button", { name: "Do it" }).click();
    await settled(page);
    await expect(page.getByRole("button", { name: "More" })).toHaveAttribute("aria-expanded", "false");
    await expect(panel).toBeVisible();
    await expect(panel.getByText("1 of 3 steps")).toBeVisible();
    // The step the reader is on now, with its buttons, and the evidence of the selection under it, with nothing on top of the list.
    const doIt = step(page, "loop").getByRole("button", { name: "Do it" });
    await doIt.scrollIntoViewIfNeeded();
    await expect(doIt).toBeVisible();
    const covered = await doIt.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return top === null || !(el === top || el.contains(top));
    });
    expect(covered, "nothing covers the Do it button of the next step").toBe(false);
    await expect(page.getByRole("complementary", { name: "Inspector" })).toBeVisible();
  });

  test("behind More the zoom buttons line up with the other controls", async ({ page }) => {
    await openManor(page);
    await page.getByRole("button", { name: "More" }).click();
    const left = async (name: string): Promise<number> => (await page.getByRole("button", { name, exact: true }).boundingBox())?.x ?? -1;
    const restart = await left("Restart demo");
    expect(await left("Fit to view"), "Fit to view starts where Restart demo starts").toBeCloseTo(restart, 0);
    expect(await left("Zoom out"), "Zoom out starts where Restart demo starts").toBeCloseTo(restart, 0);
  });
});

for (const size of [TESTER_DESKTOP, DESKTOP]) {
  test.describe(`the annex at ${size.width} x ${size.height}`, () => {
    test.use({ viewport: size });

    test("no ghost covers the module count of a closed wing", async ({ page }) => {
      await openAnnex(page);
      await page.waitForTimeout(300);
      const debug = await sceneDebug(page);
      const ghosts = debug.fx.ghosts;
      expect(ghosts, "the scene reports where it draws each ghost").toBeDefined();
      expect(ghosts?.length ?? 0, "the annex has its three loops").toBe(3);
      const notes = debug.labels.filter((l) => l.kind === "wing-note" && l.rect !== undefined);
      expect(notes.length).toBeGreaterThan(0);
      const problems: string[] = [];
      for (const g of ghosts ?? []) {
        for (const n of notes) {
          const r = n.rect as NonNullable<typeof n.rect>;
          const w = Math.min(g.x + g.width, r.x + r.width) - Math.max(g.x, r.x);
          const h = Math.min(g.y + g.height, r.y + r.height) - Math.max(g.y, r.y);
          if (w > 0.5 && h > 0.5) problems.push(`a ghost at ${Math.round(g.x)},${Math.round(g.y)} covers "${n.text}" of ${n.id}`);
        }
      }
      expect(problems).toEqual([]);
    });

    test("the empty place of the loops list says how to show the loops", async ({ page }) => {
      await openAnnex(page);
      const hint = page.locator(".dock-left");
      await expect(hint).toContainText("Press Dependency loops to list the loops of this map.");
      await page.getByRole("button", { name: "Dependency loops" }).click();
      await expect(hint).not.toContainText("Press Dependency loops to list");
    });
  });
}

for (const size of [TESTER_DESKTOP, PHONE]) {
  test.describe(`the relation preset at ${size.width} x ${size.height}`, () => {
    test.use({ viewport: size });

    test("says in plain words what the chosen preset shows", async ({ page }) => {
      await openManor(page);
      if (size.width <= 720) await page.getByRole("button", { name: "More" }).click();
      const select = page.getByRole("combobox", { name: "Relation preset" });
      const hintId = await select.getAttribute("aria-describedby");
      expect(hintId, "the select is described by a hint").not.toBeNull();
      const hint = page.locator(`[id="${hintId}"]`);
      await expect(hint).toBeVisible();
      await expect(hint).toHaveText("static-value: imports that run. Imports of types only are left out.");
      await select.selectOption("type-inclusive");
      await expect(hint).toHaveText("type-inclusive: imports that run and imports of types only.");
      await select.selectOption("dynamic-inclusive");
      await expect(hint).toHaveText("dynamic-inclusive: imports that run and import() calls with a fixed path.");
      const px = await hint.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(px).toBeGreaterThanOrEqual(12);
    });
  });
}

/** Every pair of shown controls that sit side by side or one above the other, closer than 12 px; and on a phone every control closer than 16 px to the screen edge. */
async function crowded(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const shown = (el: Element): boolean => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 1 && r.height > 1 && s.visibility !== "hidden" && s.display !== "none";
    };
    const els = [...document.querySelectorAll('button, select, input:not([type="hidden"]), a[href], [role="tab"]')].filter(shown);
    const name = (e: Element): string => (e.getAttribute("aria-label") ?? e.textContent ?? "").trim().slice(0, 30);
    const out: string[] = [];
    for (let i = 0; i < els.length; i++) {
      for (let j = i + 1; j < els.length; j++) {
        const a = (els[i] as Element).getBoundingClientRect();
        const b = (els[j] as Element).getBoundingClientRect();
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        // Side by side (they share rows) or one above the other (they share columns); the gap between them.
        const gaps = [oy > 0 ? Math.max(a.left, b.left) - Math.min(a.right, b.right) : Infinity, ox > 0 ? Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom) : Infinity];
        const gap = Math.min(...gaps);
        if (gap < 11.5) out.push(`${name(els[i] as Element)} and ${name(els[j] as Element)} are ${gap.toFixed(1)} px apart`);
      }
    }
    if (innerWidth <= 720) {
      for (const e of els) {
        const r = e.getBoundingClientRect();
        if (r.left < 15.5 || innerWidth - r.right < 15.5) out.push(`${name(e)} is closer than 16 px to the edge`);
      }
    }
    return out;
  });
}

for (const size of [PHONE, DESKTOP]) {
  test.describe(`controls keep 12 px apart at ${size.width} x ${size.height}`, () => {
    test.use({ viewport: size });

    test("on the landing page, the first screen of the manor, the open menu and a selection", async ({ page }) => {
      await page.goto("/");
      const problems: string[] = (await crowded(page)).map((p) => `landing: ${p}`);
      await openManor(page);
      await settled(page);
      problems.push(...(await crowded(page)).map((p) => `manor: ${p}`));
      if (size.width <= 720) {
        await page.getByRole("button", { name: "More" }).click();
        // The menu slides in over 200 ms: measure where it comes to rest.
        await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished)));
        problems.push(...(await crowded(page)).map((p) => `menu: ${p}`));
        await page.getByRole("button", { name: "More" }).click();
      }
      await step(page, "follow").getByRole("button", { name: "Do it" }).click();
      await settled(page);
      problems.push(...(await crowded(page)).map((p) => `selection: ${p}`));
      expect(problems).toEqual([]);
    });
  });
}