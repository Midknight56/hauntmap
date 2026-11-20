import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
import { folderOf } from "../generators";
import { readManifest, writeManifest } from "../materialize";

// Helpers for the intake browser specs. They talk to the page through `window.__hauntmap` (development build only) and
// through the dialog's own controls. Nothing is imported from the source folders.

/** A fixture manifest written to a temporary folder with the given folder name; `dispose()` removes it. */
export function materializeFolder(name: "folder" | "folder-exec", folderName?: string): { dir: string; dispose(): void } {
  const parent = mkdtempSync(join(tmpdir(), "hauntmap-intake-"));
  const dir = writeManifest(readManifest(name), parent, folderName);
  return { dir, dispose: () => rmSync(parent, { recursive: true, force: true }) };
}

/** Open the landing page and activate `Analyze a local folder`; resolves when the dialog is in the page. */
export async function openLocalDialog(page: Page): Promise<Locator> {
  await page.goto("/");
  await page.getByRole("button", { name: "Analyze a local folder" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Choose a folder in the dialog's folder input: Playwright's `setInputFiles` with a directory path on a `webkitdirectory` input. */
export async function chooseFolder(page: Page, dir: string): Promise<void> {
  await page.getByLabel("Choose a folder").setInputFiles(dir);
}

/** Records every non empty text of the one status region from now on. Read the list with `statusLog`. */
export async function recordStatus(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __statusLog?: string[] };
    w.__statusLog = [];
    const region = document.querySelector('[role="status"]');
    if (region === null) throw new Error("There is no status region");
    const note = (): void => {
      const text = region.textContent ?? "";
      const log = w.__statusLog as string[];
      if (text !== "" && log[log.length - 1] !== text) log.push(text);
    };
    new MutationObserver(note).observe(region, { childList: true, characterData: true, subtree: true });
  });
}

export async function statusLog(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __statusLog?: string[] }).__statusLog ?? []);
}

/** Wait until the store holds an investigation and the layout has settled. */
export async function waitForOpenMap(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const state = (window as unknown as { __hauntmap?: { store: { getState(): { investigation: unknown; layoutStatus: string; layout: unknown } } } }).__hauntmap?.store.getState();
    return state !== undefined && state.investigation !== null && state.layoutStatus === "idle" && state.layout !== null;
  });
}

/** The text of each list item of the named list in the dialog. */
export async function listItems(page: Page, name: string): Promise<string[]> {
  return page.getByRole("list", { name }).getByRole("listitem").allTextContents();
}

/** A generated folder (`folderOf`) written to a temporary folder; `dispose()` removes it. */
export function materializeGenerated(n: number, folderName: string, bytesEach?: number): { dir: string; dispose(): void } {
  const parent = mkdtempSync(join(tmpdir(), "hauntmap-intake-"));
  const dir = writeManifest(folderOf(n, { folder: folderName, ...(bytesEach === undefined ? {} : { bytesEach }) }), parent, folderName);
  return { dir, dispose: () => rmSync(parent, { recursive: true, force: true }) };
}

/** Open the local dialog through the development hook, for a page whose investigation is already open (the landing buttons exist only on the landing screen). */
export async function openLocalDialogOver(page: Page): Promise<Locator> {
  await page.evaluate(() => {
    const hook = (window as unknown as { __hauntmap?: { intake?: { service: { open(args: { purpose: string; kind: string }): Promise<unknown> } } } }).__hauntmap;
    if (hook?.intake === undefined) throw new Error("window.__hauntmap.intake is missing: run this case in the dev project");
    void hook.intake.service.open({ purpose: "open", kind: "local" });
  });
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

/** The six store fields that a cancel or a failure must leave alone (3.3), as JSON text. */
export async function sixFields(page: Page): Promise<string> {
  return page.evaluate(() => {
    const state = (window as unknown as { __hauntmap: { store: { getState(): Record<string, unknown> } } }).__hauntmap.store.getState();
    const { investigation, selection, routeFilter, camera, expandedWings, layout } = state;
    return JSON.stringify({ investigation, selection, routeFilter, camera, expandedWings, layout });
  });
}

export interface RecordedRequest {
  method: string;
  url: string;
  headers: string;
  body: string;
}

/** Every request of the page and its workers from now on (method, URL, headers and post body, for the checks of 4.1). */
export function recordRequests(page: Page): { requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  page.on("request", (request) => {
    requests.push({ method: request.method(), url: request.url(), headers: JSON.stringify(request.headers()), body: request.postData() ?? "" });
  });
  return { requests };
}
/** Open the landing page and activate `Load a GitHub repository`; resolves when the dialog is in the page. */
export async function openGithubDialog(page: Page): Promise<Locator> {
  await page.goto("/");
  await page.getByRole("button", { name: "Load a GitHub repository" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Open the GitHub dialog through the development hook, for a page whose investigation is already open. */
export async function openGithubDialogOver(page: Page): Promise<Locator> {
  await page.evaluate(() => {
    const hook = (window as unknown as { __hauntmap?: { intake?: { service: { open(args: { purpose: string; kind: string }): Promise<unknown> } } } }).__hauntmap;
    if (hook?.intake === undefined) throw new Error("window.__hauntmap.intake is missing: run this case in the dev project");
    void hook.intake.service.open({ purpose: "open", kind: "github" });
  });
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

export interface JsdelivrAnswer {
  status?: number;
  /** A string as it is; any other value is sent as JSON. */
  body?: unknown;
  /** Answer after this many milliseconds. */
  delayMs?: number;
}

export interface JsdelivrRecord {
  method: string;
  url: string;
  headers: Record<string, string>;
}

/**
 * Answers every request to `data.jsdelivr.com` and `cdn.jsdelivr.net` from `answer`, with the CORS header the real service sends.
 * A URL the callback does not know gets 404, as jsDelivr gives for a missing file. No request reaches the network.
 */
export async function routeJsdelivr(page: Page, answer: (url: string) => JsdelivrAnswer | undefined): Promise<{ requests: JsdelivrRecord[] }> {
  const requests: JsdelivrRecord[] = [];
  await page.route(/^https:\/\/(data\.jsdelivr\.com|cdn\.jsdelivr\.net)\//, async (route) => {
    const request = route.request();
    requests.push({ method: request.method(), url: request.url(), headers: request.headers() });
    const found = answer(request.url()) ?? { status: 404, body: { status: 404, message: "Not found" } };
    if ((found.delayMs ?? 0) > 0) await new Promise((resolve) => setTimeout(resolve, found.delayMs));
    const body = found.body ?? "";
    const isText = typeof body === "string";
    await route.fulfill({
      status: found.status ?? 200,
      headers: { "access-control-allow-origin": "*", "content-type": isText ? "text/plain; charset=utf-8" : "application/json; charset=utf-8" },
      body: isText ? body : JSON.stringify(body),
    });
  });
  return { requests };
}