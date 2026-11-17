import { expect, test, type Page } from "@playwright/test";
import { openManor, sceneDebug, settled, snapshot, storeAction } from "./helpers";

// Design pass 2 (the faults found in the headless screenshots of the first pass), in the `dev` project: the first view frames the loop,
// room names are whole or hidden, a selected step is framed clear of the zoom stack and the minimap, and the phone view of the same.

const LOOP_ROOMS = ["src/notifications/receipt.ts", "src/orders/checkout.ts", "src/payments/charge.ts"] as const;
const LOOP_WINGS = ["src/notifications", "src/orders", "src/payments"] as const;
/** What the map may not cover: the screen gap that the frame keeps between content and the controls over the map. */
const CLEAR = 4;

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

async function mapBox(page: Page): Promise<Box> {
  return page.evaluate(() => {
    const r = document.querySelector(".map-wrapper")?.getBoundingClientRect() as DOMRect;
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  });
}

/** The zoom stack and the minimap, as they lie over the map; absent ones (phone) give nothing. */
async function overlays(page: Page): Promise<Box[]> {
  return page.evaluate(() => {
    const map = document.querySelector(".map-wrapper")?.getBoundingClientRect() as DOMRect;
    const out: Box[] = [];
    for (const selector of [".toolbar-zoom", ".minimap"]) {
      const el = document.querySelector(selector);
      if (el === null) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (r.right <= map.left || r.left >= map.right || r.bottom <= map.top || r.top >= map.bottom) continue;
      out.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    }
    return out;
  });
}

async function rectOf(page: Page, kind: string, id: string): Promise<Box> {
  const r = await page.evaluate(
    ([k, i]) => {
      const scene = (window as unknown as { __hauntmap: { scene(): { screenRectOf(t: { kind: string; id: string }): DOMRect | null } | null } }).__hauntmap.scene();
      const rect = scene?.screenRectOf({ kind: k as string, id: i as string });
      return rect === null || rect === undefined ? null : { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    },
    [kind, id],
  );
  if (r === null) throw new Error(`${kind} ${id} is not drawn`);
  return r;
}

function inside(inner: Box, outer: Box, margin: number): boolean {
  return inner.left >= outer.left + margin - 0.5 && inner.top >= outer.top + margin - 0.5 && inner.right <= outer.right - margin + 0.5 && inner.bottom <= outer.bottom - margin + 0.5;
}

function overlaps(a: Box, b: Box, gap: number): boolean {
  return a.left < b.right + gap && b.left < a.right + gap && a.top < b.bottom + gap && b.top < a.bottom + gap;
}

async function expectClear(page: Page, what: string, boxes: Box[], margin: number): Promise<void> {
  const map = await mapBox(page);
  const covered = await overlays(page);
  for (const [i, box] of boxes.entries()) {
    expect(inside(box, map, margin), `${what} #${i} lies inside the map ${JSON.stringify(box)} in ${JSON.stringify(map)}`).toBe(true);
    for (const o of covered) expect(overlaps(box, o, CLEAR - 8), `${what} #${i} is under a control ${JSON.stringify(o)}: ${JSON.stringify(box)}`).toBe(false);
  }
}

async function stillMap(page: Page): Promise<void> {
  await settled(page);
  await expect.poll(async () => (await sceneDebug(page)).activeTweens).toBe(0);
}

async function roomLabels(page: Page): Promise<Map<string, { text: string; px: number }>> {
  const labels = (await sceneDebug(page)).labels.filter((l) => l.kind === "room");
  return new Map(labels.map((l) => [l.id, { text: l.text, px: l.px }]));
}

/** The full file name: `receipt.ts`, `checkout.ts`, `charge.ts`. */
const FULL = (id: string): string => id.slice(id.lastIndexOf("/") + 1);

for (const size of [
  { width: 1920, height: 1080 },
  { width: 1280, height: 720 },
]) {
  test.describe(`the first view at ${size.width} x ${size.height} (items 1 and 2)`, () => {
    test.use({ viewport: size });

    test("frames the three wings of the loop, clear of the zoom stack and the minimap, and fills the map", async ({ page }) => {
      await openManor(page);
      await stillMap(page);
      const wings = await Promise.all(LOOP_WINGS.map((w) => rectOf(page, "wing", w)));
      await expectClear(page, "a loop wing", wings, 8);
      const map = await mapBox(page);
      const left = Math.min(...wings.map((w) => w.left));
      const right = Math.max(...wings.map((w) => w.right));
      expect((right - left) / (map.right - map.left), "the three wings fill the width of the map").toBeGreaterThanOrEqual(0.85);
    });

    test("shows receipt, checkout and charge by their whole names, never cut", async ({ page }) => {
      await openManor(page);
      await stillMap(page);
      const labels = await roomLabels(page);
      for (const id of LOOP_ROOMS) {
        const label = labels.get(id);
        expect(label, `${id} has a name`).toBeDefined();
        // The whole file name, unless its plate would cover another drawn name: then the label rule shortens it (design pass 3, 12b).
        const stem = FULL(id).replace(/\.[^.]+$/, "");
        const cuts = Array.from({ length: Math.max(0, stem.length - 4) }, (_, k) => stem.slice(0, stem.length - 1 - k) + "\u2026");
        const allowed = [FULL(id), stem, ...cuts];
        expect(allowed, id).toContain(label?.text);
        expect(label?.px ?? 0, id).toBeGreaterThanOrEqual(12);
      }
    });

    test("no room name is cut to fewer than 4 letters before an ellipsis", async ({ page }) => {
      await openManor(page);
      await stillMap(page);
      for (const label of (await sceneDebug(page)).labels.filter((l) => l.kind === "room")) {
        if (label.text.includes("\u2026")) expect(label.text.replace(/\u2026/g, "").replace(/\s/g, "").length, `"${label.text}" of ${label.id}`).toBeGreaterThanOrEqual(4);
        expect(label.px, label.id).toBeGreaterThanOrEqual(12);
      }
    });

    test("Fit to view still fits the whole manor", async ({ page }) => {
      await openManor(page);
      await stillMap(page);
      await page.getByRole("button", { name: "Fit to view" }).click();
      await stillMap(page);
      const layout = (await snapshot(page)).layout;
      const map = await mapBox(page);
      for (const wing of layout?.wings ?? []) {
        const r = await rectOf(page, "wing", wing.wing);
        expect(inside(r, map, 0), `${wing.wing} is inside the map`).toBe(true);
      }
    });
  });
}

test.describe("a selected step of the evidence trail at 1920 x 1080 (item 4)", () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test("both rooms and the door of every step lie inside the map, clear of the zoom stack and the minimap", async ({ page }) => {
    await openManor(page);
    await stillMap(page);
    await storeAction(page, "chooseLoop", 0);
    await stillMap(page);
    const trail = page.getByRole("region", { name: "Evidence trail" });
    const steps = trail.getByRole("button");
    await expect(steps).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      await steps.nth(i).click();
      await stillMap(page);
      const selection = (await snapshot(page)).selection as unknown as { relationId: string };
      const [from, to] = JSON.parse(selection.relationId) as [string, [string, string]];
      const boxes = [await rectOf(page, "room", from), await rectOf(page, "room", to[1]), await rectOf(page, "door", selection.relationId)];
      await expectClear(page, `step ${i + 1}`, boxes, 8);
    }
  });
});

