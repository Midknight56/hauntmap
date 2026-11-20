import { mkdirSync, mkdtempSync, realpathSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DEFAULT_ANALYSIS_OPTIONS } from "../../src/contracts/options";
import { classify } from "../../src/features/import/review";
import { loadSourceSet, resolveRoot } from "../../packages/hauntmap-mcp/src/loader";
import { arbTree } from "./generators";
import type { TreeEntry } from "./generators";

// Properties of .kiro/specs/intake/design.md. 200 runs and a fixed seed; fast-check prints the seed on failure.
const RUNS = { numRuns: 200, seed: 20_261_119 };
const options = DEFAULT_ANALYSIS_OPTIONS;
const MAX = Number.MAX_SAFE_INTEGER;
const ALL_OPTIONS = { ...options, maxFiles: MAX, maxTotalBytes: MAX };

// The expected reason, written here from the rules and not taken from the code under test.
function expectedReason(path: string, size: number): "excluded-dir" | "secret-pattern" | "extension" | "oversized" | null {
  const parts = path.split("/");
  const name = parts[parts.length - 1] ?? "";
  if (parts.slice(0, -1).some((part) => ["node_modules", ".git", "dist", "build", "out", ".next", "coverage"].includes(part))) return "excluded-dir";
  if (name === ".env" || name.startsWith(".env.") || name.endsWith(".pem") || name.endsWith(".key") || name.startsWith("id_rsa")) return "secret-pattern";
  const dot = name.lastIndexOf(".");
  const extension = dot <= 0 ? "" : name.slice(dot);
  if (![".js", ".jsx", ".ts", ".tsx", ".mjs", ".mts"].includes(extension)) return "extension";
  if (size > 1_048_576) return "oversized";
  return null;
}

function firstExcludedDirectory(path: string): string {
  const parts = path.split("/").slice(0, -1);
  const index = parts.findIndex((part) => ["node_modules", ".git", "dist", "build", "out", ".next", "coverage"].includes(part));
  return `${parts.slice(0, index + 1).join("/")}/`;
}

describe("P1 classification partition (2.3)", () => {
  it("every candidate is included or covered by exactly one skipped entry, and the included ones pass the four conditions", () => {
    fc.assert(
      fc.property(arbTree, (tree: TreeEntry[]) => {
        const review = classify("root", tree.map((entry) => ({ path: entry.path, size: entry.size })), options);
        const included = new Set(review.included.map((candidate) => candidate.path));
        const skipped = new Map<string, string>();
        for (const entry of review.skipped) {
          expect(skipped.has(entry.path)).toBe(false);
          skipped.set(entry.path, entry.reason);
        }
        const coverage = new Map<string, number>();
        for (const entry of tree) {
          const reason = expectedReason(entry.path, entry.size);
          if (reason === null) {
            expect(included.has(entry.path)).toBe(true);
            expect(skipped.has(entry.path)).toBe(false);
          } else if (reason === "excluded-dir") {
            const dir = firstExcludedDirectory(entry.path);
            expect(included.has(entry.path)).toBe(false);
            expect(skipped.get(dir)).toBe("excluded-dir");
            expect(skipped.has(entry.path)).toBe(false);
            coverage.set(dir, (coverage.get(dir) ?? 0) + 1);
          } else {
            expect(included.has(entry.path)).toBe(false);
            expect(skipped.get(entry.path)).toBe(reason);
          }
        }
        // No phantom entries: every skipped entry covers a candidate, and counts add up.
        expect(review.included.length + [...skipped.keys()].filter((path) => !path.endsWith("/")).length + [...coverage.values()].reduce((a, b) => a + b, 0)).toBe(tree.length);
        for (const [path, reason] of skipped) if (reason === "excluded-dir") expect(coverage.has(path)).toBe(true);
        expect(review.includedBytes).toBe(review.included.reduce((sum, candidate) => sum + candidate.size, 0));
        expect(review.included.map((c) => c.path)).toEqual([...review.included.map((c) => c.path)].sort());
        expect(review.skipped.map((s) => s.path)).toEqual([...review.skipped.map((s) => s.path)].sort());
      }),
      RUNS,
    );
  });
});

describe("P2 loader parity (2.3, I2)", () => {
  it("classify and loadSourceSet agree on included paths and skip reasons for the same folder", async () => {
    await fc.assert(
      fc.asyncProperty(arbTree, async (tree: TreeEntry[]) => {
        const parent = mkdtempSync(join(tmpdir(), "hauntmap-p2-"));
        try {
          const root = join(parent, "tree");
          mkdirSync(root);
          for (const entry of tree) {
            const target = join(root, ...entry.path.split("/"));
            mkdirSync(dirname(target), { recursive: true });
            // Slashes are text without a NUL, so the loader never marks a file binary. A file over 1 MiB is never read.
            if (entry.size <= 1_048_576) writeFileSync(target, Buffer.alloc(entry.size, 0x2f));
            else {
              writeFileSync(target, "");
              truncateSync(target, entry.size);
            }
          }
          const real = realpathSync(root);
          const resolved = await resolveRoot(real, ".");
          if (!resolved.ok) throw new Error(resolved.error.message);
          const loaded = await loadSourceSet(resolved.root, ALL_OPTIONS);
          if (!loaded.ok) throw new Error(loaded.error.message);
          const review = classify("tree", tree.map((entry) => ({ path: entry.path, size: entry.size })), options);
          expect(review.included.map((candidate) => candidate.path)).toEqual(loaded.sourceSet.files.map((file) => file.path));
          expect(review.skipped).toEqual(loaded.sourceSet.skipped.filter((entry) => entry.reason !== "binary"));
        } finally {
          rmSync(parent, { recursive: true, force: true });
        }
      }),
      RUNS,
    );
  });
});
