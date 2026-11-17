import { createHash } from "node:crypto";
import type { Dirent, Stats } from "node:fs";
import * as fsPromises from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import process from "node:process";
import { selectSources } from "../../../src/analysis/index";
import type { HashFn } from "../../../src/analysis/index";
import type { AnalysisOptions, Diagnostic, SourceFile, SourceSet } from "../../../src/contracts/types";

// The Node source loader (Requirements 2.1 to 2.8). It walks a root inside the workspace, reads the
// files that may be included, and hands every file to selectSources of src/analysis, so that the
// classification and its order are the app's. Options come from the caller (DEFAULT_ANALYSIS_OPTIONS
// of src/analysis); none is repeated here.

/** The subset of node:fs/promises the loader uses; tests inject a recording implementation. */
export interface FsLike {
  readdir(path: string, options: { withFileTypes: true }): Promise<Dirent[]>;
  stat(path: string): Promise<Stats>;
  lstat(path: string): Promise<Stats>;
  realpath(path: string): Promise<string>;
  readFile(path: string): Promise<Uint8Array>;
}

export const nodeFs: FsLike = {
  readdir: (path, options) => fsPromises.readdir(path, options),
  stat: (path) => fsPromises.stat(path),
  lstat: (path) => fsPromises.lstat(path),
  realpath: (path) => fsPromises.realpath(path),
  readFile: (path) => fsPromises.readFile(path),
};

export type RootError =
  | { code: "root-outside-workspace"; message: string }
  | { code: "root-not-found"; message: string }
  | { code: "cap-reached"; message: string };

export interface ResolvedRoot {
  /** The argument as given. */
  given: string;
  /** The real path of the root, inside the workspace. */
  absolute: string;
  /** `live:<root>`, see sourceLabelFor. */
  label: string;
  /** The real path of the workspace the root was resolved against. */
  workspaceRoot: string;
}

