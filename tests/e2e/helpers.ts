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
  labels: { kind: "wing" | "wing-note" | "room" | "note" | "step" | "glyph" | "count"; id: string; text: string; px: number; rect?: { x: number; y: number; width: number; height: number }; plate?: { x: number; y: number; width: number; height: number } }[];
  ghost: { leg: number; x: number; y: number } | null;
  glow: boolean;
  glowAlpha: number | null;
  light: { x: number; y: number } | null;
  wingMarks: { wing: string; kind: "removed" | "added" }[];
  theme: string;
  /** What the effects of the motion pass drew now (design pass 3). */
  fx: HookFx;
}

export interface HookDoorBox {
  relationId: string;
  /** The center and the width of the door in scene units. */
  x: number;
  y: number;
  w: number;
  /** The box in client pixels. */
  rect: HookRect;
  widthPx: number;
  open: number;
  openingPx: number;
}

export interface HookFx {
  /** The time the scene has animated, in milliseconds: the sum of its frame times (a frame counts at most 100 ms). Durations are measured in it, so that a loaded machine does not change them. */
  clock: number;
  /** The camera as drawn this frame (the store holds the target). */
  camera: { x: number; y: number; zoom: number };
  motes: { x: number; y: number }[];
  /** The opacity of each lamp of a changed room. */
  lamps: number[];
  /** The opacity of every room by module ID. */
  roomAlphas: Record<string, number>;
  /** The opacity of the layer that holds the rooms (it fades in on the first load of a manor). */
  layerAlpha: number;
  /** The scale of each added doorway mark (it grows from 0.2 to 1). */
  addedScales: number[];
  /** The closing corridor and the ghost that walked it, while they fade; null when nothing fades. */
  farewell: { corridor: number; ghost: number } | null;
  /** The opacity of the dashed outline of each removed door and of the solid corridor that it replaces. */
  removed: { outline: number; solid: number }[];
  /** The door of the selected relation: how far it has swung open and how far its corridor is drawn (0 to 1); null when no door is selected. */
  door: { swing: number; draw: number } | null;
  /** The doors that swing for the ghost or the traveling light: center and width in scene units, and the phase of the swing (halloween detail pass). */
  doors: { relationId: string; x: number; y: number; w: number; state: "closed" | "opening" | "open" | "closing"; swing: number }[];
  /** The rooms of the loop the ghost walks: lit or dim, and the lap the ghost is on; null when no loop is shown. */
  loop: { lap: number; rooms: { id: string; lit: boolean; glow: number; brightness: number }[] } | null;
  /** Every drawn effect of the halloween pass with its box in client pixels; `visible` is false while it rests, is culled or would cover a name. */
  decor: { kind: "web" | "crack" | "candle" | "fog" | "bat" | "spider"; moving: boolean; visible: boolean; rect: { x: number; y: number; width: number; height: number } }[];
  /** The milliseconds per frame that the update of each effect takes (a running mean over the last frames); dev build only. */
  /** The width on the screen, in pixels, of each swinging door leaf, and the number of dark doorways drawn behind them. */
  doorPx: number[];
  doorways: number;
  /** Every drawn door: its box in client pixels, its width on the screen, how far its panel is open (0 shut, 1 open) and how wide the opening is in pixels. */
  doorBoxes: HookDoorBox[];
  /** How many times the frames and doorways of the doors were drawn again since the map was drawn (a camera step does; a swing never does). */
  doorDraws: number;
  cost: Record<"fog" | "bats" | "spiders" | "motes" | "doors" | "loopLights" | "candles" | "ghost", number>;
  /** The haunt of each loop the ghost walks: the phase, the door, the opacity of the ghost, the rattle of the door and what is on screen. */
  haunts: HookHaunt[];
  /** The seed of the random of the haunts (a development build can fix it with `?hauntSeed=`). */
  hauntSeed: number | null;
}

