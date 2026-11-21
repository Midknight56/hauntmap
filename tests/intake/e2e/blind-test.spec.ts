import { expect, test } from "@playwright/test";
import { settled, snapshot } from "../../e2e/helpers";
import { chooseFolder, materializeFolder, openLocalDialog, waitForOpenMap } from "./helpers";

// The faults of the local route that a first-time tester found on 20 November 2026 (docs/acceptance/blind-test-fixes-2026-11-20.md).

test.describe("local folder, first-time reader", () => {
  test("the first screen of the dialog says that a whole folder is chosen and that its files stay in the browser", async ({ page }) => {
    const dialog = await openLocalDialog(page);
    await expect(dialog.getByText("Choose the folder of the whole project. Its files are read in this browser and are not uploaded.", { exact: true })).toBeVisible();
  });

  test("a small project opens with every folder open, so that its files show as rooms at once", async ({ page }) => {
    const folder = materializeFolder("folder", "sample-local");
    try {
      const dialog = await openLocalDialog(page);
      await chooseFolder(page, folder.dir);
      await dialog.getByRole("button", { name: "Analyze" }).click();
      await waitForOpenMap(page);
      await settled(page);
      const layout = (await snapshot(page)).layout;
      expect(layout?.wings.length ?? 0).toBeGreaterThan(0);
      expect(layout?.wings.filter((w) => !w.expanded).map((w) => w.wing), "closed wings").toEqual([]);
      expect(layout?.rooms.length ?? 0, "every module is a room").toBe(3);
    } finally {
      folder.dispose();
    }
  });
});