/** `live:` plus the root with backslashes turned into `/`, one leading `./` and any trailing `/` removed. */
export function sourceLabelFor(root: string): string {
  let text = root.replace(/\\/g, "/");
  if (text.startsWith("./")) text = text.slice(2);
  text = text.replace(/\/+$/, "");
  return `live:${text === "" ? "." : text}`;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** True when `path` is the workspace or below it. Both sides are real paths, so case and short names agree. */
function isInside(workspaceRoot: string, path: string): boolean {
  if (path === workspaceRoot) return true;
  const base = workspaceRoot.endsWith(sep) ? workspaceRoot : workspaceRoot + sep;
  return path.startsWith(base);
}

/**
 * Resolves `root` against `workspaceRoot` (itself a real path). Accepted only when the real path is
 * the workspace or below it and is a directory. Nothing outside the workspace is read.
 */
export async function resolveRoot(workspaceRoot: string, root: string, fs: FsLike = nodeFs): Promise<{ ok: true; root: ResolvedRoot } | { ok: false; error: RootError }> {
  const outside: RootError = { code: "root-outside-workspace", message: `Root "${root}" resolves outside the working directory "${workspaceRoot}".` };
  const notFound: RootError = { code: "root-not-found", message: `Root "${root}" does not exist or is not a directory.` };
  const absolute = resolve(workspaceRoot, root);
  let real: string;
  try {
    real = await fs.realpath(absolute);
  } catch {
    return { ok: false, error: isInside(workspaceRoot, absolute) ? notFound : outside };
  }
  if (!isInside(workspaceRoot, real)) return { ok: false, error: outside };
  try {
    if (!(await fs.stat(real)).isDirectory()) return { ok: false, error: notFound };
  } catch {
    return { ok: false, error: notFound };
  }
  return { ok: true, root: { given: root, absolute: real, label: sourceLabelFor(root), workspaceRoot } };
}

/** The loader's own test for "may this file be read": the exclude patterns, where `*` is any run of characters. */
function matchesPattern(name: string, pattern: string): boolean {
  const source = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}$`).test(name);
}

function extensionOf(name: string): string {
  const index = name.lastIndexOf(".");
  return index <= 0 ? "" : name.slice(index);
}

interface WalkState {
  fs: FsLike;
  root: ResolvedRoot;
  options: AnalysisOptions;
  candidates: SourceFile[];
  skipped: SourceSet["skipped"];
  visited: Set<string>;
}

async function walk(state: WalkState, directory: string, relative: string): Promise<void> {
  const { fs, root, options } = state;
  const entries = [...(await fs.readdir(directory, { withFileTypes: true }))].sort((a, b) => compareText(a.name, b.name));
  for (const entry of entries) {
    const name = entry.name;
    const path = relative === "" ? name : `${relative}/${name}`;
    const absolute = join(directory, name);
    const isLink = entry.isSymbolicLink();

    if ((entry.isDirectory() || isLink) && options.excludeDirectories.includes(name)) {
      state.skipped.push({ path: `${path}/`, reason: "excluded-dir" });
      continue;
    }

    let target = absolute;
    let isDirectory = entry.isDirectory();
    let isFile = entry.isFile();
    if (isLink || (!isDirectory && !isFile)) {
      let real: string;
      try {
        real = await fs.realpath(absolute);
      } catch {
        process.stderr.write(`hauntmap-mcp: skipped ${path}: the link cannot be resolved\n`);
        continue;
      }
      if (!isInside(root.workspaceRoot, real)) {
        process.stderr.write(`hauntmap-mcp: skipped ${path}: the link leaves the workspace\n`);
        continue;
      }
      const stats = await fs.stat(real);
      isDirectory = stats.isDirectory();
      isFile = stats.isFile();
      target = real;
    }

    if (isDirectory) {
      if (state.visited.has(target)) continue;
      state.visited.add(target);
      await walk(state, target, path);
      continue;
    }
    if (!isFile) continue;

    const size = (await fs.stat(target)).size;
    const mayInclude =
      !options.excludeFilePatterns.some((pattern) => matchesPattern(name, pattern)) && options.includeExtensions.includes(extensionOf(name)) && size <= options.maxFileBytes;
    const text = mayInclude ? new TextDecoder("utf-8").decode(await fs.readFile(target)) : "";
    state.candidates.push({ path, text, bytes: size });
  }
}

function capError(root: ResolvedRoot, options: AnalysisOptions, diagnostic: Diagnostic | undefined): RootError {
  const first = diagnostic?.module ?? "";
  if (diagnostic !== undefined && / bytes were found /.test(diagnostic.message)) {
    return { code: "cap-reached", message: `Root "${root.given}" exceeds ${options.maxTotalBytes / (1024 * 1024)} MiB of included text; first excluded: ${first}.` };
  }
  return { code: "cap-reached", message: `Root "${root.given}" has more than ${options.maxFiles} included files; first excluded: ${first}.` };
}

/**
 * Loads the SourceSet of `root`. Excluded directories are not entered and get one `<dir>/` entry. Every
 * other file goes to selectSources. A cap is an error, not a partial result.
 */
export async function loadSourceSet(root: ResolvedRoot, options: AnalysisOptions, fs: FsLike = nodeFs): Promise<{ ok: true; sourceSet: SourceSet; diagnostics: Diagnostic[] } | { ok: false; error: RootError }> {
  const state: WalkState = { fs, root, options, candidates: [], skipped: [], visited: new Set([root.absolute]) };
  await walk(state, root.absolute, "");
  const selected = selectSources(state.candidates, root.label, options);
  if (!selected.ok) return { ok: false, error: capError(root, options, selected.diagnostics[0]) };
  const skipped = [...state.skipped, ...selected.sourceSet.skipped].sort((a, b) => compareText(a.path, b.path));
  return { ok: true, sourceSet: { rootLabel: root.label, files: selected.sourceSet.files, skipped }, diagnostics: selected.diagnostics };
}

/** SHA-256 hex of the UTF-8 encoding of `text`, through node:crypto. The HashFn passed to analyze. */
export const sha256Hex: HashFn = async (text) => createHash("sha256").update(text, "utf8").digest("hex");