export interface HookHaunt {
  phase: "none" | "enter" | "shake" | "burst" | "exit";
  door: string | null;
  ghostAlpha: number;
  /** The offset of the door panel and frame, in scene units. */
  shake: { x: number; y: number };
  critters: { id: number; kind: "bat" | "cat"; x: number; y: number; alpha: number; visible: boolean; rect: HookRect }[];
  puffs: { x: number; y: number; r: number; alpha: number; visible: boolean; rect: HookRect }[];
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
  setTheme(name: "candlelit-manor" | "moonlit-crypt" | "graveyard-fog"): void;
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
export async function focusedName(page: Page): Promise<string> {
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
  return withScene(page, (scene) => scene.debug());
}

/**
 * Run `read` against the live scene. The scene is created asynchronously after the map mounts and is destroyed and
 * rebuilt by `Retry map`, so the handle is looked up again inside the page on every try, for up to 10 s, and the read
 * runs in the same task as the lookup. A scene that never appears still fails with the same message.
 */
export async function withScene<T>(page: Page, read: (scene: HookScene) => T): Promise<Awaited<T>> {
  return page.evaluate(
    async ([source]) => {
      const run = new Function("scene", `return (${source as string})(scene);`) as (scene: unknown) => unknown;
      const deadline = performance.now() + 10_000;
      for (;;) {
        const scene = (window as HookWindow).__hauntmap?.scene();
        if (scene !== null && scene !== undefined) return (await run(scene)) as never;
        if (performance.now() > deadline) throw new Error("There is no scene to read");
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    },
    [read.toString()] as const,
  );
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

/**
 * The center, in client pixels, of the door the scene draws for `relationId` (`fx.doorBoxes` of the debug data). The scene draws a door on
 * the wall of its room just outside it (src/scene/doorPlace.ts), so this is where a person sees the door, not the layout's door box.
 */
export async function drawnDoorCenter(page: Page, relationId: string): Promise<{ x: number; y: number }> {
  const boxes = (await sceneDebug(page)).fx.doorBoxes;
  const box = boxes.find((b) => b.relationId === relationId);
  if (box === undefined) throw new Error(`The door ${relationId} is not drawn`);
  return { x: box.rect.x + box.rect.width / 2, y: box.rect.y + box.rect.height / 2 };
}

/** Click the center of the drawn door of a relation (`drawnDoorCenter`). */
export async function clickDrawnDoor(page: Page, relationId: string): Promise<void> {
  const at = await drawnDoorCenter(page, relationId);
  await page.mouse.click(at.x, at.y);
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

/** The parts of the view state the specs compare, read through the development hook. */
export interface StateSnapshot {
  camera: { x: number; y: number; zoom: number };
  selection: { kind: string; [key: string]: unknown };
  routeFilter: { kind: string; modules: string[]; relationIds: string[] } | null;
  expandedWings: string[];
  status: string;
  activeView: string;
  panelKind: string;
  layoutStatus: string;
  layout: {
    rooms: { id: string; wing: string; label: string }[];
    doors: { relationId: string; from: string; to: string }[];
    sealed: { relationId: string; from: string }[];
    grouped: { wing: string; label: string; hiddenCount: number }[];
    corridors: { fromWing: string; toWing: string; count: number }[];
    wings: { wing: string; expanded: boolean; rank: number; shownIds: string[]; hiddenCount: number }[];
    bounds: { x: number; y: number; w: number; h: number };
  } | null;
}

export async function snapshot(page: Page): Promise<StateSnapshot> {
  return page.evaluate(() => {
    const hook = (window as HookWindow).__hauntmap;
    if (hook === undefined) throw new Error("window.__hauntmap is missing: run this case in the dev project");
    const s = hook.store.getState() as unknown as StateSnapshot & { panel: { kind: string } };
    return JSON.parse(
      JSON.stringify({
        camera: s.camera,
        selection: s.selection,
        routeFilter: s.routeFilter,
        expandedWings: s.expandedWings,
        status: s.status,
        activeView: s.activeView,
        panelKind: s.panel.kind,
        layoutStatus: s.layoutStatus,
        layout: s.layout,
      }),
    ) as StateSnapshot;
  });
}

/** Call a store action by name through the development hook. */
export async function storeAction(page: Page, name: string, ...args: unknown[]): Promise<void> {
  await page.evaluate(
    ([action, params]) => {
      const hook = (window as HookWindow).__hauntmap;
      if (hook === undefined) throw new Error("window.__hauntmap is missing: run this case in the dev project");
      (hook.store.actions[action as string] as unknown as (...a: unknown[]) => void)(...(params as unknown[]));
    },
    [name, args] as const,
  );
}

/** Wait until the layout worker has answered the last request. */
export async function settled(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as HookWindow).__hauntmap?.store.getState().layoutStatus === "idle");
}

/** A client point inside a room that hits the room itself and none of its doors; null when the room is not drawn. */
export async function roomPoint(page: Page, id: string): Promise<{ x: number; y: number } | null> {
  return page.evaluate((moduleId) => {
    type Scene = { screenRectOf(t: { kind: string; id: string }): DOMRect | null; hitTest(x: number, y: number): { kind: string; id: string } | null };
    const scene = (window as HookWindow).__hauntmap?.scene() as unknown as Scene | null | undefined;
    const rect = scene?.screenRectOf({ kind: "room", id: moduleId });
    if (!scene || !rect) return null;
    for (let fy = 0.1; fy < 1; fy += 0.1) {
      for (let fx = 0.1; fx < 1; fx += 0.1) {
        const x = rect.x + rect.width * fx;
        const y = rect.y + rect.height * fy;
        const hit = scene.hitTest(x, y);
        if (hit?.kind === "room" && hit.id === moduleId) return { x, y };
      }
    }
    return null;
  }, id);
}

/** How far the center of a drawn target is from the center of the map area, in CSS pixels; null when it is not drawn. */
export async function offsetFromMapCenter(page: Page, target: { kind: string; id: string }): Promise<{ dx: number; dy: number } | null> {
  return page.evaluate((t) => {
    const scene = (window as HookWindow).__hauntmap?.scene();
    const rect = scene?.screenRectOf(t as never);
    const box = document.querySelector(".map-wrapper")?.getBoundingClientRect();
    if (!rect || !box) return null;
    return { dx: rect.x + rect.width / 2 - (box.left + box.width / 2), dy: rect.y + rect.height / 2 - (box.top + box.height / 2) };
  }, target);
}

/** The wing of a module ID, as the interface names it. */
export function wingOfId(id: string): string {
  const slash = id.lastIndexOf("/");
  return slash < 0 ? "(root)" : id.slice(0, slash);
}

/** Under static-value: import and re-export syntax with value or mixed dependency. This is the spec's own oracle, read from expected.json. */
export function inStaticValue(r: { syntaxKind: string; dependencyKind: string }): boolean {
  return (r.syntaxKind === "import" || r.syntaxKind === "re-export") && (r.dependencyKind === "value" || r.dependencyKind === "mixed");
}

/** One key per relation: the same identity the interface uses, built from expected.json fields. */
export function relationKeyOf(r: { from: string; to: string | null; specifier: string; resolution: string; syntaxKind: string; dependencyKind: string }): string {
  return JSON.stringify([r.from, r.resolution === "local" ? ["local", r.to] : [r.resolution, r.specifier], r.syntaxKind, r.dependencyKind]);
}