import { expect, test } from "@playwright/test";
import { chooseFolder, listItems, materializeFolder, openLocalDialog, recordStatus, statusLog, waitForOpenMap } from "./helpers";

// The local route in a real browser (headless Chromium, the development build). Task 6 holds 2.1, 2.6, 3.5 and 1.5;
// the other cases of the design table come with task 8.

const SUMMARY = "Analyzed sample-local: 3 modules, 1 relation, 1 diagnostic; 6 files skipped before reading, 1 binary file skipped, 0 files failed to parse.";

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
