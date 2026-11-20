import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { assertFocusVisibleAndUnobscured, focusedName, openManor, readStatus, tabTo } from "../../e2e/helpers";
import { listingBody, listingOf } from "../generators";
import { openGithubDialog, openGithubDialogOver, routeJsdelivr, sixFields, waitForOpenMap, type JsdelivrAnswer } from "./helpers";

// The GitHub route in a real browser (headless Chromium, the development build). jsDelivr is routed through `page.route`:
// no request reaches the network. The URL forms below are written out on purpose, so that these cases also check
// the forms the source builds against the ones observed on 2026-11-19 (docs/limitations.md, ## Intake).

const GH = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "gh");
const SMALL_LISTING = JSON.parse(readFileSync(join(GH, "listing-small.json"), "utf8")) as unknown;
const body = (path: string): string => readFileSync(join(GH, "files", path), "utf8");

const REPO = "https://github.com/octo/cat";
const LISTING = "https://data.jsdelivr.com/v1/packages/gh/octo/cat@main?structure=flat";
const RESOLVE = "https://data.jsdelivr.com/v1/packages/gh/octo/cat/resolved";
const FILE = (path: string): string => `https://cdn.jsdelivr.net/gh/octo/cat@main/${path}`;
const LOADED = "Loaded octo/cat@main: 3 files, 3 modules, 1 relation, 1 diagnostic.";

function smallAnswers(url: string): JsdelivrAnswer | undefined {
  if (url === LISTING) return { body: SMALL_LISTING };
  for (const path of ["src/a.ts", "src/b.ts", "src/c.tsx"]) if (url === FILE(path)) return { body: body(path) };
  return undefined;
}

function bigAnswers(n: number, delayMs = 0): (url: string) => JsdelivrAnswer | undefined {
  const files = listingOf(n).map((entry) => ({ name: entry.path, hash: "h", size: entry.size }));
  return (url) => {
    if (url === LISTING) return { body: { type: "gh", name: "octo/cat", version: "main", default: null, files } };
    const match = /^https:\/\/cdn\.jsdelivr\.net\/gh\/octo\/cat@main\/(.+)$/.exec(url);
    return match === null ? undefined : { body: listingBody(match[1] ?? ""), delayMs };
  };
}

async function load(page: Page, url: string): Promise<void> {
  await page.getByLabel("Repository URL").fill(url);
  await page.getByRole("dialog").getByRole("button", { name: "Load" }).click();
}

test.describe("first screen", () => {
  test("7.1 the privacy note is above Load from the first render, and nothing is requested before Load", async ({ page }) => {
    const { requests } = await routeJsdelivr(page, () => undefined);
    const dialog = await openGithubDialog(page);
    const note = dialog.getByText("The repository name and file paths are sent to the jsDelivr CDN to fetch the files. Local folder analysis sends nothing.", { exact: true });
    await expect(note).toBeVisible();
    const noteBox = await note.boundingBox();
    const loadBox = await dialog.getByRole("button", { name: "Load" }).boundingBox();
    expect((noteBox?.y ?? 1e9) + (noteBox?.height ?? 0)).toBeLessThanOrEqual(loadBox?.y ?? 0);
    await expect(dialog.getByRole("heading", { name: "Load a GitHub repository" })).toBeVisible();
    await expect(dialog.getByLabel("Branch or tag")).toHaveCount(0);
    await expect(page.getByLabel("Repository URL")).toBeFocused();
    await page.waitForTimeout(300);
    expect(requests).toEqual([]);
  });

  test("7.2 an address with a subfolder and one that is not an address are refused with no request", async ({ page }) => {
    const { requests } = await routeJsdelivr(page, () => undefined);
    const dialog = await openGithubDialog(page);
    await load(page, `${REPO}/blob/main/src/a.ts`);
    await expect(dialog.getByText("Subfolders are not supported yet. Paste the address of the repository itself.", { exact: true })).toBeVisible();
    expect(await readStatus(page)).toBe("Subfolders are not supported yet. Paste the address of the repository itself.");
    await expect(page.getByLabel("Repository URL")).toBeFocused();
    await load(page, "octo/cat");
    await expect(dialog.getByText("Enter an address like https://github.com/owner/repo or https://github.com/owner/repo/tree/branch.", { exact: true })).toBeVisible();
    await load(page, `${REPO}/tree/feature/x`);
    await expect(dialog.getByLabel("Branch or tag")).toBeFocused();
    expect(requests).toEqual([]);
  });
});

