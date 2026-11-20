import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { assertFocusVisibleAndUnobscured, focusedName, openManor, readStatus, shot, tabTo } from "../../e2e/helpers";
import { chooseFolder, listItems, materializeFolder, materializeGenerated, openLocalDialog, openLocalDialogOver, recordRequests, recordStatus, sixFields, statusLog, waitForOpenMap } from "./helpers";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

// The local route in a real browser (headless Chromium, the development build). Task 6 holds 2.1, 2.6, 3.5 and 1.5;
// the other cases of the design table come with task 8.

const SUMMARY = "Analyzed sample-local: 3 modules, 1 relation, 1 diagnostic; 6 files skipped before reading, 1 binary file skipped.";

test.describe("local folder, first journey", () => {
  test("2.1 the dialog opens from the landing button, takes focus, and returns it on Escape", async ({ page }) => {
    await page.goto("/");
    const opener = page.getByRole("button", { name: "Analyze a local folder" });
    await opener.focus();
    await opener.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(dialog.getByRole("heading", { name: "Analyze a local folder" })).toBeVisible();
    await expect(page.getByLabel("Choose a folder")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  test("2.6 the review of the fixture folder before any file is read", async ({ page }) => {
    const folder = materializeFolder("folder", "sample-local");
    try {
      const dialog = await openLocalDialog(page);
      await chooseFolder(page, folder.dir);
      await expect(dialog.getByText("Folder: sample-local", { exact: true })).toBeVisible();
      await expect(dialog.getByText("Included: 4 files, 1 KB", { exact: true })).toBeVisible();
      await expect(dialog.getByText("Skipped: 6", { exact: true })).toBeVisible();
      await expect(dialog.getByText("2 in excluded directories (.git, node_modules, dist, build, out, .next, coverage)", { exact: true })).toBeVisible();
      await expect(dialog.getByText("2 secret or environment files", { exact: true })).toBeVisible();
      await expect(dialog.getByText("1 other file types", { exact: true })).toBeVisible();
      await expect(dialog.getByText("1 over 1 MiB", { exact: true })).toBeVisible();
      expect(await listItems(page, "Included files (4)")).toEqual(["bin.ts", "src/a.ts", "src/b.ts", "src/c.tsx"]);
      expect(await listItems(page, "Skipped files (6)")).toEqual([
        ".env \u00b7 secret or environment file",
        "README.md \u00b7 other file type",
        "big.ts \u00b7 over 1 MiB",
        "dist/ \u00b7 excluded directory",
        "node_modules/ \u00b7 excluded directory",
        "secret.pem \u00b7 secret or environment file",
      ]);
      await expect(dialog.getByText("Included files are read in this browser and kept in memory.")).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Analyze" })).toBeFocused();
      await expect(dialog.getByRole("button", { name: "Analyze" })).not.toHaveAttribute("aria-disabled", "true");
    } finally {
      folder.dispose();
    }
  });

  test("3.5 and 1.5 the summary, the map open with local:sample-local, one status message at the start and one at the end", async ({ page }) => {
    const folder = materializeFolder("folder", "sample-local");
    try {
      const dialog = await openLocalDialog(page);
      await chooseFolder(page, folder.dir);
      await recordStatus(page);
      await dialog.getByRole("button", { name: "Analyze" }).click();
      await expect(dialog.getByText(SUMMARY, { exact: true })).toBeVisible();
      await waitForOpenMap(page);
      expect(await statusLog(page)).toEqual(["Reading 4 files from sample-local.", SUMMARY]);
      await expect(page.locator('[role="status"]')).toHaveText(SUMMARY);
      await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("local:sample-local");
      await expect(dialog).toHaveAttribute("aria-modal", "true");
      await dialog.getByRole("button", { name: "Close" }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole("application", { name: "Haunted map" })).toBeFocused();
    } finally {
      folder.dispose();
    }
  });
});

// ---- Task 8: the remaining cases of the design table ----

const LIVE_PATH = join(REPO, "public", "demo", "live.json");
const FIXTURE_FILE = join(REPO, "tests", "intake", "fixtures", "graph");
const SHOTS = process.env["HAUNTMAP_SHOTS"] === "1";

test.describe("cancel (3.2, 3.3)", () => {
  test("a cancel near 100 of 400 files leaves the six fields as they were and returns to the review", async ({ page }) => {
    test.setTimeout(90_000);
    const folder = materializeGenerated(400, "sample-gen");
    try {
      await openManor(page);
      await page.evaluate(() => (window as unknown as { __hauntmap: { intake: { setReadDelay(ms: number): void } } }).__hauntmap.intake.setReadDelay(20));
      const label = await page.evaluate(() => (window as unknown as { __hauntmap: { store: { getState(): { investigation: { sourceLabel: string } } } } }).__hauntmap.store.getState().investigation.sourceLabel);
      const before = await sixFields(page);
      const dialog = await openLocalDialogOver(page);
      await chooseFolder(page, folder.dir);
      await expect(dialog.getByText("Included: 400 files", { exact: false })).toBeVisible();
      await dialog.getByRole("button", { name: "Analyze" }).click();
      await expect(dialog).toHaveAttribute("aria-busy", "true");
      await page.waitForFunction(() => {
        const match = /^Reading (\d+) of 400 files$/.exec(document.querySelector('[role="dialog"] .intake-progress')?.textContent ?? "");
        return match !== null && Number(match[1]) >= 100;
      });
      await expect(dialog.getByRole("button", { name: "Cancel" })).toBeEnabled();
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog.getByRole("button", { name: "Analyze" })).toBeFocused();
      await expect(dialog).not.toHaveAttribute("aria-busy", "true");
      expect(await readStatus(page)).toBe(`Analysis cancelled. ${label} is still open.`);
      expect(await sixFields(page)).toBe(before);
    } finally {
      folder.dispose();
    }
  });
});

test.describe("timing (3.7)", () => {
  test("200 files of 10,240 bytes: from Analyze until the map is open (printed, not asserted)", async ({ page }) => {
    test.setTimeout(90_000);
    const folder = materializeGenerated(200, "sample-timing", 10_240);
    try {
      const dialog = await openLocalDialog(page);
      await chooseFolder(page, folder.dir);
      await expect(dialog.getByText("Included: 200 files, 2.0 MiB", { exact: true })).toBeVisible();
      const started = Date.now();
      await dialog.getByRole("button", { name: "Analyze" }).click();
      await waitForOpenMap(page);
      const elapsed = Date.now() - started;
      console.log(`INTAKE-TIMING-3.7 ${elapsed} ms (200 files, 2.0 MiB)`);
      test.info().annotations.push({ type: "timing 3.7", description: `${elapsed} ms` });
    } finally {
      folder.dispose();
    }
  });
});

test.describe("privacy (4.1, 4.2)", () => {
  test("no request carries the folder, a path or the content, and every request is an ordinary page file", async ({ page }) => {
    const folder = materializeFolder("folder", "sample-local");
    try {
      await page.goto("/");
      await page.getByRole("button", { name: "Analyze a local folder" }).waitFor();
      const recorded = recordRequests(page);
      await page.getByRole("button", { name: "Analyze a local folder" }).click();
      const dialog = page.getByRole("dialog");
      await chooseFolder(page, folder.dir);
      await expect(dialog.getByText("Folder: sample-local", { exact: true })).toBeVisible();
      await shot(page, join(REPO, "docs", "acceptance", "img", "intake-local-review.png"));
      await dialog.getByRole("button", { name: "Analyze" }).click();
      await expect(dialog.getByText(SUMMARY, { exact: true })).toBeVisible();
      await waitForOpenMap(page);
      await dialog.getByRole("button", { name: "Close" }).click();
      await expect(dialog).toHaveCount(0);
      await page.waitForTimeout(500);
      await shot(page, join(REPO, "docs", "acceptance", "img", "intake-local-map.png"));

      const origin = new URL(page.url()).origin;
      expect(recorded.requests.length).toBeGreaterThan(0);
      for (const request of recorded.requests) {
        const url = new URL(request.url);
        if (url.protocol === "data:" || url.protocol === "blob:") continue;
        expect(url.origin, request.url).toBe(origin);
        expect(url.pathname, request.url).toMatch(/\.(js|css|ttf|png|svg|json)$/);
      }
      const secrets = ["sample-local", "src/a.ts", "src%2Fa.ts", "src/b.ts", "src/c.tsx", "bin.ts", "big.ts", "SENTINEL-LOCAL-4e2b17"];
      for (const request of recorded.requests) for (const secret of secrets) for (const part of [request.url, request.headers, request.body]) expect(part, `${request.url} carries ${secret}`).not.toContain(secret);
      if (SHOTS) {
        mkdirSync(join(REPO, "docs", "acceptance", "intake"), { recursive: true });
        const list = recorded.requests.map((request) => ({ method: request.method, url: request.url }));
        writeFileSync(join(REPO, "docs", "acceptance", "intake", "local-requests.json"), `${JSON.stringify(list, null, 2)}\n`, "utf8");
      }
    } finally {
      folder.dispose();
    }
  });
});

test.describe("saving on this device (5.2, 5.3)", () => {
  test("save with source text, reload the page, open the record, then forget it", async ({ page }) => {
    const folder = materializeFolder("folder", "sample-local");
    try {
      const dialog = await openLocalDialog(page);
      await chooseFolder(page, folder.dir);
      await dialog.getByRole("button", { name: "Analyze" }).click();
      await expect(dialog.getByText(SUMMARY, { exact: true })).toBeVisible();
      await expect(dialog.getByRole("checkbox", { name: "Include source text" })).not.toBeChecked();
      await dialog.getByRole("checkbox", { name: "Include source text" }).check();
      await dialog.getByRole("button", { name: "Save investigation on this device" }).click();
      await expect.poll(() => readStatus(page)).toMatch(/^Saved local:sample-local on this device \(\d+ KB, source text included\)\.$/);

      await page.reload();
      await page.getByRole("button", { name: "Analyze a local folder" }).click();
      const again = page.getByRole("dialog");
      await expect(again.getByRole("heading", { name: "Saved on this device (1)" })).toBeVisible();
      await expect(again.getByRole("list", { name: "Saved on this device (1)" }).getByRole("listitem")).toContainText([/^local:sample-local \u00b7 3 modules \u00b7 saved \d{4}-\d{2}-\d{2} \u00b7 source text included/]);
      await again.getByRole("button", { name: "Open local:sample-local" }).click();
      await waitForOpenMap(page);
      await expect(again).toHaveCount(0);
      expect(await readStatus(page)).toBe("Opened local:sample-local from this device.");
      await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("local:sample-local");

      await openLocalDialogOver(page);
      await page.getByRole("button", { name: "Forget local:sample-local" }).click();
      await expect.poll(() => readStatus(page)).toBe("Forgot local:sample-local.");
      await expect(page.getByRole("heading", { name: /^Saved on this device/ })).toHaveCount(0);
      await page.reload();
      await page.getByRole("button", { name: "Analyze a local folder" }).click();
      await expect(page.getByRole("heading", { name: /^Saved on this device/ })).toHaveCount(0);
    } finally {
      folder.dispose();
    }
  });
});

test.describe("graph files (6.4)", () => {
  test("the live snapshot opens; the malformed and the not JSON files are refused with their messages", async ({ page }) => {
    const live = JSON.parse(readFileSync(LIVE_PATH, "utf8")) as { modules: unknown[]; imports: { relationId: string }[] };
    const relations = new Set(live.imports.map((record) => record.relationId)).size;
    const dialog = await openLocalDialog(page);
    await page.getByLabel("Choose a graph file").setInputFiles(join(FIXTURE_FILE, "malformed.json"));
    await expect.poll(() => readStatus(page)).toBe("The graph file is not valid: schemaVersion must be 1 (found 2).");
    await expect(dialog).toBeVisible();
    await page.getByLabel("Choose a graph file").setInputFiles(join(FIXTURE_FILE, "not-json.txt"));
    await expect.poll(() => readStatus(page)).toMatch(/^The graph file is not JSON \(/);
    await expect(dialog).toBeVisible();
    await page.getByLabel("Choose a graph file").setInputFiles(LIVE_PATH);
    await waitForOpenMap(page);
    await expect(dialog).toHaveCount(0);
    expect(await readStatus(page)).toBe(`Imported live:haunts/manor: ${live.modules.length} modules, ${relations} relations. A graph file holds no source text.`);
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("live:haunts/manor");
  });
});

test.describe("keyboard only (10.3)", () => {
  test("landing, dialog, review, analysis, result and close, with a visible and unobscured focus after every Tab", async ({ page }) => {
    const folder = materializeFolder("folder", "sample-local");
    try {
      await page.goto("/");
      await page.getByRole("button", { name: "Explore the manor" }).waitFor();
      await tabTo(page, "Analyze a local folder");
      await assertFocusVisibleAndUnobscured(page);
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog");
      await expect(page.getByLabel("Choose a folder")).toBeFocused();
      // The operating system's file picker cannot be driven by keys; the files are handed to the focused input.
      await chooseFolder(page, folder.dir);
      await expect(dialog.getByRole("button", { name: "Analyze" })).toBeFocused();
      await assertFocusVisibleAndUnobscured(page);
      for (const name of ["Back", "Close", "Included files (4)", "Skipped files (6)", "Analyze"]) {
        await page.keyboard.press("Tab");
        expect(await focusedName(page)).toBe(name);
        await assertFocusVisibleAndUnobscured(page);
      }
      await page.keyboard.press("Enter");
      await expect(dialog.getByText(SUMMARY, { exact: true })).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Save investigation on this device" })).toBeFocused();
      await assertFocusVisibleAndUnobscured(page);
      for (const name of ["Include source text", "Close"]) {
        await page.keyboard.press("Tab");
        expect(await focusedName(page)).toBe(name);
        await assertFocusVisibleAndUnobscured(page);
      }
      await page.keyboard.press("Enter");
      await expect(dialog).toHaveCount(0);
      await waitForOpenMap(page);
      await expect(page.getByRole("application", { name: "Haunted map" })).toBeFocused();
    } finally {
      folder.dispose();
    }
  });
});

test.describe("viewports (10.5)", () => {
  for (const [width, height] of [
    [1024, 640],
    [1280, 720],
    [640, 360],
    [360, 640],
  ] as const) {
    test(`${width} x ${height}: both screens fit the width and the page does not scroll sideways`, async ({ page }) => {
      const folder = materializeFolder("folder", "sample-local");
      try {
        await page.setViewportSize({ width, height });
        const dialog = await openLocalDialog(page);
        const fits = async (): Promise<void> => {
          const sizes = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
          expect(sizes.scroll).toBeLessThanOrEqual(sizes.client);
          const box = await dialog.boundingBox();
          expect(box).not.toBeNull();
          expect((box?.x ?? -1) >= 0 && (box?.x ?? 0) + (box?.width ?? 0) <= width).toBe(true);
        };
        await fits();
        await chooseFolder(page, folder.dir);
        await expect(dialog.getByText("Folder: sample-local", { exact: true })).toBeVisible();
        await fits();
        await dialog.getByRole("button", { name: "Close" }).scrollIntoViewIfNeeded();
        await expect(dialog.getByRole("button", { name: "Close" })).toBeVisible();
      } finally {
        folder.dispose();
      }
    });
  }
});