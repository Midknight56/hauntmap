import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import fc from "fast-check";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { fileUrl, listingUrl } from "../../src/features/github/jsdelivr";
import { openedStore } from "../ui/storeHarness";
import { createFakeFetch, type FakeRoute } from "./fakes";
import { arbTree, listingBody, listingOf } from "./generators";
import { smallRepoRoutes } from "./githubFakes";
import { chooseFiles, fakeIntakeStore, folderInput, heldReadWorkers, inlineAnalysisClient, installDirectoryInput, makeHarness, namedError, removeDirectoryInput, sizedFile } from "./dialogHarness";
import { classify } from "../../src/features/import/review";
import { DEFAULT_ANALYSIS_OPTIONS } from "../../src/contracts/options";

// The properties that need a DOM. They are in this file, named `.dom.test.ts`, because the Vitest project of
// `*.test.ts` runs in Node (the same convention as tests/ui/properties.dom.test.ts). P5, local dialog (3.3, 9.4):
// for any dialog outcome other than success in `open` mode, the six store fields are deep equal before and after.

beforeAll(installDirectoryInput);
afterAll(removeDirectoryInput);
afterEach(cleanup);

const SEED = 20261119;
const OUTCOMES = ["cancel-reading", "cancel-analysis", "analysis-failed", "read-failed"] as const;

function sixFields(state: unknown): unknown {
  const s = state as Record<string, unknown>;
  return structuredClone({ investigation: s["investigation"], selection: s["selection"], routeFilter: s["routeFilter"], camera: s["camera"], expandedWings: s["expandedWings"], layout: s["layout"] });
}

describe("P5 preservation, local dialog (3.3, 3.6)", () => {
  it("leaves the six fields deep equal after a cancel or a failure, for any folder that can be analyzed", { timeout: 120_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(arbTree, fc.constantFrom(...OUTCOMES), async (tree, outcome) => {
        const candidates = tree.map((entry) => ({ path: entry.path, size: entry.size }));
        const review = classify("root", candidates, DEFAULT_ANALYSIS_OPTIONS);
        fc.pre(review.included.length > 0 && review.included.length <= 1000 && review.includedBytes <= 26_214_400);

        const real = openedStore("triad");
        const store = fakeIntakeStore({ over: real.store });
        const before = sixFields(real.store.getState());
        const held = heldReadWorkers();
        const h = makeHarness({ store, deps: { createReadWorker: held.create } });
        try {
          void h.open();
          chooseFiles(
            folderInput(),
            tree.map((entry) => sizedFile("root", entry.path, entry.size)),
          );
          fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Analyze" }));
          const worker = held.workers[0];
          if (outcome === "cancel-reading") {
            fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
          } else if (outcome === "read-failed") {
            worker?.fail("unreadable");
          } else {
            worker?.done({ files: review.included.map((entry) => ({ path: entry.path, text: "", bytes: entry.size })), binary: [] });
            await waitFor(() => expect(h.analysis.calls).toHaveLength(1));
            if (outcome === "cancel-analysis") fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
            else act(() => h.analysis.calls[0]?.reject(namedError("AnalysisFailed", "stopped")));
          }
          await waitFor(() => expect(screen.getByRole("button", { name: "Analyze" })).toBeTruthy());
          expect(sixFields(real.store.getState())).toEqual(before);
          expect(store.calls).not.toContain("openInvestigation");
        } finally {
          cleanup();
        }
      }),
      { numRuns: 200, seed: SEED },
    );
  });
});

// P5, GitHub dialog (3.3, 7.5, 7.6, 8.3, 8.4, 9.4): whatever stops a load short of success, in either mode, the six fields are deep equal.
const GITHUB_OUTCOMES = ["listing-status", "cap", "file-failed", "cancel-fetching"] as const;

describe("P5 preservation, GitHub dialog (3.3, 8.3, 8.4)", () => {
  it("leaves the six fields deep equal after a refused listing, the cap, a failed file or a cancel", { timeout: 120_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...GITHUB_OUTCOMES), fc.constantFrom<"open" | "after">("open", "after"), fc.constantFrom(403, 404, 500), fc.integer({ min: 401, max: 430 }), async (outcome, purpose, status, count) => {
        const routes: Record<string, FakeRoute> = smallRepoRoutes("octo", "cat", "main");
        if (outcome === "listing-status") routes[listingUrl("octo", "cat", "main")] = { status, body: { status } };
        if (outcome === "cap") routes[listingUrl("octo", "cat", "main")] = { body: { files: listingOf(count).map((entry) => ({ name: entry.path, hash: "h", size: entry.size })) } };
        if (outcome === "file-failed") routes[fileUrl("octo", "cat", "main", "src/b.ts")] = { status, body: "" };
        if (outcome === "cancel-fetching") routes[fileUrl("octo", "cat", "main", "src/a.ts")] = { hold: true, body: listingBody("/src/a.ts") };
        const fake = createFakeFetch(routes);
        const real = openedStore("triad");
        const store = fakeIntakeStore({ over: real.store });
        const before = sixFields(real.store.getState());
        const h = makeHarness({ store, github: true, deps: { github: { fetchImpl: fake.fetch }, analysisClient: inlineAnalysisClient() } });
        try {
          void h.open({ kind: "github", purpose });
          fireEvent.change(screen.getByLabelText("Repository URL"), { target: { value: "https://github.com/octo/cat/tree/main" } });
          fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Load" }));
          if (outcome === "cancel-fetching") {
            await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy());
            fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
          }
          if (purpose === "open" || outcome === "cancel-fetching") await waitFor(() => expect(screen.getByRole("button", { name: "Load" })).toBeTruthy());
          else await waitFor(() => expect(h.results).toHaveLength(1));
          expect(sixFields(real.store.getState())).toEqual(before);
          expect(store.calls).not.toContain("openInvestigation");
        } finally {
          cleanup();
        }
      }),
      { numRuns: 40, seed: SEED },
    );
  });
});