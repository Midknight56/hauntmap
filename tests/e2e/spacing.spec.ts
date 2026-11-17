import { expect, test, type Page } from "@playwright/test";
import { compareAction } from "../compare/e2e/scene";
import { openManor, sceneDebug, settled, storeAction } from "./helpers";

// Item 10 of the design pass: on the landing page, the full map, a selected room and the comparison view, at 360 x 640 and at
// 1920 x 1080, no control is under 44 px tall, none is closer than 16 px to the screen edge on a phone, no two controls overlap,
// no text is clipped or under 12 px, and the page does not scroll sideways. Every failure names the control.

const SIZES = [
  { name: "phone", width: 360, height: 640 },
  { name: "desktop", width: 1920, height: 1080 },
] as const;

interface Audit {
  problems: string[];
  controls: number;
}

/** Runs in the page. It returns plain strings, one for each problem, each naming the element. */
async function audit(page: Page, edge: number): Promise<Audit> {
  return page.evaluate((edgePad) => {
    const problems: string[] = [];
    const nameOf = (el: Element): string => {
      const label = el.getAttribute("aria-label");
      const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      const placeholder = el.getAttribute("placeholder");
      return `${el.tagName.toLowerCase()}${el.getAttribute("role") === null ? "" : `[role=${el.getAttribute("role")}]`} "${(label ?? (text !== "" ? text : (placeholder ?? ""))).slice(0, 60)}"`;
    };
    const shown = (el: Element): boolean => {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 1 || rect.height <= 1) return false;
      const style = getComputedStyle(el);
      return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
    };
    const selector = 'button, select, input:not([type="hidden"]), textarea, a[href], summary, [role="tab"], [role="combobox"], [role="option"], [role="button"], [tabindex]:not([tabindex="-1"])';
    const seen = new Set<Element>();
    const boxes: { el: Element; rect: DOMRect }[] = [];
    for (const el of document.querySelectorAll(selector)) {
      if (!shown(el) && !(el instanceof HTMLInputElement && (el.type === "radio" || el.type === "checkbox"))) continue;
      // A radio button or a check box is hit through its label.
      const target = el instanceof HTMLInputElement && (el.type === "radio" || el.type === "checkbox") ? (el.closest("label") ?? el) : el;
      if (seen.has(target) || !shown(target)) continue;
      seen.add(target);
      boxes.push({ el: target, rect: target.getBoundingClientRect() });
    }
    const vw = window.innerWidth;
    for (const { el, rect } of boxes) {
      if (rect.height < 44 - 0.5) problems.push(`${nameOf(el)} is ${rect.height.toFixed(1)} px tall (at least 44) at ${Math.round(rect.left)},${Math.round(rect.top)}`);
      if (vw <= 720) {
        if (rect.left < edgePad - 0.5) problems.push(`${nameOf(el)} is ${rect.left.toFixed(1)} px from the left edge (at least ${edgePad})`);
        if (vw - rect.right < edgePad - 0.5) problems.push(`${nameOf(el)} is ${(vw - rect.right).toFixed(1)} px from the right edge (at least ${edgePad})`);
      }
      const el2 = el as HTMLElement;
      if (el2.scrollWidth > el2.clientWidth + 1 && !(el instanceof HTMLInputElement) && getComputedStyle(el).overflowX === "visible" && el2.clientWidth > 0) {
        problems.push(`${nameOf(el)} has text wider than its box (${el2.scrollWidth} > ${el2.clientWidth})`);
      }
    }
    // The map is under the zoom buttons and the minimap by design; every other pair of controls must stay apart.
    const inMap = (el: Element): boolean => el.classList.contains("map-wrapper");
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        if (inMap(a.el) || inMap(b.el) || a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const w = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
        const h = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
        if (w > 1 && h > 1) problems.push(`${nameOf(a.el)} overlaps ${nameOf(b.el)} (${w.toFixed(0)} x ${h.toFixed(0)} px)`);
      }
    }
    // Clipped text: a box that hides its overflow and has more content than it shows. The map's own boxes hold the canvas.
    const skip = ["map-wrapper", "map-host", "map-view", "view", "minimap", "visually-hidden"];
    const hiddenByDesign = (el: Element): boolean => el.hasAttribute("data-mirrored") || el.hasAttribute("data-empty");
    for (const el of document.body.querySelectorAll("*")) {
      if (skip.some((c) => el.classList.contains(c)) || el.closest(".visually-hidden") !== null || hiddenByDesign(el) || el instanceof SVGElement || !shown(el)) continue;
      const style = getComputedStyle(el);
      const clipsX = style.overflowX === "hidden" || style.overflowX === "clip";
      const clipsY = style.overflowY === "hidden" || style.overflowY === "clip";
      const e = el as HTMLElement;
      if ((clipsX && e.scrollWidth > e.clientWidth + 1) || (clipsY && e.scrollHeight > e.clientHeight + 1)) {
        problems.push(`${nameOf(el)} clips its content (${e.scrollWidth} x ${e.scrollHeight} in ${e.clientWidth} x ${e.clientHeight})`);
      }
      if (style.textOverflow === "ellipsis") problems.push(`${nameOf(el)} shortens its text with an ellipsis`);
    }
    // No text under 12 px: every element that holds a text node of its own.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (parent === null || (node.textContent ?? "").trim() === "" || !shown(parent) || parent.closest("script, style, canvas, svg") !== null) continue;
      const size = parseFloat(getComputedStyle(parent).fontSize);
      if (size < 12) problems.push(`${nameOf(parent)} has text at ${size} px (at least 12)`);
    }
    // Text cut in two by the edge of the screen or by the box that holds it (design pass 2, item 5). A line that lies wholly outside a
    // scrolling box is only scrolled away; a line that is partly in and partly out is cut off, and nobody can read it without moving
    // something. A box that scrolls sideways by design (the phone legend) may cut a line at its sides; no box may cut one at its top or bottom.
    const vh = window.innerHeight;
    const cutBy = (r: DOMRect, box: { left: number; top: number; right: number; bottom: number }, axis: "x" | "y"): boolean => {
      if (axis === "y") return r.bottom > box.top + 1 && r.top < box.bottom - 1 && (r.top < box.top - 1.5 || r.bottom > box.bottom + 1.5);
      return r.right > box.left + 1 && r.left < box.right - 1 && (r.left < box.left - 1.5 || r.right > box.right + 1.5);
    };
    const seenCut = new Set<string>();
    const textWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = textWalker.nextNode(); node !== null; node = textWalker.nextNode()) {
      const parent = node.parentElement;
      if (parent === null || (node.textContent ?? "").trim() === "" || !shown(parent)) continue;
      if (parent.closest("script, style, canvas, svg, .visually-hidden, .map-wrapper, .minimap, [data-empty], [data-mirrored]") !== null) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const lines = [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
      const boxes: { el: Element; box: DOMRect; x: boolean; y: boolean }[] = [];
      // The page itself is not a box here: the screen edge below is checked for it.
      for (let el: Element | null = parent; el !== null && el !== document.body; el = el.parentElement) {
        const style = getComputedStyle(el);
        const x = style.overflowX === "hidden" || style.overflowX === "clip";
        const y = style.overflowY !== "visible";
        if (x || y) boxes.push({ el, box: el.getBoundingClientRect(), x, y });
      }
      for (const r of lines) {
        const words = (node.textContent ?? "").trim().slice(0, 50);
        for (const b of boxes) {
          if (b.y && cutBy(r, b.box, "y")) {
            const key = `y|${nameOf(b.el)}|${words}`;
            if (!seenCut.has(key)) {
              problems.push(`the text "${words}" is cut off at the top or bottom of ${nameOf(b.el)}`);
              seenCut.add(key);
            }
          }
          if (b.x && cutBy(r, b.box, "x")) {
            const key = `x|${nameOf(b.el)}|${words}`;
            if (!seenCut.has(key)) {
              problems.push(`the text "${words}" is cut off at a side of ${nameOf(b.el)}`);
              seenCut.add(key);
            }
          }
        }
        const edge = { left: 0, top: 0, right: vw, bottom: vh };
        // A phone page scrolls up and down, so only its sides are an edge there; a desktop page is one screen.
        if (cutBy(r, edge, "x") || (vw > 720 && cutBy(r, edge, "y"))) {
          const key = `v|${nameOf(parent)}|${words}`;
          if (!seenCut.has(key)) {
              problems.push(`the text "${words}" in ${nameOf(parent)} runs over the edge of the screen`);
              seenCut.add(key);
            }
        }
      }
    }    if (document.documentElement.scrollWidth > vw) problems.push(`the page scrolls sideways (${document.documentElement.scrollWidth} > ${vw})`);
    return { problems, controls: boxes.length };
  }, edge);
}

