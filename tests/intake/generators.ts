import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import type { Investigation } from "../../src/contracts/types";
import type { Manifest } from "./materialize";

// Generators for the intake tests (design.md, Correctness Properties). Property tests use 200 runs and a fixed seed.

export interface TreeEntry {
  path: string;
  size: number;
}
export interface ListingEntryShape {
  path: string;
  size: number;
}

/** A generated folder `src/m<i>.ts`, each file importing the next. `bytesEach` pads every file with a comment to that size. */
export function folderOf(n: number, opts: { folder?: string; bytesEach?: number } = {}): Manifest {
  const files = [];
  for (let i = 0; i < n; i += 1) {
    let text = i + 1 < n ? `import { v${i + 1} } from "./m${i + 1}";\nexport const v${i} = v${i + 1} + 1;\n` : `export const v${i} = ${i};\n`;
    if (opts.bytesEach !== undefined && opts.bytesEach > text.length + 3) text += `//${"x".repeat(opts.bytesEach - text.length - 3)}\n`;
    files.push({ path: `src/m${i}.ts`, text });
  }
  return { folder: opts.folder ?? "sample-gen", files };
}

/** `n` listing entries `/src/m<i>.ts` of size 20, in index order (not sorted). */
export function listingOf(n: number): ListingEntryShape[] {
  return Array.from({ length: n }, (_, i) => ({ path: `/src/m${i}.ts`, size: 20 }));
}

/** The body the fake CDN serves for a `listingOf` path: `export const m<i> = <i>;\n`. */
export function listingBody(path: string): string {
  const index = /m(\d+)\.ts$/.exec(path)?.[1] ?? "0";
  return `export const m${index} = ${index};\n`;
}

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;
const plainName = fc.stringMatching(/^[A-Za-z0-9_]([A-Za-z0-9._]{0,6}[A-Za-z0-9_])?$/).filter((name) => !RESERVED.test(name.split(".")[0] ?? ""));
const dirName = fc.oneof({ weight: 6, arbitrary: plainName }, { weight: 2, arbitrary: fc.constantFrom("node_modules", ".git", "dist") });
const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts", ".md", ".json", ".png"];
const fileName = fc.oneof(
  { weight: 8, arbitrary: fc.tuple(plainName, fc.constantFrom(...EXTENSIONS)).map(([stem, ext]) => `${stem}${ext}`) },
  { weight: 1, arbitrary: fc.constantFrom(".env", "x.pem", "id_rsa") },
);
const fileSize = fc.oneof(
  { weight: 97, arbitrary: fc.integer({ min: 0, max: 5000 }) },
  { weight: 1, arbitrary: fc.constant(1_048_576) },
  { weight: 2, arbitrary: fc.integer({ min: 1_048_577, max: 2_000_000 }) },
);
const rawEntry = fc.tuple(fc.array(dirName, { minLength: 0, maxLength: 4 }), fileName, fileSize).map(([dirs, name, size]) => ({ path: [...dirs, name].join("/"), size }));

/**
 * Drops entries that repeat a path ignoring case, or that would need one name to be both a file and a folder.
 * Folders that differ only in case are given the casing of the first one, so the tree can be written on a
 * case-insensitive file system (Windows) and read back with the same paths.
 */
function normalizeTree(entries: TreeEntry[]): TreeEntry[] {
  const casing = new Map<string, string>();
  const accepted: { entry: TreeEntry; lower: string }[] = [];
  for (const raw of entries) {
    const parts = raw.path.split("/");
    const dirs = parts.slice(0, -1);
    const fixed: string[] = [];
    dirs.forEach((dir, index) => {
      const key = [...dirs.slice(0, index), dir].join("/").toLowerCase();
      fixed.push(casing.get(key)?.split("/").pop() ?? dir);
    });
    const entry = { path: [...fixed, parts[parts.length - 1] ?? ""].join("/"), size: raw.size };
    const lower = entry.path.toLowerCase();
    const clash = accepted.some((other) => other.lower === lower || other.lower.startsWith(`${lower}/`) || lower.startsWith(`${other.lower}/`));
    if (clash) continue;
    accepted.push({ entry, lower });
    fixed.forEach((_, index) => {
      const key = fixed.slice(0, index + 1).join("/").toLowerCase();
      if (!casing.has(key)) casing.set(key, fixed.slice(0, index + 1).join("/"));
    });
  }
  return accepted.map((item) => item.entry);
}

/** 1 to 80 candidates, depth 0 to 4, safe to write to a Windows folder (no two paths differ only in case). */
export const arbTree: fc.Arbitrary<TreeEntry[]> = fc.array(rawEntry, { minLength: 1, maxLength: 80 }).map(normalizeTree);

/** 0 to 450 listing entries with a leading slash, like the jsDelivr listing. */
export const arbListing: fc.Arbitrary<ListingEntryShape[]> = fc
  .array(rawEntry, { minLength: 0, maxLength: 450 })
  .map((entries) => normalizeTree(entries).map((entry) => ({ path: `/${entry.path}`, size: entry.size })));

const nameChars = fc.stringMatching(/^[A-Za-z0-9_.-]{1,8}$/);
const owner = nameChars;
const prefix = fc.oneof(
  { weight: 12, arbitrary: fc.constant("https://github.com/") },
  { weight: 1, arbitrary: fc.constantFrom("http://github.com/", " https://github.com/", "https://gitlab.com/", "https://github.com", "github.com/", "https://www.github.com/") },
);
const suffix = fc.constantFrom("", "/", ".git", ".git/", "/tree/main", "/tree/v1.2", "/tree/a/b", "/blob/main/x.ts", "/issues", "//", " ", "?x=1", "#top");

/** Strings around `https://github.com/`: owners, repos, refs, subpaths, suffixes and junk. */
export const arbUrl: fc.Arbitrary<string> = fc.oneof(
  { weight: 8, arbitrary: fc.tuple(prefix, owner, nameChars, suffix).map(([p, o, r, s]) => `${p}${o}/${r}${s}`) },
  { weight: 2, arbitrary: fc.tuple(prefix, owner).map(([p, o]) => `${p}${o}`) },
  { weight: 1, arbitrary: fc.string({ maxLength: 40 }) },
  { weight: 1, arbitrary: fc.tuple(prefix, fc.string({ maxLength: 20 })).map(([p, junk]) => `${p}${junk}`) },
);

export interface RecordShape {
  savedVersion: 1;
  label: string;
  savedAt: string;
  investigation: Investigation;
  sourceText: Record<string, string> | null;
}

let base: Investigation | null = null;
function baseInvestigation(): Investigation {
  base ??= JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "demo", "live.json"), "utf8")) as Investigation;
  return base;
}

/** Valid saved records: `public/demo/live.json` (read only) with a generated label, time and optional source text. */
export const arbRecord: fc.Arbitrary<RecordShape> = fc
  .tuple(
    fc.stringMatching(/^[A-Za-z0-9_-]{1,12}$/),
    fc.integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2030, 0, 1) }),
    fc.option(fc.dictionary(fc.stringMatching(/^[a-z]{1,6}\.ts$/), fc.string({ maxLength: 30 }), { maxKeys: 4 }), { nil: null }),
  )
  .map(([name, time, sourceText]) => ({
    savedVersion: 1 as const,
    label: `local:${name}`,
    savedAt: new Date(time).toISOString(),
    investigation: { ...baseInvestigation(), sourceLabel: `local:${name}` },
    sourceText,
  }));
