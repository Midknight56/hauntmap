import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEFAULT_ANALYSIS_OPTIONS } from "../src/analysis/index";

// The shared walker of samples/manor and public/demo/manor/before. Only files with one of the six
// included extensions count (the extension list is the analysis default, never copied here).
// Used by scripts/demo-reset.ts, scripts/demo-live.ts and tests/kiro/sample-copy.test.ts.

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function collect(dir: string, prefix: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) collect(join(dir, entry.name), relative, out);
    else if (DEFAULT_ANALYSIS_OPTIONS.includeExtensions.some((extension) => entry.name.endsWith(extension))) out.push(relative);
  }
}

/** Relative paths (forward slashes) of every included file under `root`, in code-point order. A missing folder lists nothing. */
export function listIncluded(root: string): string[] {
  if (!existsSync(root)) return [];
  const paths: string[] = [];
  collect(root, "", paths);
  return paths.sort(compareText);
}

/** True when both trees hold the same included paths with byte-equal content. */
export function treesEqual(a: string, b: string): boolean {
  const left = listIncluded(a);
  const right = listIncluded(b);
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    const path = left[i] as string;
    if (path !== right[i]) return false;
    const parts = path.split("/");
    if (!readFileSync(join(a, ...parts)).equals(readFileSync(join(b, ...parts)))) return false;
  }
  return true;
}

/** Copies every included file of `from` to `to` at the same relative path; returns the number of files. */
export function copyIncluded(from: string, to: string): number {
  const paths = listIncluded(from);
  for (const path of paths) {
    const parts = path.split("/");
    const target = join(to, ...parts);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(from, ...parts), target);
  }
  return paths.length;
}