async function expectClean(page: Page, what: string): Promise<void> {
  const edge = 16;
  const result = await audit(page, edge);
  expect(result.controls, `${what}: controls found`).toBeGreaterThan(1);
  expect(result.problems, `${what}\n${result.problems.join("\n")}`).toEqual([]);
}

async function openMore(page: Page): Promise<void> {
  const more = page.getByRole("button", { name: "More" });
  if ((await more.count()) > 0 && (await more.getAttribute("aria-expanded")) === "false") await more.click();
}

async function closeMore(page: Page): Promise<void> {
  const more = page.getByRole("button", { name: "More" });
  if ((await more.count()) > 0 && (await more.getAttribute("aria-expanded")) === "true") await more.click();
}

for (const size of SIZES) {
  test.describe(`spacing at ${size.width} x ${size.height} (${size.name})`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test("the landing page", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("button", { name: "Explore the manor" })).toBeVisible();
      await expectClean(page, `landing at ${size.width} x ${size.height}`);
    });

    test("the full map: steps, loops list, legend and search are on the first screen", async ({ page }) => {
      await openManor(page);
      await settled(page);
      await expect(page.getByRole("region", { name: "Investigation steps" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Dependency loops (static-value)" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Legend" })).toBeVisible();
      await expect(page.getByRole("combobox", { name: "Search modules" })).toBeVisible();
      await expect.poll(async () => (await sceneDebug(page)).activeTweens).toBe(0);
      await expectClean(page, `full map at ${size.width} x ${size.height}`);
      if (size.name === "phone") {
        await openMore(page);
        await expectClean(page, `full map with More open at ${size.width} x ${size.height}`);
      }
    });

    test("a selected room and its evidence", async ({ page }) => {
      await openManor(page);
      await settled(page);
      await storeAction(page, "select", { kind: "module", id: "src/notifications/receipt.ts" }, { from: "dom" });
      await expect(page.getByRole("complementary", { name: "Inspector" }).getByRole("heading", { level: 2 })).toBeVisible();
      await expect.poll(async () => (await sceneDebug(page)).activeTweens).toBe(0);
      await expectClean(page, `selected room at ${size.width} x ${size.height}`);
    });

    test("the comparison view", async ({ page }) => {
      await openManor(page);
      await settled(page);
      if (size.name === "phone") await openMore(page);
      await compareAction(page, "compareWithSample");
      await page.waitForFunction(() => /^Comparison ready/.test(document.querySelector('[role="status"]')?.textContent ?? ""));
      await settled(page);
      if (size.name === "phone") await closeMore(page);
      await expect(page.getByRole("region", { name: "Comparison summary" })).toBeVisible();
      await expect.poll(async () => (await sceneDebug(page)).activeTweens).toBe(0);
      await expectClean(page, `comparison at ${size.width} x ${size.height}`);
    });
  });
}
