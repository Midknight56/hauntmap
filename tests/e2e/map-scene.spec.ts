import { expect, test } from "@playwright/test";
import { wide } from "../ui/generators";
import {
  clickDoor,
  expected,
  inStaticValue,
  inspectorHeading,
  openFixture,
  openManor,
  relationKeyOf,
  sceneDebug,
  settled,
  shot,
  snapshot,
  storeAction,
  wingOfId,
} from "./helpers";

const manor = expected();

/** Unique static-value relations of the manor, from expected.json (the oracle of this spec). */
const relations = [...new Map(manor.imports.filter(inStaticValue).map((r) => [relationKeyOf(r), r])).values()];

type HookWindow = Window & { __hauntmap?: { scene(): { debug(): unknown } | null; store: { actions: Record<string, (...a: unknown[]) => unknown> } } };

test.describe("map scene", () => {
  test("2.2 the src/orders wing draws one door per in-preset relation between its modules (11 by hand)", async ({ page }) => {
    await openManor(page);
    const state = await snapshot(page);
    const inside = relations.filter((r) => r.resolution === "local" && wingOfId(r.from) === "src/orders" && wingOfId(r.to ?? "") === "src/orders");
    expect(inside).toHaveLength(11);
    expect(state.layout?.doors).toHaveLength(inside.length);
    expect(state.layout?.rooms).toHaveLength(manor.wings["src/orders"] ?? -1);
    await shot(page, "docs/acceptance/img/orders-wing.png");
  });

  test("2.3 sealed doorways sit on src/catalog/search.ts and src/shared/ids.ts, never as rooms", async ({ page }) => {
    await openManor(page);
    await storeAction(page, "expandWing", "src/catalog");
    await settled(page);
    await storeAction(page, "expandWing", "src/shared");
    await settled(page);
    const state = await snapshot(page);
    const expanded = new Set(["src/orders", "src/catalog", "src/shared"]);
    const boundary = relations.filter((r) => r.resolution !== "local" && expanded.has(wingOfId(r.from)));
    expect(state.layout?.sealed.map((s) => s.from).sort()).toEqual(boundary.map((r) => r.from).sort());
    expect(boundary.map((r) => `${r.from} ${r.specifier} ${r.resolution}`)).toEqual(
      expect.arrayContaining(["src/catalog/search.ts ./synonyms unresolved", "src/shared/ids.ts nanoid external"]),
    );
    expect(state.layout?.sealed.some((s) => s.from.startsWith("src/orders/"))).toBe(false);
    const roomCount = [...expanded].reduce((sum, wing) => sum + (manor.wings[wing] ?? 0), 0);
    expect(state.layout?.rooms).toHaveLength(roomCount);
  });

  test("2.9 a 22-character file name is clipped to 18 characters and an ellipsis; the full id stays in the Evidence view", async ({ page }) => {
    await openFixture(page, "long-name");
    await storeAction(page, "expandWing", "src/long");
    await settled(page);
    const state = await snapshot(page);
    expect(state.layout?.rooms[0]?.label).toBe("aVeryLongModuleNam\u2026");
    await page.getByRole("tab", { name: "Evidence" }).click();
    await expect(page.getByRole("button", { name: "src/long/aVeryLongModuleName.ts \u00B7 ok" })).toBeVisible();
  });

  test("3.4 the overview has one corridor per ordered wing pair with the count of drawn relations", async ({ page }) => {
    await openManor(page);
    await storeAction(page, "collapseWing", "src/orders");
    await settled(page);
    const state = await snapshot(page);
    const counts = new Map<string, number>();
    for (const r of relations) {
      if (r.resolution !== "local" || r.to === null) continue;
      const from = wingOfId(r.from);
      const to = wingOfId(r.to);
      if (from === to) continue;
      counts.set(`${from} -> ${to}`, (counts.get(`${from} -> ${to}`) ?? 0) + 1);
    }
    const drawn = new Map(state.layout?.corridors.map((c) => [`${c.fromWing} -> ${c.toWing}`, c.count]));
    expect(Object.fromEntries(drawn)).toEqual(Object.fromEntries(counts));
    expect(state.layout?.doors).toHaveLength(0);
  });

  test("3.5 a 120-module wing draws 80 rooms and one grouped room; searching brings m119 into the last slot", async ({ page }) => {
    await openFixture(page, "triad");
    await page.evaluate((inv) => {
      (window as Window & { __hauntmap?: { openInvestigation(i: unknown): void } }).__hauntmap?.openInvestigation(inv);
    }, wide);
    await storeAction(page, "expandWing", "src/big");
    await settled(page);
    let state = await snapshot(page);
    const big = state.layout?.rooms.filter((r) => r.wing === "src/big") ?? [];
    expect(big.map((r) => r.id)).toEqual(Array.from({ length: 80 }, (_, i) => `src/big/m${String(i).padStart(3, "0")}.ts`));
    expect(state.layout?.grouped.find((g) => g.wing === "src/big")?.label).toBe("+40 more modules");
    expect(state.status).toBe(
      "Showing 80 of 120 modules in src/big. Search to bring another module into view, or use the Evidence view for the full list.",
    );
    await storeAction(page, "expandWing", "src/big", "src/big/m119.ts");
    await settled(page);
    state = await snapshot(page);
    const ids = state.layout?.rooms.filter((r) => r.wing === "src/big").map((r) => r.id) ?? [];
    expect(ids).toHaveLength(80);
    expect(ids).toContain("src/big/m119.ts");
    expect(ids).not.toContain("src/big/m079.ts");
    const wing = state.layout?.wings.find((w) => w.wing === "src/big");
    expect((wing?.shownIds.length ?? 0) + (wing?.hiddenCount ?? 0)).toBe(120);
  });

  test("3.6 expanding and collapsing a wing keeps the camera and every wing rank", async ({ page }) => {
    await openManor(page);
    const before = await snapshot(page);
    const ranks = (s: typeof before) => Object.fromEntries((s.layout?.wings ?? []).map((w) => [w.wing, w.rank]));
    await storeAction(page, "collapseWing", "src/orders");
    await settled(page);
    const collapsed = await snapshot(page);
    expect(collapsed.camera).toEqual(before.camera);
    expect(ranks(collapsed)).toEqual(ranks(before));
    await storeAction(page, "expandWing", "src/orders");
    await settled(page);
    const again = await snapshot(page);
    expect(again.camera).toEqual(before.camera);
    expect(ranks(again)).toEqual(ranks(before));
  });

  test("9.2 a click on the center of each door of src/orders selects that relation", async ({ page }) => {
    await openManor(page);
    const { layout } = await snapshot(page);
    expect(layout?.doors.length).toBe(11);
    for (const door of layout?.doors ?? []) {
      await clickDoor(page, door.relationId);
      await expect(inspectorHeading(page)).toHaveText(`${door.from} imports ${door.to}`);
    }
  });

  test("9.3 the texture count stays at or below 24 and does not grow over three loads", async ({ page }) => {
    await page.goto("/");
    const counts: number[] = [];
    for (let load = 0; load < 3; load++) {
      await page.getByRole("button", { name: "Explore the manor" }).click();
      await page.waitForFunction(() => {
        const hook = (window as HookWindow).__hauntmap;
        const state = hook?.store as unknown as { getState(): { layout: unknown } } | undefined;
        return hook?.scene() != null && state?.getState().layout != null;
      });
      await storeAction(page, "openLoops");
      await storeAction(page, "chooseLoop", 0);
      await page.waitForTimeout(300);
      counts.push((await sceneDebug(page)).textureCount);
      await page.getByRole("button", { name: "Restart demo" }).click();
      await expect(page.getByRole("heading", { name: "HauntMap" })).toBeVisible();
    }
    for (const count of counts) expect(count).toBeLessThanOrEqual(24);
    expect(counts[1]).toBeLessThanOrEqual(counts[0] ?? 0);
    expect(counts[2]).toBeLessThanOrEqual(counts[0] ?? 0);
  });

  test("9.4 rooms outside the viewport are culled; the ticker stops while the document is hidden or the map is out of view", async ({ page }) => {
    await openManor(page);
    const home = (await snapshot(page)).camera;
    expect((await sceneDebug(page)).tickerRunning).toBe(true);
    expect((await sceneDebug(page)).visibleRooms).toBeGreaterThan(0);

    await storeAction(page, "setCamera", { x: 1_000_000, y: 1_000_000, zoom: 1 });
    await expect.poll(async () => (await sceneDebug(page)).visibleRooms).toBe(0);
    await storeAction(page, "setCamera", home);
    await expect.poll(async () => (await sceneDebug(page)).visibleRooms).toBeGreaterThan(0);

    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(async () => (await sceneDebug(page)).tickerRunning).toBe(false);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(async () => (await sceneDebug(page)).tickerRunning).toBe(true);

    await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>(".investigation");
      if (root) root.style.transform = "translateY(-5000px)";
    });
    await expect.poll(async () => (await sceneDebug(page)).tickerRunning).toBe(false);
    await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>(".investigation");
      if (root) root.style.transform = "";
    });
    await expect.poll(async () => (await sceneDebug(page)).tickerRunning).toBe(true);
  });

  test("9.5 one second after Clear selection no tween is running", async ({ page }) => {
    await openManor(page);
    await clickDoor(page, (await snapshot(page)).layout?.doors[0]?.relationId ?? "");
    await page.getByRole("button", { name: "Clear selection" }).click();
    await page.waitForTimeout(1000);
    expect((await sceneDebug(page)).activeTweens).toBe(0);
  });

  test("9.7 Restart demo destroys the scene; the next Explore the manor creates a fresh one", async ({ page }) => {
    await openManor(page);
    await page.evaluate(() => {
      (window as unknown as { __old?: unknown }).__old = (window as HookWindow).__hauntmap?.scene();
    });
    await page.getByRole("button", { name: "Restart demo" }).click();
    await expect(page.getByRole("heading", { name: "HauntMap" })).toBeVisible();
    const message = await page.evaluate(() => {
      try {
        (window as unknown as { __old: { debug(): unknown } }).__old.debug();
        return "no error";
      } catch (error) {
        return (error as Error).message;
      }
    });
    expect(message).toBe("Scene destroyed");
    await page.getByRole("button", { name: "Explore the manor" }).click();
    await page.waitForFunction(() => {
      const scene = (window as HookWindow).__hauntmap?.scene() as unknown;
      return scene != null && scene !== (window as unknown as { __old?: unknown }).__old;
    });
    expect((await sceneDebug(page)).tickerRunning).toBe(true);
  });
});
