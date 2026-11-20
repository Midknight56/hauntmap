import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Investigation } from "../../src/contracts/types";
import { openedStore } from "../ui/storeHarness";
import { chooseFiles, fakeIntakeStore, folderInput, heldReadWorkers, inlineAnalysisClient, installDirectoryInput, itemsOf, makeHarness, namedError, removeDirectoryInput, sizedFile } from "./dialogHarness";
import { createMemorySavedStore } from "../../src/features/import/saved";
import type { SavedRecord, SavedStore } from "../../src/features/import/types";
import { graphFixture, liveCounts, liveInvestigation, liveText } from "./graphHelpers";
import { filesOfManifest, readManifest } from "./materialize";

// Component tests of the local dialog (jsdom). This file grows with the tasks: task 4 holds 1.2, 1.4, 2.1, 2.4, 2.5 and the
// first screen and review parts of 10.2; task 5 adds reading, analysis, cancel, failure and the summary.

beforeAll(installDirectoryInput);
afterAll(removeDirectoryInput);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const dialog = (): HTMLElement => screen.getByRole("dialog");
const sampleFiles = (): File[] => filesOfManifest(readManifest("folder"));

describe("the dialog frame (1.2)", () => {
  it("is a modal dialog labelled by its heading, and focus moves to the first control", async () => {
    const h = makeHarness();
    void h.open();
    const box = dialog();
    expect(box.getAttribute("aria-modal")).toBe("true");
    const heading = within(box).getByRole("heading", { name: "Analyze a local folder" });
    expect(box.getAttribute("aria-labelledby")).toBe(heading.id);
    expect(document.activeElement).toBe(folderInput());
    expect(box.getAttribute("aria-busy")).toBeNull();
  });

  it("adds the newer snapshot suffix to the heading in after mode", () => {
    const h = makeHarness();
    void h.open({ purpose: "after" });
    expect(within(dialog()).getByRole("heading", { name: "Analyze a local folder as the newer snapshot" })).toBeTruthy();
  });

  it("keeps Tab and Shift+Tab inside the dialog", async () => {
    const user = userEvent.setup();
    const h = makeHarness();
    void h.open();
    const input = folderInput();
    const graph = screen.getByLabelText("Choose a graph file");
    const close = within(dialog()).getByRole("button", { name: "Close" });
    expect(document.activeElement).toBe(input);
    await user.tab();
    expect(document.activeElement).toBe(graph);
    await user.tab();
    expect(document.activeElement).toBe(close);
    await user.tab();
    expect(document.activeElement).toBe(input);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(close);
  });

  it("closes on Escape, resolves cancelled and returns focus to the element that was focused before the call", async () => {
    const h = makeHarness();
    const result = h.open();
    expect(document.activeElement).not.toBe(h.opener);
    fireEvent.keyDown(dialog(), { key: "Escape" });
    await expect(result).resolves.toEqual({ ok: false, reason: "cancelled" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(h.opener);
  });

  it("closes on Close, resolves cancelled and returns focus to the opener", async () => {
    const h = makeHarness();
    const result = h.open();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Close" }));
    await expect(result).resolves.toEqual({ ok: false, reason: "cancelled" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(h.opener);
  });

  it("stops Escape from reaching the rest of the page", () => {
    const h = makeHarness();
    void h.open();
    let reached = false;
    const listener = (): void => {
      reached = true;
    };
    document.addEventListener("keydown", listener);
    fireEvent.keyDown(dialog(), { key: "Escape" });
    document.removeEventListener("keydown", listener);
    expect(reached).toBe(false);
  });

  it("opens one dialog only: a second call returns the open one (1.4)", () => {
    const h = makeHarness();
    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    act(() => {
      first = h.service.open({ purpose: "open", kind: "local" });
    });
    act(() => {
      second = h.service.open({ purpose: "open", kind: "local" });
    });
    expect(second).toBe(first);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });
});

describe("the first screen (2.1)", () => {
  it("offers a folder input labelled Choose a folder, with webkitdirectory, as the first control", () => {
    const h = makeHarness();
    void h.open();
    const input = folderInput();
    expect(input.type).toBe("file");
    expect(input.hasAttribute("webkitdirectory")).toBe(true);
    expect(screen.queryByText("Folder selection is not available in this browser. Import a graph file instead.")).toBeNull();
    expect(h.store.calls).toEqual([]);
  });

  it("shows the Import a graph file section with its file input", () => {
    const h = makeHarness();
    void h.open();
    expect(within(dialog()).getByRole("heading", { name: "Import a graph file" })).toBeTruthy();
    const input = screen.getByLabelText("Choose a graph file") as HTMLInputElement;
    expect(input.type).toBe("file");
    expect(input.accept).toBe(".json,application/json");
  });

  it("shows the sentence and no folder input when the browser has no folder selection", () => {
    removeDirectoryInput();
    try {
      const h = makeHarness();
      void h.open();
      expect(screen.queryByLabelText("Choose a folder")).toBeNull();
      expect(within(dialog()).getByText("Folder selection is not available in this browser. Import a graph file instead.")).toBeTruthy();
      expect(document.activeElement).toBe(screen.getByLabelText("Choose a graph file"));
    } finally {
      installDirectoryInput();
    }
  });
});

describe("the review (2.4, 2.6)", () => {
  it("shows the review of the fixture folder exactly, and moves focus to Analyze", () => {
    const files = sampleFiles();
    const h = makeHarness();
    void h.open();
    chooseFiles(folderInput(), files);
    const box = dialog();
    expect(within(box).getByText("Folder: sample-local")).toBeTruthy();
    expect(within(box).getByText("Included: 4 files, 1 KB")).toBeTruthy();
    expect(within(box).getByText("Skipped: 6")).toBeTruthy();
    expect(within(box).getByText(/^2 in excluded directories \(.git, node_modules, dist, build, out, \.next, coverage\)$/)).toBeTruthy();
    expect(within(box).getByText("2 secret or environment files")).toBeTruthy();
    expect(within(box).getByText("1 other file types")).toBeTruthy();
    expect(within(box).getByText("1 over 1 MiB")).toBeTruthy();
    expect(itemsOf("Included files (4)")).toEqual(["bin.ts", "src/a.ts", "src/b.ts", "src/c.tsx"]);
    expect(itemsOf("Skipped files (6)")).toEqual([
      ".env \u00b7 secret or environment file",
      "README.md \u00b7 other file type",
      "big.ts \u00b7 over 1 MiB",
      "dist/ \u00b7 excluded directory",
      "node_modules/ \u00b7 excluded directory",
      "secret.pem \u00b7 secret or environment file",
    ]);
    expect(within(box).getByText("Included files are read in this browser and kept in memory.")).toBeTruthy();
    const analyze = within(box).getByRole("button", { name: "Analyze" });
    expect(analyze.className).toContain("primary");
    expect(analyze.getAttribute("aria-disabled")).toBeNull();
    expect(within(box).getByRole("button", { name: "Back" })).toBeTruthy();
    expect(within(box).getByRole("button", { name: "Close" })).toBeTruthy();
    expect(document.activeElement).toBe(analyze);
    expect(h.store.calls).toEqual([]);
    expect(h.analysis.calls).toEqual([]);
    expect(h.workers.workers).toEqual([]);
  });

  it("reads no file before Analyze (2.2)", async () => {
    const { guardedFile } = await import("./fakes");
    const files = [guardedFile("src/a.ts", "export {};\n", "guarded"), guardedFile("README.md", "# x\n", "guarded")];
    const h = makeHarness();
    void h.open();
    chooseFiles(folderInput(), files);
    expect(within(dialog()).getByText("Folder: guarded")).toBeTruthy();
    expect(files.flatMap((file) => file.attempts)).toEqual([]);
  });

  it("omits a skip line whose count is 0, and shows no skipped reasons when nothing is skipped", () => {
    const h = makeHarness();
    void h.open();
    chooseFiles(folderInput(), [sizedFile("tiny", "src/a.ts", 10)]);
    const box = dialog();
    expect(within(box).getByText("Skipped: 0")).toBeTruthy();
    expect(within(box).queryByText(/in excluded directories/)).toBeNull();
    expect(within(box).queryByText(/secret or environment files/)).toBeNull();
    expect(within(box).queryByText(/other file types/)).toBeNull();
    expect(within(box).queryByText(/over 1 MiB/)).toBeNull();
    expect(within(box).getByText("Included: 1 files, 1 KB")).toBeTruthy();
  });

  it("shows the first 200 entries of a long list followed by how many more", () => {
    const h = makeHarness();
    void h.open();
    const files = Array.from({ length: 250 }, (_, i) => sizedFile("many", `src/m${String(i).padStart(3, "0")}.ts`, 20));
    chooseFiles(folderInput(), files);
    const items = itemsOf("Included files (250)");
    expect(items).toHaveLength(201);
    expect(items[0]).toBe("src/m000.ts");
    expect(items[199]).toBe("src/m199.ts");
    expect(items[200]).toBe("\u2026 and 50 more");
    fireEvent.click(within(dialog()).getByRole("button", { name: "Back" }));
    const skipped = Array.from({ length: 203 }, (_, i) => sizedFile("many", `docs/n${String(i).padStart(3, "0")}.md`, 5));
    chooseFiles(folderInput(), [...files.slice(0, 1), ...skipped]);
    const skippedItems = itemsOf("Skipped files (203)");
    expect(skippedItems).toHaveLength(201);
    expect(skippedItems[200]).toBe("\u2026 and 3 more");
  });

  it("makes both lists named, scrollable regions that can take focus", () => {
    const h = makeHarness();
    void h.open();
    chooseFiles(folderInput(), sampleFiles());
    for (const name of ["Included files (4)", "Skipped files (6)"]) {
      const region = screen.getByRole("region", { name });
      expect(region.getAttribute("tabindex")).toBe("0");
      expect(region.getAttribute("aria-label")).toBe(name);
    }
  });

  it("Back returns to the first screen", () => {
    const h = makeHarness();
    void h.open();
    chooseFiles(folderInput(), sampleFiles());
    fireEvent.click(within(dialog()).getByRole("button", { name: "Back" }));
    expect(screen.queryByRole("region", { name: "Included files (4)" })).toBeNull();
    expect(folderInput()).toBeTruthy();
    expect(document.activeElement).toBe(folderInput());
  });

  it("an empty selection changes nothing", () => {
    const h = makeHarness();
    void h.open();
    chooseFiles(folderInput(), []);
    expect(screen.queryByRole("button", { name: "Analyze" })).toBeNull();
  });
});

describe("the caps are errors, not partial results (2.5)", () => {
  it("disables Analyze above 1,000 included files, with the sentence", () => {
    const h = makeHarness();
    void h.open();
    chooseFiles(folderInput(), Array.from({ length: 1001 }, (_, i) => sizedFile("big-folder", `src/m${i}.ts`, 10)));
    const analyze = within(dialog()).getByRole("button", { name: "Analyze" });
    expect(analyze.getAttribute("aria-disabled")).toBe("true");
    expect(within(dialog()).getByText("This folder has 1,001 included files; the limit is 1,000. Choose a subfolder.")).toBeTruthy();
    fireEvent.click(analyze);
    expect(h.workers.workers).toEqual([]);
    expect(h.store.calls).toEqual([]);
  });

  it("disables Analyze above 25 MiB of included text, with the size in the sentence", () => {
    const h = makeHarness();
    void h.open();
    chooseFiles(folderInput(), Array.from({ length: 27 }, (_, i) => sizedFile("heavy", `src/m${i}.ts`, 1_000_000)));
    expect(within(dialog()).getByRole("button", { name: "Analyze" }).getAttribute("aria-disabled")).toBe("true");
    expect(within(dialog()).getByText("This folder has 25.7 MiB of included text; the limit is 25 MiB. Choose a subfolder.")).toBeTruthy();
  });

  it("disables Analyze when no file is included, and counts the skipped files", () => {
    const h = makeHarness();
    void h.open();
    chooseFiles(folderInput(), [sizedFile("docs-only", "README.md", 5), sizedFile("docs-only", "notes/a.md", 5)]);
    expect(within(dialog()).getByRole("button", { name: "Analyze" }).getAttribute("aria-disabled")).toBe("true");
    expect(within(dialog()).getByText("No JavaScript or TypeScript files were found in docs-only (2 files skipped).")).toBeTruthy();
  });

  it("allows exactly 1,000 files", () => {
    const h = makeHarness();
    void h.open();
    chooseFiles(folderInput(), Array.from({ length: 1000 }, (_, i) => sizedFile("edge", `src/m${i}.ts`, 10)));
    expect(within(dialog()).getByRole("button", { name: "Analyze" }).getAttribute("aria-disabled")).toBeNull();
  });
});

describe("the Tab order (10.2)", () => {
  async function tabOrder(count: number): Promise<string[]> {
    const user = userEvent.setup();
    const names: string[] = [];
    const nameOf = (el: Element | null): string => {
      if (el === null) return "";
      const label = el.getAttribute("aria-label");
      if (label !== null) return label;
      if (el instanceof HTMLInputElement) return Array.from(el.labels ?? []).map((l) => l.textContent).join("");
      return el.textContent ?? "";
    };
    names.push(nameOf(document.activeElement));
    for (let i = 1; i < count; i += 1) {
      await user.tab();
      names.push(nameOf(document.activeElement));
    }
    return names;
  }

  it("first screen: Choose a folder, Choose a graph file, then Close", async () => {
    const h = makeHarness();
    void h.open();
    expect(await tabOrder(4)).toEqual(["Choose a folder", "Choose a graph file", "Close", "Choose a folder"]);
  });

  it("review: Analyze is focused first; then Back, Close, then the two list regions", async () => {
    const h = makeHarness();
    void h.open();
    chooseFiles(folderInput(), sampleFiles());
    expect(await tabOrder(6)).toEqual(["Analyze", "Back", "Close", "Included files (4)", "Skipped files (6)", "Analyze"]);
  });

  it("review: the DOM order is the two lists, Analyze, Back, Close", () => {
    const h = makeHarness();
    void h.open();
    chooseFiles(folderInput(), sampleFiles());
    const order = Array.from(dialog().querySelectorAll('[tabindex="0"], button')).map((el) => el.getAttribute("aria-label") ?? el.textContent);
    expect(order).toEqual(["Included files (4)", "Skipped files (6)", "Analyze", "Back", "Close"]);
  });
});

// ---- Task 5: reading, analysis, cancel, failure and the summary ----

const SUMMARY = "Analyzed sample-local: 3 modules, 1 relation, 1 diagnostic; 6 files skipped before reading, 1 binary file skipped, 0 files failed to parse.";

/** The six fields that a cancel, a failure and an `after` call must leave as they were (3.3). */
function sixFields(state: unknown): unknown {
  const s = state as Record<string, unknown>;
  return structuredClone({ investigation: s["investigation"], selection: s["selection"], routeFilter: s["routeFilter"], camera: s["camera"], expandedWings: s["expandedWings"], layout: s["layout"] });
}

const analyzeButton = (): HTMLElement => within(dialog()).getByRole("button", { name: "Analyze" });
const clickAnalyze = (): void => {
  fireEvent.click(analyzeButton());
};

/** Opens the dialog, chooses the fixture folder and clicks Analyze with a read worker the test controls. */
function startHeld(overrides: Parameters<typeof makeHarness>[0] = {}) {
  const held = heldReadWorkers();
  const h = makeHarness({ ...overrides, deps: { createReadWorker: held.create, ...overrides.deps } });
  void h.open();
  chooseFiles(folderInput(), sampleFiles());
  clickAnalyze();
  return { h, held };
}

describe("reading (3.1, 3.2)", () => {
  it("posts the four included files in one read request and shows the progress text, with Cancel the only control", () => {
    const { h, held } = startHeld();
    expect(held.workers).toHaveLength(1);
    const request = held.workers[0]?.posted[0];
    expect(request?.kind).toBe("read");
    expect(request?.revision).toBe(1);
    expect(request?.payload.delayMs).toBe(0);
    expect(request?.payload.files.map((f) => f.path)).toEqual(["bin.ts", "src/a.ts", "src/b.ts", "src/c.tsx"]);
    expect(h.store.statuses).toEqual(["Reading 4 files from sample-local."]);
    expect(dialog().getAttribute("aria-busy")).toBe("true");
    expect(within(dialog()).getByText("Reading 0 of 4 files")).toBeTruthy();
    const buttons = within(dialog()).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Cancel"]);
    expect(buttons[0]?.getAttribute("aria-disabled")).toBeNull();
    expect(document.activeElement).toBe(buttons[0]);
  });

  it("passes the delay that the development hook set", () => {
    const held = heldReadWorkers();
    const h = makeHarness({ deps: { createReadWorker: held.create } });
    h.service.setReadDelay(20);
    void h.open();
    chooseFiles(folderInput(), sampleFiles());
    clickAnalyze();
    expect(held.workers[0]?.posted[0]?.payload.delayMs).toBe(20);
  });

  it("updates the text from the worker, then shows the analysis progress from the client", async () => {
    const { h, held } = startHeld();
    held.workers[0]?.progress(2, 4);
    expect(within(dialog()).getByText("Reading 2 of 4 files")).toBeTruthy();
    const worker = held.workers[0];
    const files = [
      { path: "src/a.ts", text: "export {};\n", bytes: 11 },
      { path: "src/b.ts", text: "export {};\n", bytes: 11 },
    ];
    worker?.done({ files, binary: ["bin.ts"] });
    await waitFor(() => expect(h.analysis.calls).toHaveLength(1));
    expect(within(dialog()).getByText("Analyzing 0 of 3 files")).toBeTruthy();
    expect(dialog().getAttribute("aria-busy")).toBe("true");
    act(() => h.analysis.calls[0]?.onProgress?.(2, 3));
    expect(within(dialog()).getByText("Analyzing 2 of 3 files")).toBeTruthy();
    expect(within(dialog()).getAllByRole("button").map((b) => b.textContent)).toEqual(["Cancel"]);
    expect(h.store.statuses).toEqual(["Reading 4 files from sample-local."]);
  });

  it("ignores Escape while work runs", () => {
    const { h, held } = startHeld();
    fireEvent.keyDown(dialog(), { key: "Escape" });
    expect(dialog()).toBeTruthy();
    expect(h.results).toEqual([]);
    expect(held.workers[0]?.terminated).toBe(false);
  });
});

describe("the analysis request (3.4)", () => {
  it("sends the read files and one empty entry for the file over 1 MiB, with the options of the store's preset", async () => {
    const store = fakeIntakeStore({ preset: "type-inclusive" });
    const h = makeHarness({ store });
    void h.open();
    chooseFiles(folderInput(), sampleFiles());
    clickAnalyze();
    await waitFor(() => expect(h.analysis.calls).toHaveLength(1));
    const request = h.analysis.calls[0]?.request;
    expect(request?.rootLabel).toBe("local:sample-local");
    expect(request?.files.map((f) => [f.path, f.text === "", f.bytes])).toEqual([
      ["src/a.ts", false, 70],
      ["src/b.ts", false, 20],
      ["src/c.tsx", false, 29],
      ["big.ts", true, 1_048_577],
    ]);
    expect(request?.options.preset).toBe("type-inclusive");
    expect(request?.options.maxFiles).toBe(1000);
    expect(request?.options.maxTotalBytes).toBe(26_214_400);
  });
});

describe("the result in open mode (1.3, 1.5, 3.5)", () => {
  it("opens the investigation, then writes the summary: one status message at the start and one at the end", async () => {
    const h = makeHarness({ deps: { analysisClient: inlineAnalysisClient() } });
    const result = h.open();
    chooseFiles(folderInput(), sampleFiles());
    clickAnalyze();
    await waitFor(() => expect(within(dialog()).getByText(SUMMARY)).toBeTruthy());
    expect(h.store.calls).toEqual(["setStatus", "openInvestigation", "setStatus"]);
    expect(h.store.statuses).toEqual(["Reading 4 files from sample-local.", SUMMARY]);
    const opened = h.store.opened[0];
    expect(opened?.demo).toBe(false);
    expect(opened?.investigation.sourceLabel).toBe("local:sample-local");
    expect(opened ? [...(opened.source ?? new Map()).keys()] : null).toEqual(["src/a.ts", "src/b.ts", "src/c.tsx"]);
    expect(opened?.source?.get("src/a.ts")).toContain("SENTINEL-LOCAL-4e2b17");
    const resolved = await result;
    expect(resolved).toMatchObject({ ok: true, label: "local:sample-local" });
    expect(dialog().getAttribute("aria-busy")).toBeNull();
    expect(within(dialog()).getByRole("button", { name: "Close" })).toBeTruthy();
  });

  it("counts relations by relation ID and singular nouns by 1 (3.5)", async () => {
    const h = makeHarness({ deps: { analysisClient: inlineAnalysisClient() } });
    void h.open();
    chooseFiles(folderInput(), sampleFiles());
    clickAnalyze();
    await waitFor(() => expect(h.store.statuses).toHaveLength(2));
    const investigation = h.store.opened[0]?.investigation as Investigation;
    expect(new Set(investigation.imports.map((i) => i.relationId)).size).toBe(1);
    expect(h.store.statuses[1]).toBe(SUMMARY);
  });

  it("returns focus to the opener on Close when it is still in the document", async () => {
    const h = makeHarness({ deps: { analysisClient: inlineAnalysisClient() } });
    void h.open();
    chooseFiles(folderInput(), sampleFiles());
    clickAnalyze();
    await waitFor(() => expect(within(dialog()).getByText(SUMMARY)).toBeTruthy());
    fireEvent.click(within(dialog()).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(h.opener);
  });

  it("returns focus to the map wrapper on Close when the opener is gone", async () => {
    const h = makeHarness({ deps: { analysisClient: inlineAnalysisClient() } });
    void h.open();
    const wrapper = document.createElement("div");
    wrapper.setAttribute("role", "application");
    wrapper.setAttribute("aria-label", "Haunted map");
    wrapper.tabIndex = 0;
    document.body.append(wrapper);
    chooseFiles(folderInput(), sampleFiles());
    clickAnalyze();
    await waitFor(() => expect(within(dialog()).getByText(SUMMARY)).toBeTruthy());
    h.opener.remove();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Close" }));
    expect(document.activeElement).toBe(wrapper);
    wrapper.remove();
  });
});

describe("the result in after mode (9.2, 9.4: the part this task needs)", () => {
  it("opens nothing and writes no summary, and resolves the investigation", async () => {
    const h = makeHarness({ deps: { analysisClient: inlineAnalysisClient() } });
    const result = h.open({ purpose: "after" });
    chooseFiles(folderInput(), sampleFiles());
    clickAnalyze();
    await expect(result).resolves.toMatchObject({ ok: true, label: "local:sample-local" });
    expect(h.store.calls).not.toContain("openInvestigation");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("cancel (3.3)", () => {
  it("in reading: terminates the worker, keeps the six fields, says so, and returns to the review with Analyze focused", () => {
    const real = openedStore("triad");
    const store = fakeIntakeStore({ over: real.store });
    const before = sixFields(real.store.getState());
    const { held } = startHeld({ store });
    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    expect(held.workers[0]?.terminated).toBe(true);
    expect(real.store.getState().status).toBe(`Analysis cancelled. ${real.inv.sourceLabel} is still open.`);
    expect(sixFields(real.store.getState())).toEqual(before);
    expect(store.calls).toEqual(["setStatus", "setStatus"]);
    expect(dialog().getAttribute("aria-busy")).toBeNull();
    expect(analyzeButton().getAttribute("aria-disabled")).toBeNull();
    expect(document.activeElement).toBe(analyzeButton());
    expect(within(dialog()).getByText("Folder: sample-local")).toBeTruthy();
  });

  it("in reading, with no investigation open: Analysis cancelled.", () => {
    const { h } = startHeld();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    expect(h.store.statuses.at(-1)).toBe("Analysis cancelled.");
  });

  it("creates a fresh worker for the next read", () => {
    const { held } = startHeld();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    clickAnalyze();
    expect(held.workers).toHaveLength(2);
    expect(held.workers[0]?.terminated).toBe(true);
    expect(held.workers[1]?.terminated).toBe(false);
    expect(held.workers[1]?.posted).toHaveLength(1);
  });

  it("in analysis: calls the analysis client's cancel, keeps the six fields and returns to the review", async () => {
    const real = openedStore("triad");
    const store = fakeIntakeStore({ over: real.store });
    const before = sixFields(real.store.getState());
    const h = makeHarness({ store });
    void h.open();
    chooseFiles(folderInput(), sampleFiles());
    clickAnalyze();
    await waitFor(() => expect(h.analysis.calls).toHaveLength(1));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    expect(h.analysis.cancelCount).toBe(1);
    await waitFor(() => expect(real.store.getState().status).toBe(`Analysis cancelled. ${real.inv.sourceLabel} is still open.`));
    expect(sixFields(real.store.getState())).toEqual(before);
    expect(store.calls).not.toContain("openInvestigation");
    expect(analyzeButton().getAttribute("aria-disabled")).toBeNull();
    expect(document.activeElement).toBe(analyzeButton());
  });
});

describe("failure (3.6)", () => {
  it("analysis failed: the message with the preservation sentence, the six fields kept, back to the review", async () => {
    const real = openedStore("triad");
    const store = fakeIntakeStore({ over: real.store });
    const before = sixFields(real.store.getState());
    const h = makeHarness({ store });
    void h.open();
    chooseFiles(folderInput(), sampleFiles());
    clickAnalyze();
    await waitFor(() => expect(h.analysis.calls).toHaveLength(1));
    act(() => h.analysis.calls[0]?.reject(namedError("AnalysisFailed", "the worker stopped")));
    await waitFor(() => expect(real.store.getState().status).toBe("The folder could not be analyzed (the worker stopped). The previous investigation is unchanged."));
    expect(sixFields(real.store.getState())).toEqual(before);
    expect(store.calls).not.toContain("openInvestigation");
    expect(document.activeElement).toBe(analyzeButton());
    expect(h.results).toEqual([]);
  });

  it("read error: the same message and the same state", async () => {
    const { h, held } = startHeld();
    held.workers[0]?.fail("disk unplugged");
    await waitFor(() => expect(h.store.statuses.at(-1)).toBe("The folder could not be analyzed (disk unplugged). The previous investigation is unchanged."));
    expect(h.store.calls).not.toContain("openInvestigation");
    expect(document.activeElement).toBe(analyzeButton());
  });

  it("in after mode the bare message is the result and no status is written", async () => {
    const held = heldReadWorkers();
    const h = makeHarness({ deps: { createReadWorker: held.create } });
    const result = h.open({ purpose: "after" });
    chooseFiles(folderInput(), sampleFiles());
    clickAnalyze();
    held.workers[0]?.fail("disk unplugged");
    await expect(result).resolves.toEqual({ ok: false, reason: "failed", message: "The folder could not be analyzed (disk unplugged)." });
    expect(h.store.statuses).toEqual(["Reading 4 files from sample-local."]);
  });
});

describe("privacy of the dialog (4.3, 4.4)", () => {
  it("writes nothing to localStorage, sessionStorage or IndexedDB, and logs nothing, over a whole analysis", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");
    const clear = vi.spyOn(Storage.prototype, "clear");
    const open = vi.fn();
    vi.stubGlobal("indexedDB", { open });
    const logs = (["error", "warn", "log", "info", "debug"] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => undefined));
    const h = makeHarness({ deps: { analysisClient: inlineAnalysisClient() } });
    void h.open();
    chooseFiles(folderInput(), sampleFiles());
    clickAnalyze();
    await waitFor(() => expect(within(dialog()).getByText(SUMMARY)).toBeTruthy());
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });

  it("logs no folder name, path or text when the analysis fails", async () => {
    const logs = (["error", "warn", "log", "info", "debug"] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => undefined));
    const h = makeHarness();
    void h.open();
    chooseFiles(folderInput(), sampleFiles());
    clickAnalyze();
    await waitFor(() => expect(h.analysis.calls).toHaveLength(1));
    act(() => h.analysis.calls[0]?.reject(namedError("AnalysisFailed", "boom")));
    await waitFor(() => expect(h.store.statuses).toHaveLength(2));
    const logged = logs.flatMap((log) => log.mock.calls.map((call) => JSON.stringify(call)));
    for (const text of logged) for (const secret of ["sample-local", "src/a.ts", "SENTINEL-LOCAL-4e2b17"]) expect(text).not.toContain(secret);
  });
});

// ---- Task 7: saved investigations and graph files ----

const NOW = new Date("2026-11-19T10:00:00.000Z");
const saveButton = (): HTMLElement => within(dialog()).getByRole("button", { name: "Save investigation on this device" });
const includeBox = (): HTMLInputElement => within(dialog()).getByRole("checkbox", { name: "Include source text" }) as HTMLInputElement;

function savedRecord(label: string, savedAt: string, sourceText: Record<string, string> | null = null, investigation: unknown = { ...liveInvestigation(), sourceLabel: label }): SavedRecord {
  return { savedVersion: 1, label, savedAt, investigation: investigation as SavedRecord["investigation"], sourceText };
}

async function reachResult(h: ReturnType<typeof makeHarness>): Promise<void> {
  void h.open();
  chooseFiles(folderInput(), sampleFiles());
  clickAnalyze();
  await waitFor(() => expect(within(dialog()).getByText(SUMMARY)).toBeTruthy());
}

const withStore = (saved: SavedStore | null) => makeHarness({ deps: { saved, analysisClient: inlineAnalysisClient(), now: () => NOW } });

describe("save on the result screen (5.1, 5.2, 5.4)", () => {
  it("shows the save button, an unchecked Include source text, the sentence and Close, in that Tab order", async () => {
    const h = withStore(createMemorySavedStore());
    await reachResult(h);
    expect(saveButton().getAttribute("aria-disabled")).toBeNull();
    expect(includeBox().checked).toBe(false);
    expect(within(dialog()).getByText("Saved investigations stay in this browser's storage until you forget them.")).toBeTruthy();
    const order = Array.from(dialog().querySelectorAll<HTMLElement>("button, input[type=checkbox]")).map((el) => (el.tagName === "INPUT" ? "Include source text" : el.textContent));
    expect(order).toEqual(["Save investigation on this device", "Include source text", "Close"]);
  });

  it("saves nothing until the button is activated", async () => {
    const store = createMemorySavedStore();
    const h = withStore(store);
    await reachResult(h);
    expect(await store.list()).toEqual([]);
  });

  it("writes one record keyed by the label with source text left out when the box is unchecked", async () => {
    const store = createMemorySavedStore();
    const h = withStore(store);
    await reachResult(h);
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.store.statuses.at(-1)).toMatch(/^Saved local:sample-local on this device \(/));
    const [record] = await store.list();
    expect(record).toMatchObject({ savedVersion: 1, label: "local:sample-local", savedAt: "2026-11-19T10:00:00.000Z", sourceText: null });
    expect(record?.investigation.sourceLabel).toBe("local:sample-local");
    expect(h.store.statuses.at(-1)).toMatch(/\(\d+(\.\d)? (B|KB|MiB), source text left out\)\.$/);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("includes the source text of every read file when the box is checked", async () => {
    const store = createMemorySavedStore();
    const h = withStore(store);
    await reachResult(h);
    fireEvent.click(includeBox());
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.store.statuses.at(-1)).toMatch(/source text included\)\.$/));
    const [record] = await store.list();
    expect(Object.keys(record?.sourceText ?? {})).toEqual(["src/a.ts", "src/b.ts", "src/c.tsx"]);
    expect(record?.sourceText?.["src/a.ts"]).toContain("SENTINEL-LOCAL-4e2b17");
  });

  it("replaces the record with the same label", async () => {
    const store = createMemorySavedStore();
    const h = withStore(store);
    await reachResult(h);
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.store.statuses.at(-1)).toMatch(/^Saved /));
    fireEvent.click(includeBox());
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.store.statuses.at(-1)).toMatch(/source text included\)\.$/));
    expect(await store.list()).toHaveLength(1);
  });

  it("renders the button aria-disabled with the sentence when no store exists", async () => {
    const h = withStore(null);
    await reachResult(h);
    expect(saveButton().getAttribute("aria-disabled")).toBe("true");
    expect(within(dialog()).getByText("Saving is not available in this browser.")).toBeTruthy();
    fireEvent.click(saveButton());
    expect(h.store.statuses).toHaveLength(2);
  });

  it("renders the button aria-disabled when the first list rejects", async () => {
    const broken: SavedStore = { list: () => Promise.reject(namedError("SecurityError", "no")), put: () => Promise.resolve(), delete: () => Promise.resolve() };
    const h = withStore(broken);
    await reachResult(h);
    await waitFor(() => expect(saveButton().getAttribute("aria-disabled")).toBe("true"));
    expect(within(dialog()).getByText("Saving is not available in this browser.")).toBeTruthy();
  });

  it("says The investigation could not be saved (<name>) and keeps the dialog and focus when a write fails", async () => {
    const base = createMemorySavedStore();
    const failing: SavedStore = { ...base, put: () => Promise.reject(namedError("QuotaExceededError", "full")) };
    const h = withStore(failing);
    await reachResult(h);
    saveButton().focus();
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.store.statuses.at(-1)).toBe("The investigation could not be saved (QuotaExceededError)."));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(document.activeElement).toBe(saveButton());
  });

  it("has no save controls in after mode", async () => {
    const h = withStore(createMemorySavedStore());
    const result = h.open({ purpose: "after" });
    chooseFiles(folderInput(), sampleFiles());
    clickAnalyze();
    await expect(result).resolves.toMatchObject({ ok: true });
    expect(screen.queryByRole("button", { name: "Save investigation on this device" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("the saved list (5.3)", () => {
  async function withRecords() {
    const store = createMemorySavedStore();
    await store.put(savedRecord("local:old", "2026-11-17T08:00:00.000Z", null));
    await store.put(savedRecord("local:new", "2026-11-19T08:00:00.000Z", { "src/a.ts": "export {};\n" }));
    return store;
  }

  it("lists newest first, with the details line and an Open and a Forget button for each", async () => {
    const h = makeHarness({ deps: { saved: await withRecords() } });
    void h.open();
    await screen.findByRole("heading", { name: "Saved on this device (2)" });
    const items = itemsOf("Saved on this device (2)");
    const modules = liveCounts().modules;
    expect(items[0]).toContain(`local:new \u00b7 ${modules} modules \u00b7 saved 2026-11-19 \u00b7 source text included`);
    expect(items[1]).toContain(`local:old \u00b7 ${modules} modules \u00b7 saved 2026-11-17 \u00b7 source text left out`);
    for (const label of ["local:new", "local:old"]) {
      expect(within(dialog()).getByRole("button", { name: `Open ${label}` })).toBeTruthy();
      expect(within(dialog()).getByRole("button", { name: `Forget ${label}` })).toBeTruthy();
    }
  });

  it("keeps the Tab order: folder, graph file, each Open and Forget, Close", async () => {
    const h = makeHarness({ deps: { saved: await withRecords() } });
    void h.open();
    await screen.findByRole("heading", { name: "Saved on this device (2)" });
    const order = Array.from(dialog().querySelectorAll<HTMLElement>("button, input")).map((el) => (el.tagName === "INPUT" ? (el as HTMLInputElement).labels?.[0]?.textContent : el.textContent));
    expect(order).toEqual(["Choose a folder", "Choose a graph file", "Open local:new", "Forget local:new", "Open local:old", "Forget local:old", "Close"]);
  });

  it("shows no saved list when no store exists or the first list rejects", async () => {
    const h = makeHarness();
    void h.open();
    expect(screen.queryByRole("heading", { name: /^Saved on this device/ })).toBeNull();
    cleanup();
    const broken: SavedStore = { list: () => Promise.reject(namedError("SecurityError", "no")), put: () => Promise.resolve(), delete: () => Promise.resolve() };
    const h2 = makeHarness({ deps: { saved: broken } });
    void h2.open();
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole("heading", { name: /^Saved on this device/ })).toBeNull();
  });

  it("Open validates, opens the record with its source map, says so and closes the dialog", async () => {
    const h = makeHarness({ deps: { saved: await withRecords() } });
    const result = h.open();
    fireEvent.click(await screen.findByRole("button", { name: "Open local:new" }));
    await expect(result).resolves.toMatchObject({ ok: true, label: "local:new" });
    expect(h.store.calls).toEqual(["openInvestigation", "setStatus"]);
    expect(h.store.opened[0]?.demo).toBe(false);
    expect([...(h.store.opened[0]?.source?.keys() ?? [])]).toEqual(["src/a.ts"]);
    expect(h.store.statuses).toEqual(["Opened local:new from this device."]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Open of a record with no source text passes null", async () => {
    const h = makeHarness({ deps: { saved: await withRecords() } });
    void h.open();
    fireEvent.click(await screen.findByRole("button", { name: "Open local:old" }));
    await waitFor(() => expect(h.store.opened).toHaveLength(1));
    expect(h.store.opened[0]?.source).toBeNull();
  });

  it("Open of an invalid record deletes it, says why, opens nothing and moves focus on", async () => {
    const store = await withRecords();
    await store.put(savedRecord("local:bad", "2026-11-18T08:00:00.000Z", null, { schemaVersion: 2 }));
    const h = makeHarness({ deps: { saved: store } });
    void h.open();
    fireEvent.click(await screen.findByRole("button", { name: "Open local:bad" }));
    await waitFor(() => expect(h.store.statuses).toHaveLength(1));
    expect(h.store.statuses[0]).toMatch(/^The saved investigation local:bad is not valid \(schemaVersion must be 1 \(found 2\)\) and was removed\.$/);
    expect(h.store.opened).toEqual([]);
    expect((await store.list()).map((r) => r.label)).toEqual(["local:new", "local:old"]);
    await screen.findByRole("heading", { name: "Saved on this device (2)" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open local:old" }));
  });

  it("Forget deletes the record, says so and keeps the dialog open", async () => {
    const store = await withRecords();
    const h = makeHarness({ deps: { saved: store } });
    void h.open();
    fireEvent.click(await screen.findByRole("button", { name: "Forget local:new" }));
    await screen.findByRole("heading", { name: "Saved on this device (1)" });
    expect(h.store.statuses).toEqual(["Forgot local:new."]);
    expect((await store.list()).map((r) => r.label)).toEqual(["local:old"]);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open local:old" }));
  });

  it("Forgetting the last record moves focus to Close", async () => {
    const store = createMemorySavedStore();
    await store.put(savedRecord("local:only", "2026-11-19T08:00:00.000Z"));
    const h = makeHarness({ deps: { saved: store } });
    void h.open();
    fireEvent.click(await screen.findByRole("button", { name: "Forget local:only" }));
    await waitFor(() => expect(h.store.statuses).toEqual(["Forgot local:only."]));
    await waitFor(() => expect(document.activeElement).toBe(within(dialog()).getByRole("button", { name: "Close" })));
  });

  it("Open in after mode resolves the record without opening it", async () => {
    const h = makeHarness({ deps: { saved: await withRecords() } });
    const result = h.open({ purpose: "after" });
    fireEvent.click(await screen.findByRole("button", { name: "Open local:new" }));
    await expect(result).resolves.toMatchObject({ ok: true, label: "local:new" });
    expect(h.store.calls).not.toContain("openInvestigation");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("graph file import (6.1 to 6.4)", () => {
  const graphInput = (): HTMLInputElement => screen.getByLabelText("Choose a graph file") as HTMLInputElement;
  const chooseGraph = (file: File): void => {
    Object.defineProperty(graphInput(), "files", { value: [file], configurable: true });
    fireEvent.change(graphInput());
  };

  it("opens a valid graph with no source text, says what was imported and closes", async () => {
    const h = makeHarness();
    const result = h.open();
    chooseGraph(new File([liveText()], "live.json", { type: "application/json" }));
    await expect(result).resolves.toMatchObject({ ok: true, label: "live:haunts/manor", sourceText: null });
    const { modules, relations } = liveCounts();
    expect(h.store.calls).toEqual(["openInvestigation", "setStatus"]);
    expect(h.store.opened[0]?.source).toBeNull();
    expect(h.store.statuses).toEqual([`Imported live:haunts/manor: ${modules} modules, ${relations} relations. A graph file holds no source text.`]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it.each([
    ["malformed.json", "The graph file is not valid: schemaVersion must be 1 (found 2)."],
    ["not-json.txt", "The graph file is not JSON ("],
  ] as const)("%s shows its message, keeps the dialog open and focus on the input, and opens nothing", async (name, start) => {
    const h = makeHarness();
    void h.open();
    graphInput().focus();
    chooseGraph(new File([graphFixture(name)], name));
    await waitFor(() => expect(h.store.statuses).toHaveLength(1));
    expect(h.store.statuses[0]?.startsWith(start)).toBe(true);
    expect(h.store.calls).toEqual(["setStatus"]);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(document.activeElement).toBe(graphInput());
  });

  it("refuses a file over 25 MiB without reading it", async () => {
    const h = makeHarness();
    void h.open();
    const big = new File([""], "big.json");
    Object.defineProperty(big, "size", { value: 26_214_401 });
    const text = vi.fn();
    Object.defineProperty(big, "text", { value: text });
    chooseGraph(big);
    await waitFor(() => expect(h.store.statuses).toEqual(["The graph file is larger than 25 MiB."]));
    expect(text).not.toHaveBeenCalled();
  });

  it("in after mode resolves the graph as the result and calls no store action", async () => {
    const h = makeHarness();
    const result = h.open({ purpose: "after" });
    chooseGraph(new File([liveText()], "live.json"));
    await expect(result).resolves.toMatchObject({ ok: true, label: "live:haunts/manor", sourceText: null });
    expect(h.store.calls).toEqual([]);
  });

  it("in after mode a bad graph resolves the bare message and writes no status", async () => {
    const h = makeHarness();
    const result = h.open({ purpose: "after" });
    chooseGraph(new File([graphFixture("malformed.json")], "malformed.json"));
    await expect(result).resolves.toEqual({ ok: false, reason: "failed", message: "The graph file is not valid: schemaVersion must be 1 (found 2)." });
    expect(h.store.calls).toEqual([]);
  });
});
