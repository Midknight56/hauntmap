import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { openComparePanel, waitForStatusStart } from "../compare/e2e/helpers";
import { listingBody, listingOf } from "../intake/generators";
import { chooseFolder, materializeFolder, materializeGenerated, openGithubDialog, openLocalDialog, routeJsdelivr, waitForOpenMap, type JsdelivrAnswer } from "../intake/e2e/helpers";
import { describeBlocking, scanPage, writeReport, type ScanResult } from "./axe";
import { openManor, readStatus } from "./helpers";

// The axe scan of every screen state of the journey (`.kiro/specs/accessibility-scan`, dev project, headless).
// One test walks all of them, so that one report holds every scan. A screen that cannot be reached is a problem of its own, never a skipped scan.
// axe finds only a part of the accessibility problems; this test does not show that a screen is accessible.

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const LIVE_FIXTURE = join(REPO, "tests", "kiro", "fixtures", "live", "valid-live.json");
const GH = join(REPO, "tests", "intake", "fixtures", "gh");

const REPORT = process.env["HAUNTMAP_AXE_REPORT"];

const scans: ScanResult[] = [];
const problems: string[] = [];

/** Reach a screen state with `reach`, then scan it under `name`. A failure to reach it is recorded as a problem. */
async function screen(page: Page, name: string, reach: () => Promise<void>): Promise<void> {
  try {
    await reach();
    const result = await scanPage(page, name);
    scans.push(result);
    problems.push(...describeBlocking(result));
  } catch (error) {
    problems.push(`${name}: the screen could not be reached or scanned: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  }
}

async function inFreshPage(context: BrowserContext, run: (page: Page) => Promise<void>, size?: { width: number; height: number }): Promise<void> {
  const page = await context.newPage();
  try {
    if (size !== undefined) await page.setViewportSize(size);
    await run(page);
  } finally {
    await page.close();
  }
}

const SMALL_LISTING = JSON.parse(readFileSync(join(GH, "listing-small.json"), "utf8")) as unknown;
const REPO_URL = "https://github.com/octo/cat";
const LISTING = "https://data.jsdelivr.com/v1/packages/gh/octo/cat@main?structure=flat";
const FILE = (path: string): string => `https://cdn.jsdelivr.net/gh/octo/cat@main/${path}`;

function smallAnswers(url: string): JsdelivrAnswer | undefined {
  if (url === LISTING) return { body: SMALL_LISTING };
  for (const path of ["src/a.ts", "src/b.ts", "src/c.tsx"]) if (url === FILE(path)) return { body: readFileSync(join(GH, "files", path), "utf8") };
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

async function loadRepository(page: Page, url: string): Promise<void> {
  await page.getByLabel("Repository URL").fill(url);
  await page.getByRole("dialog").getByRole("button", { name: "Load" }).click();
}

test.describe("axe scan of every screen state", () => {
  test("no screen state has a serious or critical violation", async ({ context }) => {
    test.setTimeout(420_000);

    // 2. The landing screen.
    await inFreshPage(context, async (page) => {
      await screen(page, "landing screen", async () => {
        await page.goto("/");
        await expect(page.getByRole("heading", { name: "HauntMap" })).toBeVisible();
        await page.getByRole("button", { name: "Load a GitHub repository" }).waitFor();
      });
    });
    await inFreshPage(context, async (page) => {
      await screen(page, "landing screen after a failed sample request", async () => {
        await page.route("**/demo/manor/before/sources.json", (route) => route.fulfill({ status: 500, body: "nope" }));
        await page.goto("/");
        await page.getByRole("button", { name: "Explore the manor" }).click();
        await expect(page.locator('[role="status"]')).toHaveText("The manor sample could not be loaded (500). Reload the page.");
      });
    });

    // 3 and 4. The manor map and its panels, on one page, in the order of the journey.
    await inFreshPage(context, async (page) => {
      const legend = page.getByRole("button", { name: "Legend" });
      await screen(page, "manor map with legend and steps open", async () => {
        await openManor(page);
        await expect(page.getByRole("application", { name: "Haunted map" })).toBeVisible();
        if ((await legend.getAttribute("aria-expanded")) !== "true") await legend.click();
        await expect(page.getByRole("region", { name: "Legend" })).toBeVisible();
      });
      await screen(page, "search results open", async () => {
        await page.getByRole("combobox", { name: "Search modules" }).fill("receipt");
        await expect(page.getByRole("listbox", { name: "Matching modules" })).toBeVisible();
      });
      await screen(page, "room selected from the search, with its inspector", async () => {
        await page.keyboard.press("ArrowDown");
        await page.keyboard.press("Enter");
        await expect(page.getByRole("complementary", { name: "Inspector" }).getByRole("heading", { level: 2 }).first()).toContainText("receipt");
      });
      await screen(page, "who imports panel", async () => {
        await page.getByRole("button", { name: "Who imports this?" }).click();
        await expect(page.getByRole("heading", { name: /^Who imports / })).toBeVisible();
      });
      await screen(page, "dependency loops panel", async () => {
        await page.getByRole("button", { name: "Dependency loops" }).click();
        await expect(page.getByRole("list", { name: "Loops" })).toBeVisible();
      });
      await screen(page, "loop selected, with the evidence trail and the inspector", async () => {
        await page.getByRole("list", { name: "Loops" }).getByRole("button").first().click();
        await expect(page.getByRole("region", { name: "Evidence trail" })).toBeVisible();
        await expect(page.getByRole("complementary", { name: "Inspector" })).toBeVisible();
      });
      await screen(page, "relation selected, with its occurrence and source lines", async () => {
        await page.getByRole("button", { name: /^line \d+, column \d+: / }).first().click();
        await expect(page.locator('[aria-label="Source lines"]')).toBeVisible();
      });
      await screen(page, "evidence view", async () => {
        await page.getByRole("tab", { name: "Evidence" }).click();
        await expect(page.getByRole("heading", { name: "Evidence (static-value)" })).toBeVisible();
      });
      await screen(page, "map with the legend closed", async () => {
        await page.getByRole("tab", { name: "Map" }).click();
        await expect(page.getByRole("application", { name: "Haunted map" })).toBeVisible();
        if ((await legend.getAttribute("aria-expanded")) === "true") await legend.click();
        await expect(legend).toHaveAttribute("aria-expanded", "false");
      });
      await screen(page, "steps panel closed", async () => {
        const steps = page.getByRole("region", { name: "Investigation steps" });
        if (await steps.isVisible()) await steps.getByRole("button", { name: "Close" }).click();
        await expect(steps).toHaveCount(0);
      });
      await screen(page, "show steps panel", async () => {
        await page.getByRole("button", { name: "Show steps" }).click();
        await expect(page.getByRole("region", { name: "Investigation steps" })).toBeVisible();
      });
      await screen(page, "motion set to reduce", async () => {
        const motion = page.getByRole("button", { name: "Motion" });
        await motion.click();
        await expect(motion).toHaveAttribute("aria-pressed", "true");
      });
      await screen(page, "compare revisions open", async () => {
        await openComparePanel(page);
        await expect(page.getByRole("button", { name: "Revised manor" })).toBeVisible();
      });
      await screen(page, "comparison after loading the revised manor", async () => {
        await page.getByRole("button", { name: "Revised manor" }).click();
        await waitForStatusStart(page, "Comparison ready");
      });
    });

    // 3.5 The phone layout, with the controls behind More.
    await inFreshPage(
      context,
      async (page) => {
        await screen(page, "manor map at 640 x 360 with More open", async () => {
          await openManor(page);
          const more = page.getByRole("button", { name: "More" });
          await more.click();
          await expect(more).toHaveAttribute("aria-expanded", "true");
        });
      },
      { width: 640, height: 360 },
    );

    // 3.6 The renderer failure banner.
    await inFreshPage(context, async (page) => {
      await screen(page, "renderer failure banner over the Evidence view", async () => {
        await page.goto("/");
        await page.waitForFunction(() => (window as unknown as { __hauntmap?: unknown }).__hauntmap !== undefined);
        await page.evaluate(() => (window as unknown as { __hauntmap: { forceRendererFailure(on: boolean): void } }).__hauntmap.forceRendererFailure(true));
        await page.getByRole("button", { name: "Explore the manor" }).click();
        await page.getByRole("button", { name: "Retry map" }).waitFor();
      });
    });

    // 5.3 The live snapshot, loaded and missing.
    await inFreshPage(context, async (page) => {
      await screen(page, "result of Open live snapshot", async () => {
        await page.route("**/demo/live.json*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: readFileSync(LIVE_FIXTURE, "utf8") }));
        await openManor(page);
        await page.getByRole("button", { name: "Open live snapshot" }).click();
        await waitForStatusStart(page, "Live snapshot loaded");
      });
    });
    await inFreshPage(context, async (page) => {
      await screen(page, "Open live snapshot with no snapshot written", async () => {
        await page.route("**/demo/live.json*", (route) => route.fulfill({ status: 404, body: "not found" }));
        await openManor(page);
        await page.getByRole("button", { name: "Open live snapshot" }).click();
        await waitForStatusStart(page, "No live snapshot yet");
      });
    });

    // 6. The local folder dialog.
    const folder = materializeFolder("folder", "sample-local");
    try {
      await inFreshPage(context, async (page) => {
        let dialog = page.getByRole("dialog");
        await screen(page, "local folder dialog as opened", async () => {
          dialog = await openLocalDialog(page);
        });
        await screen(page, "local folder dialog after a folder is chosen", async () => {
          await chooseFolder(page, folder.dir);
          await expect(dialog.getByText("Folder: sample-local", { exact: true })).toBeVisible();
        });
        await screen(page, "local folder dialog after the analysis", async () => {
          await dialog.getByRole("button", { name: "Analyze" }).click();
          await expect(dialog.getByRole("button", { name: "Save investigation on this device" })).toBeVisible();
          await waitForOpenMap(page);
        });
        await screen(page, "local folder dialog with a saved investigation listed", async () => {
          await dialog.getByRole("button", { name: "Save investigation on this device" }).click();
          await expect.poll(() => readStatus(page)).toMatch(/^Saved local:sample-local on this device/);
          await page.reload();
          await page.getByRole("button", { name: "Analyze a local folder" }).click();
          await expect(page.getByRole("list", { name: "Saved on this device (1)" })).toBeVisible();
        });
        await screen(page, "local folder dialog with a graph file refused", async () => {
          await page.getByLabel("Choose a graph file").setInputFiles(join(REPO, "tests", "intake", "fixtures", "graph", "malformed.json"));
          await expect.poll(() => readStatus(page)).toBe("The graph file is not valid: schemaVersion must be 1 (found 2).");
        });
      });
      await inFreshPage(context, async (page) => {
        await screen(page, "map of an analyzed local folder", async () => {
          const dialog = await openLocalDialog(page);
          await chooseFolder(page, folder.dir);
          await dialog.getByRole("button", { name: "Analyze" }).click();
          await waitForOpenMap(page);
          await dialog.getByRole("button", { name: "Close" }).click();
          await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("local:sample-local");
        });
      });
    } finally {
      folder.dispose();
    }
    const generated = materializeGenerated(60, "sample-busy");
    try {
      await inFreshPage(context, async (page) => {
        await screen(page, "local folder dialog while the files are read", async () => {
          const dialog = await openLocalDialog(page);
          await page.evaluate(() => (window as unknown as { __hauntmap: { intake: { setReadDelay(ms: number): void } } }).__hauntmap.intake.setReadDelay(150));
          await chooseFolder(page, generated.dir);
          await dialog.getByRole("button", { name: "Analyze" }).click();
          await expect(dialog).toHaveAttribute("aria-busy", "true");
        });
      });
    } finally {
      generated.dispose();
    }

    // 7. The GitHub dialog.
    await inFreshPage(context, async (page) => {
      await routeJsdelivr(page, () => undefined);
      await screen(page, "GitHub dialog as opened", async () => {
        await openGithubDialog(page);
      });
      await screen(page, "GitHub dialog asking for a branch or tag", async () => {
        await loadRepository(page, `${REPO_URL}/tree/feature/x`);
        await expect(page.getByRole("dialog").getByLabel("Branch or tag")).toBeVisible();
      });
    });
    await inFreshPage(context, async (page) => {
      await routeJsdelivr(page, bigAnswers(509));
      await screen(page, "GitHub dialog with the cap error alert", async () => {
        await openGithubDialog(page);
        await loadRepository(page, `${REPO_URL}/tree/main`);
        await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
      });
    });
    await inFreshPage(context, async (page) => {
      await routeJsdelivr(page, bigAnswers(30, 400));
      await screen(page, "GitHub dialog while the files are fetched", async () => {
        const dialog = await openGithubDialog(page);
        await loadRepository(page, `${REPO_URL}/tree/main`);
        await expect(dialog).toHaveAttribute("aria-busy", "true");
      });
    });
    await inFreshPage(context, async (page) => {
      await routeJsdelivr(page, smallAnswers);
      await screen(page, "map of a loaded GitHub repository", async () => {
        await openGithubDialog(page);
        await loadRepository(page, `${REPO_URL}/tree/main`);
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await waitForOpenMap(page);
        await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("gh:octo/cat@main");
      });
    });

    if (REPORT !== undefined && REPORT !== "") writeReport(REPORT, scans);
    for (const result of scans) {
      const listed = result.violations.map((v) => `${v.id} (${v.impact ?? "no impact"}, ${v.nodes})`).join("; ");
      console.log(`AXE ${result.name}: ${listed === "" ? "no violations" : listed}`);
    }
    // Serious and critical violations fail the test; so does a screen that could not be reached.
    expect(problems).toEqual([]);
  });
});
