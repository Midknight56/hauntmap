import type { Page } from "@playwright/test";
import { expandAllWings, readStatus, sceneDebug, withScene, type HookRect } from "../../e2e/helpers";

export { expandAllWings, readStatus, sceneDebug };

// Browser helpers of the comparison specs, over the fleet's `tests/e2e/helpers.ts`. They read the page
// through `window.__hauntmap` (development build only); the types below describe the parts they use.

type Scene = {
  screenRectOf(target: { kind: string; id: string }): HookRect | null;
  debug(): Record<string, unknown>;
};
type HookWindow = { __hauntmap?: { scene(): Scene | null } };

export const READY_MANOR_PAIR = "Comparison ready: 1 removed, 1 added, 2 changed modules; loops 1 \u2192 0. Showing the newer snapshot.";

/** Open the `Compare revisions` panel with the toolbar button (it must exist in this build). */
export async function openComparePanel(page: Page): Promise<void> {
  const button = page.getByRole("button", { name: "Compare revisions" });
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
  await page.getByRole("region", { name: "Compare revisions" }).waitFor();
}

/** Open the panel and activate the one acquisition button (`Revised manor` or `Bundled manor pair`). */
export async function compareWithSample(page: Page, button: "Revised manor" | "Bundled manor pair" = "Revised manor"): Promise<void> {
  await openComparePanel(page);
  await page.getByRole("button", { name: button }).click();
}

/** Wait until the status region reads exactly `text`. */
export async function waitForStatus(page: Page, text: string, timeout = 20_000): Promise<void> {
  await page.waitForFunction((expected) => document.querySelector('[role="status"]')?.textContent === expected, text, { timeout });
}

/** Wait until the status region starts with `prefix`; returns the full text. */
export async function waitForStatusStart(page: Page, prefix: string, timeout = 20_000): Promise<string> {
  await page.waitForFunction((p) => (document.querySelector('[role="status"]')?.textContent ?? "").startsWith(p), prefix, { timeout });
  return readStatus(page);
}

async function rects(page: Page, kind: "room" | "wing", ids: readonly string[]): Promise<Record<string, HookRect | null>> {
  await withScene(page, () => true);
  return page.evaluate(
    ([k, list]) => {
      const scene = (window as unknown as HookWindow).__hauntmap?.scene();
      if (scene === null || scene === undefined) throw new Error("There is no scene to read");
      const out: Record<string, HookRect | null> = {};
      for (const id of list as string[]) {
        const r = scene.screenRectOf({ kind: k as string, id });
        out[id] = r === null ? null : { x: r.x, y: r.y, width: r.width, height: r.height };
      }
      return out;
    },
    [kind, ids] as const,
  );
}

/** Screen rectangles of rooms by module ID; `null` for a room that is not drawn. */
export const roomRects = (page: Page, ids: readonly string[]): Promise<Record<string, HookRect | null>> => rects(page, "room", ids);

/** Screen rectangles of wings by wing name. */
export const wingRects = (page: Page, wings: readonly string[]): Promise<Record<string, HookRect | null>> => rects(page, "wing", wings);

/** The wing names of the open investigation, sorted. */
export async function wingNames(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const hook = (window as unknown as { __hauntmap?: { store: { getState(): { investigation: { modules: { id: string }[] } | null } } } }).__hauntmap;
    const inv = hook?.store.getState().investigation;
    if (inv === null || inv === undefined) throw new Error("No investigation is open");
    const wing = (id: string): string => (id.lastIndexOf("/") < 0 ? "(root)" : id.slice(0, id.lastIndexOf("/")));
    return [...new Set(inv.modules.map((m) => wing(m.id)))].sort();
  });
}

/** The comparison-state map of the scene (`id` to state), read through `sceneDebug().states` (task 9). */
export async function sceneStates(page: Page): Promise<Record<string, string>> {
  return withScene(page, (scene) => ((scene as unknown as Scene).debug()["states"] ?? {}) as Record<string, string>);
}
