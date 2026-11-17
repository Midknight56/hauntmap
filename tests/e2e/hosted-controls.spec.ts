import { expect, test, type Page } from "@playwright/test";
import { openFixture, openManor, settled, snapshot, storeAction, tabTo } from "./helpers";

interface StubProps {
  store: { actions: { setStatus(message: string): void } };
}
interface StubHook {
  h(type: string, props: unknown, ...children: unknown[]): unknown;
  registry: {
    registerControl(slot: string, component: (props: StubProps) => unknown): void;
    registerHandoff(name: "compare", fn: (args: { before: unknown; after: unknown; layoutKey: string | null }) => Promise<void>): void;
  };
  store: { getState(): { layout: { layoutKey: string } | null } };
}
type StubWindow = Window & { __hauntmap: StubHook; __compareCalls?: { after: unknown; layoutKey: string | null; stateLayoutKey: string | null }[] };

async function toolbarNames(page: Page): Promise<string[]> {
  return page
    .locator('[aria-label="Toolbar"]')
    .locator("button, select, input, [role=tab]")
    .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") ?? el.textContent?.trim() ?? ""));
}

test.describe("hosted controls (dev build)", () => {
  test("10.1 the toolbar lists its controls in order, and a slot renders only what is registered", async ({ page }) => {
    await openFixture(page, "triad");
    await expect(page.getByRole("button", { name: "Restart demo" })).toBeVisible();
    expect(await toolbarNames(page)).toEqual([
      "Map",
      "Evidence",
      "Fit to view",
      "Zoom in",
      "Zoom out",
      "Clear selection",
      "Search modules",
      "Relation preset",
      "Dependency loops",
      "Legend",
      "Motion",
      "Compare revisions",
      "Open live snapshot",
      "Restart demo",
    ]);
    await page.evaluate(() => {
      const hook = (window as unknown as { __hauntmap: StubHook }).__hauntmap;
      const stub = (name: string) => () => hook.h("button", { type: "button" }, name);
      hook.registry.registerControl("live-snapshot", stub("Open live snapshot"));
      hook.registry.registerControl("export", stub("Export investigation"));
      hook.registry.registerControl("compare", stub("Compare revisions"));
    });
    const names = await toolbarNames(page);
    expect(names.slice(-4)).toEqual(["Export investigation", "Compare revisions", "Open live snapshot", "Restart demo"]);
    await tabTo(page, "Compare revisions");
  });

  test("10.2 there is one live region", async ({ page }) => {
    await openFixture(page, "triad");
    await expect(page.getByRole("button", { name: "Restart demo" })).toBeVisible();
    await expect(page.locator('[role="status"]')).toHaveCount(1);
    await expect(page.locator("[aria-live]")).toHaveCount(0);
  });

  test("10.3 a stub control's message with a backtick segment is rendered verbatim with the segment in <code>", async ({ page }) => {
    await openFixture(page, "triad");
    const message = "No live snapshot yet. Run `pnpm hauntmap analyze haunts/manor --out public/demo/live.json`, or let the Kiro hook write it.";
    await page.evaluate((text) => {
      const hook = (window as unknown as StubWindow).__hauntmap;
      hook.registry.registerControl("live-snapshot", (props) =>
        hook.h("button", { type: "button", onClick: () => props.store.actions.setStatus(text) }, "Open live snapshot"),
      );
    }, message);
    await page.getByRole("button", { name: "Open live snapshot" }).click();
    const region = page.locator('[role="status"]');
    await expect(region).toHaveText(message.replaceAll("`", ""));
    await expect(region.locator("code")).toHaveCount(1);
    await expect(region.locator("code")).toHaveText("pnpm hauntmap analyze haunts/manor --out public/demo/live.json");
  });

  test("10.4 the steps panel calls a stub compare handoff with the layoutKey and leaves camera, selection, route filter and wings unchanged", async ({ page }) => {
    await openManor(page);
    await settled(page);
    await storeAction(page, "select", { kind: "module", id: "src/orders/checkout.ts" }, { from: "dom" });
    await storeAction(page, "setCamera", { x: 120, y: -40, zoom: 1.5 });
    await settled(page);
    await page.evaluate(() => {
      const w = window as unknown as StubWindow;
      w.__compareCalls = [];
      w.__hauntmap.registry.registerHandoff("compare", async (args) => {
        w.__compareCalls?.push({ after: args.after, layoutKey: args.layoutKey, stateLayoutKey: w.__hauntmap.store.getState().layout?.layoutKey ?? null });
      });
    });
    const before = await snapshot(page);
    await page.locator('[data-step="compare"]').getByRole("button", { name: "Do it" }).click();
    await expect(page.locator('[data-step="compare"]')).toContainText("Done");
    const calls = await page.evaluate(() => (window as unknown as StubWindow).__compareCalls);
    expect(calls).toHaveLength(1);
    expect(calls?.[0]?.after).toEqual({ sample: "manor/after" });
    expect(calls?.[0]?.layoutKey).toMatch(/^[0-9a-f]{64}$/);
    expect(calls?.[0]?.layoutKey).toBe(calls?.[0]?.stateLayoutKey);
    const after = await snapshot(page);
    expect(after.camera).toEqual(before.camera);
    expect(after.selection).toEqual(before.selection);
    expect(after.routeFilter).toEqual(before.routeFilter);
    expect(after.expandedWings).toEqual(before.expandedWings);
    expect(after.layout).toEqual(before.layout);
  });

  test("10.5 a stub control that reports a failure leaves selection, camera, route filter and evidence trail deep-equal", async ({ page }) => {
    await openManor(page);
    await settled(page);
    await page.getByRole("button", { name: "Dependency loops" }).click();
    await page.getByRole("list", { name: "Loops" }).getByRole("button").first().click();
    await storeAction(page, "setCamera", { x: 60, y: 30, zoom: 1.25 });
    await page.evaluate(() => {
      const hook = (window as unknown as StubWindow).__hauntmap;
      hook.registry.registerControl("live-snapshot", (props) =>
        hook.h("button", { type: "button", onClick: () => props.store.actions.setStatus("Stub failure: nothing was loaded.") }, "Open live snapshot"),
      );
    });
    const trail = page.locator(".evidence-trail");
    await expect(trail.getByRole("listitem")).toHaveCount(3);
    const before = await snapshot(page);
    const trailBefore = await trail.innerText();
    expect(before.routeFilter?.kind).toBe("witness");
    await page.getByRole("button", { name: "Open live snapshot" }).click();
    await expect(page.locator('[role="status"]')).toHaveText("Stub failure: nothing was loaded.");
    const after = await snapshot(page);
    expect({ ...after, status: "" }).toEqual({ ...before, status: "" });
    expect(await trail.innerText()).toBe(trailBefore);
  });

  test("10.7 a stub export control moves focus into a stub dialog headed Export investigation", async ({ page }) => {
    await openFixture(page, "triad");
    await page.evaluate(() => {
      const hook = (window as unknown as StubWindow).__hauntmap;
      // A stub only: no export feature is built, so the dialog is made by hand.
      const open = (): void => {
        const dialog = document.createElement("div");
        dialog.setAttribute("role", "dialog");
        dialog.setAttribute("aria-modal", "true");
        dialog.setAttribute("aria-labelledby", "stub-export-title");
        const title = document.createElement("h2");
        title.id = "stub-export-title";
        title.tabIndex = -1;
        title.textContent = "Export investigation";
        dialog.append(title);
        document.body.append(dialog);
        title.focus();
      };
      hook.registry.registerControl("export", () => hook.h("button", { type: "button", onClick: open }, "Export investigation"));
    });
    await page.getByRole("button", { name: "Export investigation" }).focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Export investigation" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Export investigation" })).toBeFocused();
  });

  test("with no export control registered the slot renders nothing and no unavailable text appears", async ({ page }) => {
    await openFixture(page, "triad");
    await expect(page.getByRole("button", { name: "Restart demo" })).toBeVisible();
    await expect(page.locator('[data-slot="export"]')).toHaveCount(0);
    await expect(page.getByText("Export is not available in this build.")).toHaveCount(0);
  });
});