import { DEFAULT_ANALYSIS_OPTIONS } from "../../contracts/options";
import type { AnalysisOptions, SourceSet } from "../../contracts/types";
import { selectSources } from "../../analysis";
import { noFiles, tooManyBytes, tooManyFiles } from "./messages";

// Classification of a chosen folder before any file is read (Requirement 2). The rules are the analysis's own:
// the candidates go through selectSources with empty text, so no value is copied from it.

export type SkipReason = SourceSet["skipped"][number]["reason"];

export interface Candidate {
  path: string;
  size: number;
  file?: File;
}

export interface Review {
  /** The folder name, or `<owner>/<repo>@<ref>`. */
  folder: string;
  /** Sorted by path in code unit order. */
  included: Candidate[];
  /** Sorted by path. An excluded directory is one `<dir>/` entry. */
  skipped: { path: string; reason: Exclude<SkipReason, "binary"> }[];
  counts: Record<"excluded-dir" | "secret-pattern" | "extension" | "oversized", number>;
  includedBytes: number;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** `sample-local/src/a.ts` gives `{ folder: "sample-local", path: "src/a.ts" }`. Backslashes become `/`. */
export function stripRoot(webkitRelativePath: string): { folder: string; path: string } {
  const parts = webkitRelativePath.replace(/\\/g, "/").split("/").filter((part) => part !== "");
  if (parts.length <= 1) return { folder: "", path: parts.join("/") };
  return { folder: parts[0] ?? "", path: parts.slice(1).join("/") };
}

/** Classifies by path and size only. No file is read. */
export function classify(folder: string, candidates: Candidate[], options: AnalysisOptions = DEFAULT_ANALYSIS_OPTIONS): Review {
  const selected = selectSources(
    candidates.map((candidate) => ({ path: candidate.path, text: "", bytes: candidate.size })),
    "",
    { ...options, maxFiles: Number.MAX_SAFE_INTEGER, maxTotalBytes: Number.MAX_SAFE_INTEGER },
  );
  if (!selected.ok) throw new Error("classify: a cap was reached with both caps raised");

  const byPath = new Map<string, Candidate>();
  for (const candidate of candidates) if (!byPath.has(candidate.path)) byPath.set(candidate.path, candidate);

  const included: Candidate[] = selected.sourceSet.files.map((file) => ({ ...(byPath.get(file.path) ?? { path: file.path, size: file.bytes }), path: file.path }));
  included.sort((a, b) => compareText(a.path, b.path));

  const directories = new Set<string>();
  const skipped: Review["skipped"] = [];
  for (const entry of selected.sourceSet.skipped) {
    if (entry.reason === "binary") continue;
    if (entry.reason === "excluded-dir") {
      const segments = entry.path.split("/").slice(0, -1);
      const index = segments.findIndex((segment) => options.excludeDirectories.includes(segment));
      directories.add(`${segments.slice(0, index + 1).join("/")}/`);
    } else {
      skipped.push({ path: entry.path, reason: entry.reason });
    }
  }
  for (const path of directories) skipped.push({ path, reason: "excluded-dir" });
  skipped.sort((a, b) => compareText(a.path, b.path));

  const counts: Review["counts"] = { "excluded-dir": 0, "secret-pattern": 0, extension: 0, oversized: 0 };
  for (const entry of skipped) counts[entry.reason] += 1;
  return { folder, included, skipped, counts, includedBytes: included.reduce((sum, candidate) => sum + candidate.size, 0) };
}

/** `<n> KB` (rounded up) below 1 MiB, else `<n.n> MiB`. */
export function formatSize(bytes: number): string {
  if (bytes < 1_048_576) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MiB`;
}

export function reasonWords(reason: SkipReason): string {
  switch (reason) {
    case "excluded-dir":
      return "excluded directory";
    case "secret-pattern":
      return "secret or environment file";
    case "extension":
      return "other file type";
    case "oversized":
      return "over 1 MiB";
    case "binary":
      return "binary";
  }
}

export function plural(n: number, noun: string): string {
  return n === 1 ? `1 ${noun}` : `${n} ${noun}s`;
}

const MIB = 1_048_576;

/**
 * The sentence that says why a review cannot be analyzed, or null. A cap is an error, never a partial result.
 * The local forms are in messages.ts. The GitHub forms name `review.folder` (`<owner>/<repo>@<ref>`) and the first
 * included path over the limit.
 */
export function capMessage(review: Review, maxFiles: number, maxTotalBytes: number, route: "local" | "github"): string | null {
  const count = review.included.length;
  if (count > maxFiles) {
    if (route === "local") return tooManyFiles(count);
    return `${review.folder} has ${count} included files; the limit is ${maxFiles}. First excluded: ${review.included[maxFiles]?.path ?? ""}.`;
  }
  if (review.includedBytes > maxTotalBytes) {
    const size = formatSize(review.includedBytes);
    if (route === "local") return tooManyBytes(size);
    return `${review.folder} has ${size} of included text; the limit is ${maxTotalBytes / MIB} MiB.`;
  }
  if (count === 0) {
    if (route === "local") return noFiles(review.folder, review.skipped.length);
    return `No JavaScript or TypeScript files were found in ${review.folder}.`;
  }
  return null;
}
