import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import fc from "fast-check";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { openedStore } from "../ui/storeHarness";
import { arbTree } from "./generators";
import { chooseFiles, fakeIntakeStore, folderInput, heldReadWorkers, installDirectoryInput, makeHarness, namedError, removeDirectoryInput, sizedFile } from "./dialogHarness";
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
