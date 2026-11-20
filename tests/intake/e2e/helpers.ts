import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
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