test.describe("caps and failures", () => {
  test("7.5 401 listed files: the cap message with src/m99.ts and no file request", async ({ page }) => {
    const { requests } = await routeJsdelivr(page, bigAnswers(401));
    const dialog = await openGithubDialog(page);
    await load(page, `${REPO}/tree/main`);
    const message = "octo/cat@main has 401 included files; the limit is 400. First excluded: src/m99.ts. The previous investigation is unchanged.";
    await expect.poll(() => readStatus(page)).toBe(message);
    expect(requests.map((request) => request.url)).toEqual([LISTING]);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Load" })).toBeFocused();
  });

  for (const status of [404, 403]) {
    test(`7.6 a listing that answers ${status} shows its status and sends no file request`, async ({ page }) => {
      const { requests } = await routeJsdelivr(page, (url) => (url === LISTING ? { status, body: { status, message: "no" } } : undefined));
      await openGithubDialog(page);
      await load(page, `${REPO}/tree/main`);
      await expect.poll(() => readStatus(page)).toBe(`Could not list octo/cat@main: ${status}. Only public repositories are supported. The previous investigation is unchanged.`);
      expect(requests.map((request) => request.url)).toEqual([LISTING]);
    });
  }
});

test.describe("progress and cancel", () => {
  test("8.2 the progress text counts up on 200 routed files, then the analysis counts", async ({ page }) => {
    test.setTimeout(60_000);
    await routeJsdelivr(page, bigAnswers(200, 12));
    await openGithubDialog(page);
    await page.evaluate(() => {
      const w = window as unknown as { __progress?: string[] };
      w.__progress = [];
      new MutationObserver(() => {
        const text = document.querySelector('[role="dialog"] .intake-progress')?.textContent ?? "";
        const log = w.__progress as string[];
        if (text !== "" && log[log.length - 1] !== text) log.push(text);
      }).observe(document.body, { childList: true, subtree: true, characterData: true });
    });
    await load(page, `${REPO}/tree/main`);
    await waitForOpenMap(page);
    const seen = await page.evaluate(() => (window as unknown as { __progress: string[] }).__progress);
    const fetched = seen.map((text) => /^Fetched (\d+) of 200 files$/.exec(text)).filter((m): m is RegExpExecArray => m !== null).map((m) => Number(m[1]));
    expect(fetched[0]).toBe(0);
    expect(fetched.some((n) => n > 0 && n < 200)).toBe(true);
    expect(fetched).toEqual([...fetched].sort((a, b) => a - b));
    expect(seen.some((text) => /^Analyzing \d+ of 200 files$/.test(text))).toBe(true);
    expect(await readStatus(page)).toMatch(/^Loaded octo\/cat@main: 200 files, 200 modules, \d+ relations?, \d+ diagnostics?\.$/);
  });

  test("8.3 a cancel near 50 of 200 files sends no file request afterwards and leaves the six fields as they were", async ({ page }) => {
    test.setTimeout(60_000);
    const { requests } = await routeJsdelivr(page, bigAnswers(200, 40));
    await openManor(page);
    const label = await page.evaluate(() => (window as unknown as { __hauntmap: { store: { getState(): { investigation: { sourceLabel: string } } } } }).__hauntmap.store.getState().investigation.sourceLabel);
    const before = await sixFields(page);
    const dialog = await openGithubDialogOver(page);
    await load(page, `${REPO}/tree/main`);
    await page.waitForFunction(() => {
      const match = /^Fetched (\d+) of 200 files$/.exec(document.querySelector('[role="dialog"] .intake-progress')?.textContent ?? "");
      return match !== null && Number(match[1]) >= 50;
    });
    await expect(dialog).toHaveAttribute("aria-busy", "true");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog.getByRole("button", { name: "Load" })).toBeFocused();
    await expect(dialog).not.toHaveAttribute("aria-busy", "true");
    expect(await readStatus(page)).toBe(`Loading cancelled. ${label} is still open.`);
    const sent = requests.length;
    expect(sent).toBeLessThan(201);
    await page.waitForTimeout(500);
    expect(requests.length).toBe(sent);
    expect(await sixFields(page)).toBe(before);
  });
});

