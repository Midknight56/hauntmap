import { expect, test, type Page } from "@playwright/test";
import { drawnDoorCenter, expected, openManor, inStaticValue, roomPoint, settled, snapshot, storeAction } from "./helpers";

const manor = expected();

const WORDING = [
  "Module: room",
  "Folder: wing",
  "Import or re-export: door and arrow",
  "Dependency cycle: looping corridor",
  "Unresolved or external import: sealed doorway with ?",
  "Not in this traversal: subdued room",
  "Dependency path: traveling light",
];
const FOOTER = "Rooms show files and doors show imports found in the source. The map does not show runtime behaviour, test coverage or risk.";

const tooltip = (page: Page) => page.getByRole("tooltip");

/** The center of a door or sealed doorway, from the scene's own rectangle. */
async function centerOf(page: Page, kind: "door" | "sealed", id: string): Promise<{ x: number; y: number }> {
  const rect = await page.evaluate(
    ([k, i]) => {
      const r = window.__hauntmap?.scene()?.screenRectOf({ kind: k as "door", id: i as string });
      return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
    },
    [kind, id] as const,
  );
  if (rect === null) throw new Error(`${kind} ${id} is not drawn`);
  return rect;
}

/** A point of a wing region that hits the wing itself, not a room or a door. */
async function wingPoint(page: Page, wing: string): Promise<{ x: number; y: number }> {
  const point = await page.evaluate((id) => {
    const scene = window.__hauntmap?.scene();
    const rect = scene?.screenRectOf({ kind: "wing", id });
    if (!scene || !rect) return null;
    for (let fy = 0.02; fy < 1; fy += 0.02) {
      for (let fx = 0.02; fx < 1; fx += 0.02) {
        const x = rect.x + rect.width * fx;
        const y = rect.y + rect.height * fy;
        const hit = scene.hitTest(x, y);
        if (hit?.kind === "wing" && hit.id === id) return { x, y };
      }
    }
    return null;
  }, wing);
  if (point === null) throw new Error(`no free point in ${wing}`);
  return point;
}

async function lines(page: Page): Promise<string[]> {
  return tooltip(page).locator("p").allTextContents();
}

