import { describe, expect, it } from "vitest";
import * as messages from "../../src/features/import/messages";

// 10.7: no text joins two words with a hyphen or dash. Templates are called with sample values that contain none.
const DASH_BETWEEN_LETTERS = /\p{L}[-\u2010-\u2015\u2212]\p{L}/u;

const SAMPLES: Record<string, unknown[][]> = {
  heading: [["local", "open"], ["local", "after"], ["github", "open"], ["github", "after"]],
  tooManyFiles: [[1001]],
  tooManyBytes: [["25.0 MiB"]],
  noFiles: [["sample", 3]],
  readingStarted: [[4, "sample"]],
  reading: [[1, 4]],
  analyzing: [[1, 4]],
  cancelled: [["local:sample"], [null]],
  summary: [["sample", 3, 1, 1, 6, 1, 0], ["sample", 1, 1, 1, 1, 1, 1]],
  analyzeFailed: [["the worker stopped"]],
  savedMessage: [["local:sample", "12 KB", true], ["local:sample", "12 KB", false]],
  saveFailed: [["QuotaExceededError"]],
  opened: [["local:sample"]],
  forgot: [["local:sample"]],
  savedItem: [["local:sample", 3, "2026-11-19", true], ["local:sample", 1, "2026-11-19", false]],
  savedInvalid: [["local:sample", "schemaVersion must be 1"]],
  graphNotJson: [["Unexpected end of input"]],
  graphInvalid: [["schemaVersion must be 1"]],
  imported: [["local:sample", 3, 1]],
  folderLine: [["sample"]],
  includedLine: [[4, "1 KB"]],
  skippedLine: [[6]],
  excludedDirsLine: [[2]],
  secretLine: [[2]],
  extensionLine: [[1]],
  oversizedLine: [[1]],
  includedListTitle: [[4]],
  skippedListTitle: [[6]],
  skippedEntry: [[".env", "secret or environment file"]],
  moreEntries: [[7]],
  openSaved: [["local:sample"]],
  forgetSaved: [["local:sample"]],
  savedListTitle: [[2]],
};

describe("local messages", () => {
  const exported = Object.entries(messages);

  it("has a sample call for every exported template", () => {
    const missing = exported.filter(([name, value]) => typeof value === "function" && SAMPLES[name] === undefined).map(([name]) => name);
    expect(missing).toEqual([]);
  });

  it("has no dash or hyphen between two letters in any string or template", () => {
    const offenders: string[] = [];
    for (const [name, value] of exported) {
      const texts: string[] = [];
      if (typeof value === "string") texts.push(value);
      else if (typeof value === "function") for (const args of SAMPLES[name] ?? []) texts.push(String((value as (...a: unknown[]) => unknown)(...args)));
      for (const text of texts) if (DASH_BETWEEN_LETTERS.test(text)) offenders.push(`${name}: ${text}`);
    }
    expect(offenders).toEqual([]);
  });

  it("the check finds a dash between letters (a check of the check)", () => {
    expect(DASH_BETWEEN_LETTERS.test("read-only")).toBe(true);
    expect(DASH_BETWEEN_LETTERS.test("read\u2014only")).toBe(true);
    expect(DASH_BETWEEN_LETTERS.test("node_modules and .next")).toBe(false);
  });

  it("uses the exact words of the design", () => {
    expect(messages.LANDING_LOCAL).toBe("Analyze a local folder");
    expect(messages.LANDING_GITHUB).toBe("Load a GitHub repository");
    expect(messages.COMPARE_LOCAL).toBe("Local folder as the newer snapshot");
    expect(messages.COMPARE_GITHUB).toBe("GitHub repository as the newer snapshot");
    expect(messages.heading("local", "open")).toBe("Analyze a local folder");
    expect(messages.heading("github", "after")).toBe("Load a GitHub repository as the newer snapshot");
    expect(messages.NO_DIRECTORY_INPUT).toBe("Folder selection is not available in this browser. Import a graph file instead.");
    expect(messages.REVIEW_SENTENCE).toBe("Included files are read in this browser and kept in memory.");
    expect(messages.tooManyFiles(1001)).toBe("This folder has 1,001 included files; the limit is 1,000. Choose a subfolder.");
    expect(messages.noFiles("sample-local", 2)).toBe("No JavaScript or TypeScript files were found in sample-local (2 files skipped).");
    expect(messages.readingStarted(4, "sample-local")).toBe("Reading 4 files from sample-local.");
    expect(messages.reading(3, 4)).toBe("Reading 3 of 4 files");
    expect(messages.analyzing(3, 4)).toBe("Analyzing 3 of 4 files");
    expect(messages.cancelled("local:x")).toBe("Analysis cancelled. local:x is still open.");
    expect(messages.cancelled(null)).toBe("Analysis cancelled.");
    expect(messages.analyzeFailed("boom")).toBe("The folder could not be analyzed (boom).");
    expect(messages.PRESERVED).toBe("The previous investigation is unchanged.");
    expect(messages.SAVE_BUTTON).toBe("Save investigation on this device");
    expect(messages.SAVE_UNAVAILABLE).toBe("Saving is not available in this browser.");
    expect(messages.GRAPH_TOO_LARGE).toBe("The graph file is larger than 25 MiB.");
  });

  it("writes the summary of the fixture folder exactly (3.5)", () => {
    expect(messages.summary("sample-local", 3, 1, 1, 6, 1, 0)).toBe(
      "Analyzed sample-local: 3 modules, 1 relation, 1 diagnostic; 6 files skipped before reading, 1 binary file skipped, 0 files failed to parse.",
    );
    expect(messages.summary("x", 1, 2, 0, 1, 2, 1)).toBe("Analyzed x: 1 module, 2 relations, 0 diagnostics; 1 file skipped before reading, 2 binary files skipped, 1 file failed to parse.");
  });

  it("writes the review lines of 2.4", () => {
    expect(messages.folderLine("sample-local")).toBe("Folder: sample-local");
    expect(messages.includedLine(4, "1 KB")).toBe("Included: 4 files, 1 KB");
    expect(messages.skippedLine(6)).toBe("Skipped: 6");
    expect(messages.excludedDirsLine(2)).toBe("2 in excluded directories (.git, node_modules, dist, build, out, .next, coverage)");
    expect(messages.secretLine(2)).toBe("2 secret or environment files");
    expect(messages.extensionLine(1)).toBe("1 other file types");
    expect(messages.oversizedLine(1)).toBe("1 over 1 MiB");
    expect(messages.includedListTitle(4)).toBe("Included files (4)");
    expect(messages.skippedListTitle(6)).toBe("Skipped files (6)");
    expect(messages.skippedEntry(".env", "secret or environment file")).toBe(".env \u00b7 secret or environment file");
    expect(messages.moreEntries(7)).toBe("\u2026 and 7 more");
  });
});