test.describe("the result", () => {
  test("8.7 listing-small opens the map with the loaded message and gh:octo/cat@main in the breadcrumb", async ({ page }) => {
    await routeJsdelivr(page, smallAnswers);
    await openGithubDialog(page);
    await load(page, `${REPO}/tree/main`);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await waitForOpenMap(page);
    expect(await readStatus(page)).toBe(LOADED);
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("gh:octo/cat@main");
    await expect(page.getByRole("application", { name: "Haunted map" })).toBeFocused();
  });

  test("with no ref the version is asked first and its tag is used for the listing and the files", async ({ page }) => {
    const { requests } = await routeJsdelivr(page, (url) => {
      if (url === RESOLVE) return { body: { type: "gh", name: "octo/cat", version: "v1.0.0", links: {} } };
      return smallAnswers(url.replace("@v1.0.0", "@main"));
    });
    await openGithubDialog(page);
    await load(page, REPO);
    await waitForOpenMap(page);
    expect(requests.map((request) => request.url)).toEqual([
      RESOLVE,
      "https://data.jsdelivr.com/v1/packages/gh/octo/cat@v1.0.0?structure=flat",
      "https://cdn.jsdelivr.net/gh/octo/cat@v1.0.0/src/a.ts",
      "https://cdn.jsdelivr.net/gh/octo/cat@v1.0.0/src/b.ts",
      "https://cdn.jsdelivr.net/gh/octo/cat@v1.0.0/src/c.tsx",
    ]);
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("gh:octo/cat@v1.0.0");
  });

  test("8.8 every request is a GET to the three URL forms, with no cookie, no authorization and no custom header", async ({ page }) => {
    const { requests } = await routeJsdelivr(page, smallAnswers);
    await page.context().addCookies([{ name: "session", value: "secret", url: "https://cdn.jsdelivr.net/" }]);
    await openGithubDialog(page);
    await load(page, `${REPO}/tree/main`);
    await waitForOpenMap(page);
    expect(requests.map((request) => request.url).sort()).toEqual([LISTING, FILE("src/a.ts"), FILE("src/b.ts"), FILE("src/c.tsx")].sort());
    for (const request of requests) {
      expect(request.method).toBe("GET");
      expect(Object.keys(request.headers).filter((name) => name === "cookie" || name === "authorization" || name.startsWith("x-"))).toEqual([]);
      expect(new URL(request.url).search).toBe(request.url === LISTING ? "?structure=flat" : "");
    }
  });
});

test.describe("keyboard and viewports", () => {
  test("landing, dialog, load and close with the keyboard only, with a visible and unobscured focus after every Tab", async ({ page }) => {
    await routeJsdelivr(page, smallAnswers);
    await page.goto("/");
    await page.getByRole("button", { name: "Explore the manor" }).waitFor();
    await tabTo(page, "Load a GitHub repository");
    await assertFocusVisibleAndUnobscured(page);
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(page.getByLabel("Repository URL")).toBeFocused();
    await assertFocusVisibleAndUnobscured(page);
    await page.keyboard.type(`${REPO}/tree/main`);
    for (const name of ["Load", "Close"]) {
      await page.keyboard.press("Tab");
      expect(await focusedName(page)).toBe(name);
      await assertFocusVisibleAndUnobscured(page);
    }
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Repository URL")).toBeFocused();
    await assertFocusVisibleAndUnobscured(page);
    await page.keyboard.press("Tab");
    expect(await focusedName(page)).toBe("Load");
    await page.keyboard.press("Enter");
    await expect(dialog).toHaveCount(0);
    await waitForOpenMap(page);
    expect(await readStatus(page)).toBe(LOADED);
    await expect(page.getByRole("application", { name: "Haunted map" })).toBeFocused();
  });

  test("Cancel is reachable and is the only control while the files are fetched", async ({ page }) => {
    await routeJsdelivr(page, bigAnswers(30, 400));
    const dialog = await openGithubDialog(page);
    await page.getByLabel("Repository URL").focus();
    await page.keyboard.type(`${REPO}/tree/main`);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect(dialog).toHaveAttribute("aria-busy", "true");
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await assertFocusVisibleAndUnobscured(page);
    await page.keyboard.press("Tab");
    expect(await focusedName(page)).toBe("Cancel");
    await page.keyboard.press("Enter");
    await expect(dialog.getByRole("button", { name: "Load" })).toBeFocused();
    await assertFocusVisibleAndUnobscured(page);
  });

  for (const [width, height] of [
    [1024, 640],
    [1280, 720],
    [640, 360],
    [360, 640],
  ] as const) {
    test(`${width} x ${height}: the dialog fits the width and the page does not scroll sideways`, async ({ page }) => {
      await routeJsdelivr(page, () => undefined);
      await page.setViewportSize({ width, height });
      const dialog = await openGithubDialog(page);
      await page.getByLabel("Repository URL").fill(`${REPO}/tree/feature/x`);
      await dialog.getByRole("button", { name: "Load" }).click();
      await expect(dialog.getByLabel("Branch or tag")).toBeVisible();
      const sizes = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      expect(sizes.scroll).toBeLessThanOrEqual(sizes.client);
      const box = await dialog.boundingBox();
      expect((box?.x ?? -1) >= 0 && (box?.x ?? 0) + (box?.width ?? 0) <= width).toBe(true);
      await dialog.getByRole("button", { name: "Close" }).scrollIntoViewIfNeeded();
      await expect(dialog.getByRole("button", { name: "Close" })).toBeVisible();
    });
  }
});