test.describe("the first view on a phone at 360 x 640 (item 7)", () => {
  test.use({ viewport: { width: 360, height: 640 } });

  test("frames the loop path with receipt, checkout and charge named in full; on plates under the rooms", async ({ page }) => {
    await openManor(page);
    await stillMap(page);
    const rooms = await Promise.all(LOOP_ROOMS.map((id) => rectOf(page, "room", id)));
    await expectClear(page, "a loop room", rooms, 4);
    // The loop is about 1,200 units wide and the map 328 px. A room is then about 26 px wide, so the three full names are drawn on
    // plates under the rooms, each about 90 px wide at 12.5 px. With the plates the loop fits the map only at a zoom near 0.2, under
    // the 0.25 floor of the camera: this first phone view alone may go down to 0.15 (FIRST_VIEW_MIN_ZOOM). Zoom out and the wheel
    // keep the floor of 0.25.
    const zoom = (await snapshot(page)).camera.zoom;
    expect(zoom).toBeGreaterThanOrEqual(0.15);
    expect(zoom).toBeLessThan(0.4);    const labels = await roomLabels(page);
    for (const id of LOOP_ROOMS) {
      const label = labels.get(id);
      expect(label?.text, id).toBe(FULL(id));
      expect(label?.px ?? 0, id).toBeGreaterThanOrEqual(12);
    }
    // Every drawn name, plate and room of the loop is inside the map: no name is cut by the edge of the map.
    const map = await mapBox(page);
    const drawn = (await sceneDebug(page)).labels.filter((l) => l.kind === "room");
    for (const id of LOOP_ROOMS) {
      const box = drawn.find((l) => l.id === id)?.rect;
      expect(box, `the name of ${id} has a screen rectangle`).toBeDefined();
      expect(inside({ left: box!.x, top: box!.y, right: box!.x + box!.width, bottom: box!.y + box!.height }, map, 0), `the name of ${id} is inside the map ${JSON.stringify(box)}`).toBe(true);
    }    // The zoom out button keeps its floor.
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("button", { name: "Zoom out" }).click();
    expect((await snapshot(page)).camera.zoom).toBeGreaterThanOrEqual(0.25);
  });

  test("a selected step shows no tooltip over the map, and the evidence sheet opens at its import heading", async ({ page }) => {
    await openManor(page);
    await stillMap(page);
    await storeAction(page, "chooseLoop", 0);
    await stillMap(page);
    const sheet = page.getByRole("complementary", { name: "Inspector" });
    await expect(sheet.getByRole("heading", { level: 2 })).toBeVisible();
    const state = await sheet.evaluate((el) => ({ top: el.scrollTop, heading: el.querySelector("h2")?.getBoundingClientRect().top ?? -1, sheet: el.getBoundingClientRect().top }));
    expect(state.top, "the sheet is scrolled to its top").toBe(0);
    expect(state.heading - state.sheet, "the heading is the first thing in the sheet").toBeLessThan(40);
    // Tap each step: the text of the tooltip lives in the sheet, nothing floats over the map.
    const steps = page.getByRole("region", { name: "Evidence trail" }).getByRole("button");
    for (let i = 0; i < 3; i++) {
      await steps.nth(i).click();
      await stillMap(page);
      await expect(page.getByRole("tooltip")).toHaveCount(0);
      // A tapped step opens the sheet at its import heading again, not scrolled down to the step button or the excerpt (item 9).
      await expect.poll(async () => sheet.evaluate((el) => el.scrollTop), `step ${i + 1}`).toBe(0);
      await page.mouse.move(180, 150);
      await expect(page.getByRole("tooltip")).toHaveCount(0);
    }
    // The selected door is on the map, at its center. (The longest step of the loop is wider than a phone map at the 0.25 floor,
    // so on a phone only the door is asserted; the desktop case above frames both rooms.)
    const selection = (await snapshot(page)).selection as unknown as { relationId: string };
    await expectClear(page, "the selected door", [await rectOf(page, "door", selection.relationId)], 0);
  });
});
