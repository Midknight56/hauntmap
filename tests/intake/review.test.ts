import { describe, expect, it } from "vitest";
import { DEFAULT_ANALYSIS_OPTIONS } from "../../src/contracts/options";
import { capMessage, classify, formatSize, plural, reasonWords, stripRoot } from "../../src/features/import/review";
import type { Candidate } from "../../src/features/import/review";
import { guardedFile } from "./fakes";
import { entryBytes, filesOfManifest, readManifest } from "./materialize";

const options = DEFAULT_ANALYSIS_OPTIONS;

function candidatesOf(files: File[]): { folder: string; candidates: Candidate[] } {
  const stripped = files.map((file) => ({ file, ...stripRoot(file.webkitRelativePath) }));
  return { folder: stripped[0]?.folder ?? "", candidates: stripped.map(({ file, path }) => ({ path, size: file.size, file })) };
}

describe("stripRoot (2.2)", () => {
  it("removes the first segment and keeps the rest", () => {
    expect(stripRoot("sample-local/src/a.ts")).toEqual({ folder: "sample-local", path: "src/a.ts" });
    expect(stripRoot("root/a/b/c/d.ts")).toEqual({ folder: "root", path: "a/b/c/d.ts" });
  });

  it("turns backslashes into forward slashes", () => {
    expect(stripRoot("sample-local\\src\\a.ts")).toEqual({ folder: "sample-local", path: "src/a.ts" });
  });

  it("handles a file directly in the chosen folder", () => {
    expect(stripRoot("sample-local/index.ts")).toEqual({ folder: "sample-local", path: "index.ts" });
  });

  it("gives an empty folder name when the path has one segment", () => {
    expect(stripRoot("index.ts")).toEqual({ folder: "", path: "index.ts" });
  });
});

describe("classify (2.2, 2.3, 2.6)", () => {
  it("calls no read method of any file", () => {
    const files = readManifest("folder").files.map((entry) => guardedFile(entry.path, entryBytes(entry), "sample-local"));
    const { folder, candidates } = candidatesOf(files);
    const review = classify(folder, candidates, options);
    expect(review.included.length).toBeGreaterThan(0);
    for (const file of files) expect(file.attempts).toEqual([]);
  });

  it("gives the review of the fixture folder exactly", () => {
    const { folder, candidates } = candidatesOf(filesOfManifest(readManifest("folder")));
    const review = classify(folder, candidates, options);
    expect(review.folder).toBe("sample-local");
    expect(review.included.map((candidate) => candidate.path)).toEqual(["bin.ts", "src/a.ts", "src/b.ts", "src/c.tsx"]);
    expect(review.included.every((candidate) => candidate.file instanceof File)).toBe(true);
    expect(review.includedBytes).toBe(133);
    expect(review.skipped).toEqual([
      { path: ".env", reason: "secret-pattern" },
      { path: "README.md", reason: "extension" },
      { path: "big.ts", reason: "oversized" },
      { path: "dist/", reason: "excluded-dir" },
      { path: "node_modules/", reason: "excluded-dir" },
      { path: "secret.pem", reason: "secret-pattern" },
    ]);
    expect(review.counts).toEqual({ "excluded-dir": 2, "secret-pattern": 2, extension: 1, oversized: 1 });
  });

  it("groups nested excluded directories under one entry up to the first excluded segment", () => {
    const review = classify(
      "root",
      [
        { path: "a/node_modules/b/c.ts", size: 1 },
        { path: "a/node_modules/d.ts", size: 1 },
        { path: "a/node_modules/x/node_modules/e.ts", size: 1 },
        { path: "a/ok.ts", size: 1 },
        { path: ".git/config.js", size: 1 },
      ],
      options,
    );
    expect(review.skipped).toEqual([
      { path: ".git/", reason: "excluded-dir" },
      { path: "a/node_modules/", reason: "excluded-dir" },
    ]);
    expect(review.included.map((candidate) => candidate.path)).toEqual(["a/ok.ts"]);
    expect(review.counts["excluded-dir"]).toBe(2);
  });

  it("sorts included and skipped in code unit order", () => {
    const review = classify("r", [{ path: "b.ts", size: 1 }, { path: "B.ts", size: 1 }, { path: "a.md", size: 1 }, { path: "A.md", size: 1 }], options);
    expect(review.included.map((c) => c.path)).toEqual(["B.ts", "b.ts"]);
    expect(review.skipped.map((s) => s.path)).toEqual(["A.md", "a.md"]);
  });

  it("includes a file of exactly 1 MiB and skips one byte more", () => {
    const review = classify("r", [{ path: "ok.ts", size: 1_048_576 }, { path: "big.ts", size: 1_048_577 }], options);
    expect(review.included.map((c) => c.path)).toEqual(["ok.ts"]);
    expect(review.skipped).toEqual([{ path: "big.ts", reason: "oversized" }]);
  });
});