test.describe("legend and tooltips", () => {
  test("5.1 and 5.5 the legend lists the seven entries in order, no comparison entries, and the footer", async ({ page }) => {
    await openManor(page);
    const toggle = page.getByRole("button", { name: "Legend" });
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const panel = page.getByRole("region", { name: "Legend" });
    expect(await panel.getByRole("listitem").allTextContents()).toEqual(WORDING);
    await expect(panel.getByText(FOOTER, { exact: true })).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("region", { name: "Legend" })).toHaveCount(0);
  });

  test("5.6 the legend state persists across a reload", async ({ page }) => {
    await openManor(page);
    await page.getByRole("button", { name: "Legend" }).click();
    await page.reload();
    await page.getByRole("button", { name: "Explore the manor" }).click();
    await expect(page.getByRole("button", { name: "Legend" })).toHaveAttribute("aria-expanded", "false");
    expect(JSON.parse((await page.evaluate(() => localStorage.getItem("hauntmap.prefs.v1"))) ?? "{}")).toMatchObject({ legendOpen: false });
  });

  test("5.2 hovering a room, a drawn door and a wing shows the legend wording and the fact; Escape dismisses it", async ({ page }) => {
    await openManor(page);
    const room = await roomPoint(page, "src/orders/checkout.ts");
    await page.mouse.move(room!.x, room!.y);
    await expect(tooltip(page)).toBeVisible();
    expect(await lines(page)).toEqual(["Module: room", "src/orders/checkout.ts \u00B7 TypeScript \u00B7 parsed"]);
    await page.keyboard.press("Escape");
    await expect(tooltip(page)).toHaveCount(0);

    const door = (await snapshot(page)).layout!.doors[0]!;
    const at = await drawnDoorCenter(page, door.relationId);
    await page.mouse.move(at.x + 1, at.y + 1);
    await page.mouse.move(at.x, at.y);
    await expect(tooltip(page)).toBeVisible();
    const record = manor.imports.find((r) => r.from === door.from && r.to === door.to && inStaticValue(r))!;
    expect(await lines(page)).toEqual([
      "Import or re-export: door and arrow",
      `${door.from} imports ${door.to} \u00B7 ${record.syntaxKind} \u00B7 ${record.dependencyKind} \u00B7 line ${record.line}`,
    ]);

    const wing = await wingPoint(page, "src/orders");
    await page.mouse.move(wing.x, wing.y);
    await expect(tooltip(page)).toBeVisible();
    expect(await lines(page)).toEqual(["Folder: wing", `src/orders \u00B7 ${manor.wings["src/orders"]} modules`]);
    await page.mouse.move(2, 400);
    await expect(tooltip(page)).toHaveCount(0);
  });

  test("5.2 a sealed doorway names its specifier, resolution and reason", async ({ page }) => {
    await openManor(page);
    await storeAction(page, "expandWing", "src/catalog");
    await settled(page);
    const sealed = (await snapshot(page)).layout!.sealed.find((s) => s.from === "src/catalog/search.ts")!;
    const at = await centerOf(page, "sealed", sealed.relationId);
    await page.mouse.move(at.x + 1, at.y + 1);
    await page.mouse.move(at.x, at.y);
    await expect(tooltip(page)).toBeVisible();
    expect(await lines(page)).toEqual(["Unresolved or external import: sealed doorway with ?", 'src/catalog/search.ts \u2192 "./synonyms" \u00B7 unresolved \u00B7 absent-file']);
  });

  test("5.2 a focused inspector item shows the tooltip of its element and blur hides it", async ({ page }) => {
    await openManor(page);
    await page.getByRole("tab", { name: "Evidence" }).click();
    const item = page.getByRole("button", { name: /^src\/orders\/checkout\.ts \u00B7 ok$/ });
    await item.focus();
    await expect(tooltip(page)).toBeVisible();
    expect(await lines(page)).toEqual(["Module: room", "src/orders/checkout.ts \u00B7 TypeScript \u00B7 parsed"]);
    await page.keyboard.press("Escape");
    await expect(tooltip(page)).toHaveCount(0);
    await item.focus();
    await page.getByRole("tab", { name: "Evidence" }).focus();
    await expect(tooltip(page)).toHaveCount(0);
  });

  test("2.5 after Focus a room outside the neighbourhood is `Not in this traversal`", async ({ page }) => {
    await openManor(page);
    await storeAction(page, "select", { kind: "module", id: "src/orders/checkout.ts" }, { from: "dom" });
    await page.getByRole("complementary", { name: "Inspector" }).getByRole("button", { name: "Focus" }).click();
    const filter = (await snapshot(page)).routeFilter!;
    // The camera is still moving to the selected room; wait until the rooms stand still.
    await page.waitForTimeout(800);
    const box = (await page.locator(".map-wrapper").boundingBox())!;
    const onScreen = async (id: string) => {
      const point = await roomPoint(page, id);
      return point !== null && point.x > box.x && point.x < box.x + box.width && point.y > box.y && point.y < box.y + box.height ? point : null;
    };
    let out: { x: number; y: number } | null = null;
    for (const id of manor.modules.map((m) => m.id).filter((id) => id.startsWith("src/orders/") && !filter.modules.includes(id))) {
      out = await onScreen(id);
      if (out !== null) break;
    }
    expect(out).not.toBeNull();
    await page.mouse.move(out!.x, out!.y);
    await expect(tooltip(page)).toBeVisible();
    expect((await lines(page))[0]).toBe("Not in this traversal: subdued room");
    const inn = await onScreen("src/orders/checkout.ts");
    await page.mouse.move(inn!.x, inn!.y);
    await expect.poll(async () => (await lines(page))[0]).toBe("Module: room");
  });
  test("5.4 the preset sits beside the headings and a change asks for one new layout", async ({ page }) => {
    await openManor(page);
    await page.getByRole("tab", { name: "Evidence" }).click();
    await expect(page.getByRole("heading", { name: "Evidence (static-value)" })).toBeVisible();
    const revision = () => page.evaluate(() => window.__hauntmap!.store.getState().layoutRevision);
    const before = await revision();
    await page.getByRole("combobox", { name: "Relation preset" }).selectOption("type-inclusive");
    await settled(page);
    expect(await revision()).toBe(before + 1);
    await expect(page.getByRole("heading", { name: "Evidence (type-inclusive)" })).toBeVisible();
  });
});
