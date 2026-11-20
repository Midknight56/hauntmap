import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Investigation } from "../../src/contracts/types";
import { openedStore } from "../ui/storeHarness";
import { chooseFiles, fakeIntakeStore, folderInput, heldReadWorkers, inlineAnalysisClient, installDirectoryInput, itemsOf, makeHarness, namedError, removeDirectoryInput, sizedFile } from "./dialogHarness";
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
    const close = within(dialog()).getByRole("button", { name: "Close" });
    expect(document.activeElement).toBe(input);
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

  it("shows the Import a graph file section heading, empty until task 7", () => {
    const h = makeHarness();
    void h.open();
    expect(within(dialog()).getByRole("heading", { name: "Import a graph file" })).toBeTruthy();
  });

  it("shows the sentence and no folder input when the browser has no folder selection", () => {
    removeDirectoryInput();
    try {
      const h = makeHarness();
      void h.open();
      expect(screen.queryByLabelText("Choose a folder")).toBeNull();
      expect(within(dialog()).getByText("Folder selection is not available in this browser. Import a graph file instead.")).toBeTruthy();
      expect(document.activeElement).toBe(within(dialog()).getByRole("button", { name: "Close" }));
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

  it("first screen: Choose a folder, then Close", async () => {
    const h = makeHarness();
    void h.open();
    expect(await tabOrder(3)).toEqual(["Choose a folder", "Close", "Choose a folder"]);
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