describe("capMessage (2.5)", () => {
  function many(n: number, size = 1): Candidate[] {
    return Array.from({ length: n }, (_, i) => ({ path: `src/m${i}.ts`, size }));
  }

  it("is null at the limits and for a normal folder", () => {
    expect(capMessage(classify("f", many(1000), options), 1000, 26_214_400, "local")).toBeNull();
    expect(capMessage(classify("f", [{ path: "a.ts", size: 26_214_400 }], { ...options, maxFileBytes: 30_000_000 }), 1000, 26_214_400, "local")).toBeNull();
  });

  it("names the count above 1,000 files", () => {
    expect(capMessage(classify("f", many(1001), options), 1000, 26_214_400, "local")).toBe("This folder has 1,001 included files; the limit is 1,000. Choose a subfolder.");
  });

  it("names the size above 25 MiB of included text", () => {
    const review = classify("f", [{ path: "a.ts", size: 26_214_401 }], { ...options, maxFileBytes: 30_000_000 });
    expect(capMessage(review, 1000, 26_214_400, "local")).toBe("This folder has 25.0 MiB of included text; the limit is 25 MiB. Choose a subfolder.");
  });

  it("says no JavaScript or TypeScript files were found, with the number skipped", () => {
    const review = classify("sample-local", [{ path: "README.md", size: 1 }, { path: "x.json", size: 1 }], options);
    expect(capMessage(review, 1000, 26_214_400, "local")).toBe("No JavaScript or TypeScript files were found in sample-local (2 files skipped).");
  });

  it("has the GitHub forms with the first excluded path", () => {
    const review = classify("o/r@main", many(401), options);
    const sorted = [...review.included].map((c) => c.path).sort();
    expect(capMessage(review, 400, 26_214_400, "github")).toBe(`o/r@main has 401 included files; the limit is 400. First excluded: ${sorted[400]}.`);
    expect(capMessage(classify("o/r@main", [{ path: "a.md", size: 1 }], options), 400, 26_214_400, "github")).toBe("No JavaScript or TypeScript files were found in o/r@main.");
    expect(capMessage(classify("o/r@main", [{ path: "a.ts", size: 26_214_401 }], { ...options, maxFileBytes: 30_000_000 }), 400, 26_214_400, "github")).toBe(
      "o/r@main has 25.0 MiB of included text; the limit is 25 MiB.",
    );
  });
});

describe("words and sizes", () => {
  it("formatSize rounds up to KB below 1 MiB and shows one decimal of MiB from there", () => {
    expect(formatSize(1)).toBe("1 KB");
    expect(formatSize(1024)).toBe("1 KB");
    expect(formatSize(1025)).toBe("2 KB");
    expect(formatSize(133)).toBe("1 KB");
    expect(formatSize(0)).toBe("0 KB");
    expect(formatSize(1_048_576)).toBe("1.0 MiB");
    expect(formatSize(26_214_401)).toBe("25.0 MiB");
  });

  it("reasonWords gives plain words", () => {
    expect(reasonWords("excluded-dir")).toBe("excluded directory");
    expect(reasonWords("secret-pattern")).toBe("secret or environment file");
    expect(reasonWords("extension")).toBe("other file type");
    expect(reasonWords("oversized")).toBe("over 1 MiB");
    expect(reasonWords("binary")).toBe("binary");
  });

  it("plural uses the singular for exactly one", () => {
    expect(plural(1, "relation")).toBe("1 relation");
    expect(plural(0, "relation")).toBe("0 relations");
    expect(plural(2, "binary file")).toBe("2 binary files");
  });
});
