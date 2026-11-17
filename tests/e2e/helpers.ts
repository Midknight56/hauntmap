import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Locator, Page } from "@playwright/test";

// Browser helpers for the Playwright specs. They talk to the page through `window.__hauntmap`,
// which exists only in the build made with `--mode devhook`. The types below describe the parts
// the helpers use; nothing is imported from `src/scene` or any other source folder.

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface HookRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HookSceneDebug {
  textureCount: number;
  visibleRooms: number;
  tickerRunning: boolean;
  activeTweens: number;
  drawnDoors: number;
  particleCount: number;
  frames: number;
}

export interface HookScene {
  debug(): HookSceneDebug;
  screenRectOf(target: { kind: string; id: string }): HookRect | null;
}

export interface HookState {
  investigation: { modules: { id: string }[] } | null;
  layoutStatus: "idle" | "pending" | "failed";
  [key: string]: unknown;
}

export interface HauntmapHook {
  store: { getState(): HookState; actions: Record<string, (...args: never[]) => unknown> };
  registry: unknown;
  openInvestigation(investigation: unknown, source?: Record<string, string>): void;
  forceRendererFailure(on: boolean): void;
  loseContext(): void;
  failAnalysis(kind: "cycles" | "trace" | null): void;
  crashNextRender(): void;
  scene(): HookScene | null;
}

type HookWindow = Window & { __hauntmap?: HauntmapHook };

/** Open the landing page and choose `Explore the manor`; resolves when the first view is usable. */
export async function openManor(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore the manor" }).click();
  await page.waitForFunction(() => performance.getEntriesByName("hauntmap:usable").length > 0);
}

/**
 * Load `tests/ui/fixtures/<name>.json` through the development hook. Only the `dev` project has
 * the hook; a build without it fails here with a clear message.
 */
export async function openFixture(page: Page, name: string, source?: Record<string, string>): Promise<void> {
  const investigation: unknown = JSON.parse(readFileSync(join(REPO, "tests", "ui", "fixtures", `${name}.json`), "utf8"));
  await page.goto("/");
  await page.waitForFunction(() => (window as HookWindow).__hauntmap !== undefined, undefined, { timeout: 10_000 });
  await page.evaluate(
    ([inv, src]) => {
      const hook = (window as HookWindow).__hauntmap;
      if (hook === undefined) throw new Error("window.__hauntmap is missing: run this case in the dev project");
      hook.openInvestigation(inv, src ?? undefined);
    },
    [investigation, source ?? null] as const,
  );
}

/** The accessible name of the focused element, as far as the specs need it (aria-label, labelledby, label, text, title). */
async function focusedName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (el === null || el === document.body) return "";
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
    if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
      const text = Array.from(el.labels ?? [])
        .map((l) => l.textContent?.trim() ?? "")
        .join(" ")
        .trim();
      if (text !== "") return text;
    }
    const content = el.textContent?.trim() ?? "";
    if (content !== "") return content;
    return el.getAttribute("title")?.trim() ?? "";
  });
}

/** Press Tab until the focused element has this accessible name; fails after 200 presses. */
export async function tabTo(page: Page, accessibleName: string): Promise<void> {
  for (let presses = 0; presses < 200; presses++) {
    if ((await focusedName(page)) === accessibleName) return;
    await page.keyboard.press("Tab");
  }
  if ((await focusedName(page)) === accessibleName) return;
  throw new Error(`tabTo: no element named "${accessibleName}" received focus in 200 Tab presses`);
}

/** The focused element shows an outline and its center is not covered by another element. */
export async function assertFocusVisibleAndUnobscured(page: Page): Promise<void> {
  const result = await page.evaluate(() => {
    const el = document.activeElement;
    if (el === null || el === document.body) return { ok: false, why: "nothing has focus" };
    const style = getComputedStyle(el);
    if (style.outlineStyle === "none" || parseFloat(style.outlineWidth) <= 0) {
      return { ok: false, why: `outline is ${style.outlineStyle} ${style.outlineWidth}` };
    }
    const rect = el.getBoundingClientRect();
    const x = Math.min(Math.max(rect.left + rect.width / 2, 0), window.innerWidth - 1);
    const y = Math.min(Math.max(rect.top + rect.height / 2, 0), window.innerHeight - 1);
    const top = document.elementFromPoint(x, y);
    if (top === null || !(el.contains(top) || top.contains(el))) {
      return { ok: false, why: "another element covers the focused element" };
    }
    return { ok: true, why: "" };
  });
  if (!result.ok) throw new Error(`Focus is not visible and unobscured: ${result.why}`);
}

