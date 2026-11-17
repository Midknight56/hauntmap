import { expect, test, type Page } from "@playwright/test";
import { expandAllWings, openManor, settled, shot, storeAction } from "./helpers";

// Three look checks of the manor map at 1,280 x 720 and 1,920 x 1,080 (dev build, headless):
// the map pane fills the screen below the toolbar, the first view fits every wing, and the
// import-count labels on the corridors overlap neither each other nor rooms, doors or wing names.

const SIZES = [
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
] as const;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface LayoutProbe {
  wings: (Rect & { wing: string; expanded: boolean })[];
  rooms: Rect[];
  grouped: Rect[];
  doors: Rect[];
  sealed: Rect[];
  corridors: { fromWing: string; toWing: string; count: number; path: { x: number; y: number }[]; badge?: { x: number; y: number } }[];
}

const BADGE_W = 72;
const BADGE_H = 20;
/** The wing title plate is drawn in the top strip of an expanded wing (40 units, with its margin), and fills a collapsed wing. */
const WING_NAME_STRIP = 40;

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

async function readLayout(page: Page): Promise<LayoutProbe> {
  return page.evaluate(() => {
    const hook = (window as unknown as { __hauntmap: { store: { getState(): { layout: unknown } } } }).__hauntmap;
    return JSON.parse(JSON.stringify(hook.store.getState().layout)) as LayoutProbe;
  });
}

function badgeOverlaps(layout: LayoutProbe): string[] {
  const problems: string[] = [];
  // The scene draws a label at `badge`, or at the middle of the path when the layout has none.
  const badges = layout.corridors.map((c, i) => {
    const first = c.path[0] ?? { x: 0, y: 0 };
    const last = c.path[c.path.length - 1] ?? first;
    const at = c.badge ?? { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 };
    return { i, name: `${c.fromWing} -> ${c.toWing}`, rect: { x: at.x - BADGE_W / 2, y: at.y - BADGE_H / 2, w: BADGE_W, h: BADGE_H } };
  });
  const solid: [string, Rect][] = [
    ...layout.rooms.map((r): [string, Rect] => ["a room", r]),
    ...layout.grouped.map((r): [string, Rect] => ["a grouped room", r]),
    ...layout.doors.map((r): [string, Rect] => ["a door", r]),
    ...layout.sealed.map((r): [string, Rect] => ["a sealed doorway", r]),
    ...layout.wings.map((w): [string, Rect] => ["a wing name", w.expanded ? { x: w.x, y: w.y, w: w.w, h: WING_NAME_STRIP } : w]),
  ];
  for (const a of badges) {
    for (const [what, rect] of solid) if (overlaps(a.rect, rect)) problems.push(`label ${a.name} overlaps ${what}`);
    for (const b of badges) if (b.i > a.i && overlaps(a.rect, b.rect)) problems.push(`label ${a.name} overlaps label ${b.name}`);
  }
  return problems;
}

for (const size of SIZES) {
  test.describe(`manor map at ${size.width} x ${size.height}`, () => {
    test.use({ viewport: size });

    test("the map pane fills the space below the toolbar", async ({ page }) => {
      await openManor(page);
      await settled(page);
      const m = await page.evaluate(() => {
        const box = (selector: string) => document.querySelector(selector)?.getBoundingClientRect();
        const toolbar = box('[aria-label="Toolbar"]');
        const workspace = box(".workspace");
        const status = box('[role="status"]');
        const wrapper = box(".map-wrapper");
        const inspector = box('[aria-label="Inspector"]');
        const view = box("#view-panel");
        return {
          innerHeight: window.innerHeight,
          scrollHeight: document.documentElement.scrollHeight,
          toolbarBottom: toolbar?.bottom ?? 0,
          workspaceBottom: workspace?.bottom ?? 0,
          statusTop: status?.top ?? 0,
          statusBottom: status?.bottom ?? 0,
          wrapperTop: wrapper?.top ?? 0,
          wrapperBottom: wrapper?.bottom ?? 0,
          inspectorBottom: inspector?.bottom ?? 0,
          viewBottom: view?.bottom ?? 0,
        };
      });
      // The page is exactly one screen tall, the status line sits at its bottom, and the workspace fills what lies between.
      expect(m.scrollHeight).toBe(m.innerHeight);
      expect(Math.abs(m.statusBottom - m.innerHeight)).toBeLessThanOrEqual(1);
      expect(Math.abs(m.workspaceBottom - m.statusTop)).toBeLessThanOrEqual(1);
      // The map starts under the toolbar. The view column (map, legend, open panels) reaches the bottom of the workspace, and the map takes most of it.
      expect(Math.abs(m.wrapperTop - m.toolbarBottom)).toBeLessThanOrEqual(1);
      expect(Math.abs(m.viewBottom - m.workspaceBottom)).toBeLessThanOrEqual(1);
      expect(Math.abs(m.inspectorBottom - m.workspaceBottom)).toBeLessThanOrEqual(1);
      expect(m.wrapperBottom - m.wrapperTop).toBeGreaterThanOrEqual(0.75 * (m.workspaceBottom - m.toolbarBottom));
    });

    test("the first view fits every wing", async ({ page }) => {
      await openManor(page);
      await settled(page);
      const wings = (await readLayout(page)).wings.map((w) => w.wing);
      expect(wings.length).toBeGreaterThan(3);
      await expect
        .poll(async () =>
          page.evaluate((names) => {
            const scene = (window as unknown as { __hauntmap: { scene(): { screenRectOf(t: { kind: string; id: string }): DOMRect | null } | null } }).__hauntmap.scene();
            const box = document.querySelector(".map-wrapper")?.getBoundingClientRect();
            if (scene === null || box === undefined) return ["no scene"];
            return names.filter((name) => {
              const r = scene.screenRectOf({ kind: "wing", id: name });
              return r === null || r.left < box.left - 0.5 || r.top < box.top - 0.5 || r.right > box.right + 0.5 || r.bottom > box.bottom + 0.5;
            });
          }, wings),
        )
        .toEqual([]);
    });

    test("corridor labels overlap no other label, room, door or wing name", async ({ page }) => {
      await openManor(page);
      await settled(page);
      expect(badgeOverlaps(await readLayout(page))).toEqual([]);
      await expandAllWings(page);
      expect(badgeOverlaps(await readLayout(page))).toEqual([]);
    });
  });
}

test("the manor map with the dependency loop selected and its three doors listed (screenshot)", async ({ page }) => {
  await openManor(page);
  await settled(page);
  for (const wing of ["src/notifications", "src/payments"]) await storeAction(page, "expandWing", wing);
  await settled(page);
  await page.getByRole("button", { name: "Dependency loops" }).click();
  await page.getByRole("list", { name: "Loops" }).getByRole("button").first().click();
  await page.getByRole("button", { name: "Fit to view" }).click();
  const trail = page.locator(".evidence-trail");
  await expect(trail.getByRole("listitem")).toHaveCount(3);
  await trail.scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await shot(page, "docs/acceptance/img/manor-loop.png");
});
