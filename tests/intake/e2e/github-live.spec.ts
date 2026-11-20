import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { DEFAULT_ANALYSIS_OPTIONS } from "../../../src/contracts/options";
import { listRepository } from "../../../src/features/github/jsdelivr";
import { classify } from "../../../src/features/import/review";
import { readStatus, shot } from "../../e2e/helpers";
import { openGithubDialog, recordRequests, waitForOpenMap } from "./helpers";

// The real GitHub load of requirement 8.6, on this PC and its connection. It runs only when HAUNTMAP_LIVE_NETWORK=1, so that
// `pnpm verify:e2e` never depends on the network. With HAUNTMAP_SHOTS=1 it also writes the request list of the timed load and
// a screenshot of the progress text. The figure belongs to this PC and this run; the test does not fail on it.

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SHOTS = process.env["HAUNTMAP_SHOTS"] === "1";

const OWNER = "reduxjs";
const NAME = "redux";
const REF = "5.0.1";
const ADDRESS = `https://github.com/${OWNER}/${NAME}/tree/${REF}`;
const LABEL = `${OWNER}/${NAME}@${REF}`;

test.describe("a real public repository through jsDelivr (8.6)", () => {
  test.skip(process.env["HAUNTMAP_LIVE_NETWORK"] !== "1", "Set HAUNTMAP_LIVE_NETWORK=1 to load a repository from the real jsDelivr.");

  test(`${LABEL}: from Load until the map is open (printed, not asserted)`, async ({ page }) => {
    test.setTimeout(180_000);

    // The included count is checked from the listing first: the repository must have 150 to 400 included files.
    const listed = await listRepository(OWNER, NAME, REF, fetch, new AbortController().signal);
    expect(listed.ok, "the listing answered").toBe(true);
    if (!listed.ok) return;
    const review = classify(LABEL, listed.entries.map((entry) => ({ path: entry.path, size: entry.size })), DEFAULT_ANALYSIS_OPTIONS);
    const included = review.included.length;
    expect(included, "included files of the repository").toBeGreaterThanOrEqual(150);
    expect(included, "included files of the repository").toBeLessThanOrEqual(400);

    // The timed load, with the request list. No screenshot is taken during it.
    const dialog = await openGithubDialog(page);
    const recorded = recordRequests(page);
    await page.getByLabel("Repository URL").fill(ADDRESS);
    const started = Date.now();
    await dialog.getByRole("button", { name: "Load" }).click();
    await waitForOpenMap(page);
    const elapsed = Date.now() - started;
    expect(await readStatus(page)).toMatch(new RegExp(`^Loaded ${OWNER}/${NAME}@${REF.replace(/\./g, "\\.")}: ${included} files, \\d+ modules, \\d+ relations?(, \\d+ diagnostics?)?\\.$`));
    console.log(`INTAKE-TIMING-8.6 ${elapsed} ms (${LABEL}, ${included} included files)`);
    test.info().annotations.push({ type: "timing 8.6", description: `${elapsed} ms, ${LABEL}, ${included} included files` });

    const jsdelivr = recorded.requests.filter((request) => /^https:\/\/(data\.jsdelivr\.com|cdn\.jsdelivr\.net)\//.test(request.url));
    expect(jsdelivr.length).toBeGreaterThan(included);
    expect(jsdelivr.every((request) => request.method === "GET")).toBe(true);
    if (SHOTS) {
      mkdirSync(join(REPO, "docs", "acceptance", "intake"), { recursive: true });
      const list = recorded.requests.map((request) => ({ method: request.method, url: request.url }));
      writeFileSync(join(REPO, "docs", "acceptance", "intake", "github-live-requests.json"), `${JSON.stringify(list, null, 2)}\n`, "utf8");

      // The screenshot of the progress text comes from a second load, so that the timed one is not slowed by it. jsDelivr answers
      // this one from its cache and quickly, so each file request is passed on after a short pause to leave the progress on screen.
      await openGithubDialog(page);
      await page.route(/^https:\/\/cdn\.jsdelivr\.net\//, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 40));
        await route.continue();
      });
      await page.getByLabel("Repository URL").fill(ADDRESS);
      await page.getByRole("dialog").getByRole("button", { name: "Load" }).click();
      await page.waitForFunction(() => {
        const match = /^Fetched (\d+) of (\d+) files$/.exec(document.querySelector('[role="dialog"] .intake-progress')?.textContent ?? "");
        return match !== null && Number(match[1]) >= 20;
      });
      await shot(page, join(REPO, "docs", "acceptance", "img", "intake-github-progress.png"));
      await waitForOpenMap(page);
    }
  });
});