/** The text of the one status region. */
export async function readStatus(page: Page): Promise<string> {
  return (await page.locator('[role="status"]').first().textContent()) ?? "";
}

/** The first heading inside the inspector. */
export function inspectorHeading(page: Page): Locator {
  return page.locator('[aria-label="Inspector"]').getByRole("heading").first();
}

/** The scene's debug counters (development hook only). */
export async function sceneDebug(page: Page): Promise<HookSceneDebug> {
  return page.evaluate(() => {
    const scene = (window as HookWindow).__hauntmap?.scene();
    if (scene === null || scene === undefined) throw new Error("There is no scene to read");
    return scene.debug();
  });
}

export interface ManorExpected {
  modules: { id: string; language: string; parseStatus: string }[];
  /** Wing path to module count: `orders` in the file becomes `src/orders`. */
  wings: Record<string, number>;
  imports: {
    from: string;
    to: string | null;
    specifier: string;
    syntaxKind: string;
    dependencyKind: string;
    resolution: string;
    line: number;
    column: number;
  }[];
  diagnostics: { code: string; module?: string; line?: number; column?: number; specifier?: string }[];
  cycles: Record<string, { members: string[]; witness: { modules: string[]; relationIds: string[] } }[]>;
  receiptToCheckout: { specifier: string; importLine: number; useLine: number };
}

/** `public/demo/manor/before/expected.json` with the wing keys mapped to wing paths. */
export function expected(): ManorExpected {
  const raw = JSON.parse(readFileSync(join(REPO, "public", "demo", "manor", "before", "expected.json"), "utf8")) as Omit<
    ManorExpected,
    "wings"
  > & { wings: Record<string, number> };
  const wings: Record<string, number> = {};
  for (const [key, count] of Object.entries(raw.wings)) wings[`src/${key}`] = count;
  return { ...raw, wings };
}

/** Click the center of a door's screen rectangle. */
export async function clickDoor(page: Page, relationId: string): Promise<void> {
  const rect = await page.evaluate((id) => {
    const scene = (window as HookWindow).__hauntmap?.scene();
    if (scene === null || scene === undefined) throw new Error("There is no scene to click");
    return scene.screenRectOf({ kind: "door", id });
  }, relationId);
  if (rect === null) throw new Error(`The door ${relationId} is not drawn`);
  await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
}

/** Expand every wing of the open investigation and wait for the layout to settle. */
export async function expandAllWings(page: Page): Promise<void> {
  await page.evaluate(() => {
    // The wing of a module ID is its directory, or `(root)` for a top-level file.
    const wingOfLocal = (id: string): string => (id.lastIndexOf("/") < 0 ? "(root)" : id.slice(0, id.lastIndexOf("/")));
    const hook = (window as HookWindow).__hauntmap;
    const investigation = hook?.store.getState().investigation;
    if (hook === undefined || investigation === null || investigation === undefined) throw new Error("No investigation is open");
    const expand = hook.store.actions["expandWing"] as unknown as (wing: string) => void;
    for (const wing of new Set(investigation.modules.map((m) => wingOfLocal(m.id)))) expand(wing);
  });
  await page.waitForFunction(() => (window as HookWindow).__hauntmap?.store.getState().layoutStatus === "idle");
}

/** Write a screenshot only when `HAUNTMAP_SHOTS=1`. */
export async function shot(page: Page, path: string): Promise<void> {
  if (process.env["HAUNTMAP_SHOTS"] !== "1") return;
  await page.screenshot({ path });
}
