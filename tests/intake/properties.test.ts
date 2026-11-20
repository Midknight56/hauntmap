import { mkdirSync, mkdtempSync, realpathSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DEFAULT_ANALYSIS_OPTIONS } from "../../src/contracts/options";
import { runGithubIntake } from "../../src/features/github/githubIntake";
import { fetchFiles, fileUrl, listingUrl, resolveUrl } from "../../src/features/github/jsdelivr";
import { parseGithubUrl } from "../../src/features/github/url";
import * as githubText from "../../src/features/github/messages";
import { SUBFOLDER_REJECTED, URL_FORMAT } from "../../src/features/github/messages";
import { tooManyFiles } from "../../src/features/import/messages";
import { capMessage, classify } from "../../src/features/import/review";
import { createMemorySavedStore } from "../../src/features/import/saved";
import { loadSourceSet, resolveRoot } from "../../packages/hauntmap-mcp/src/loader";
import { createFakeFetch } from "./fakes";
import { arbListing, arbRecord, arbTree, arbUrl, listingOf } from "./generators";
import type { TreeEntry } from "./generators";
import { githubDeps, instantAnalysisClient, recordingStore, recordingUi } from "./githubFakes";

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

describe("P8 saved round trip (5.2, 5.3)", () => {
  it("put then list returns equal records newest first, delete removes one, and the same label replaces", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(arbRecord, { minLength: 1, maxLength: 6 }), async (records) => {
        const store = createMemorySavedStore();
        for (const record of records) await store.put(record);
        const latest = new Map(records.map((record) => [record.label, record]));
        const listed = await store.list();
        expect(listed).toHaveLength(latest.size);
        for (const record of listed) expect(record).toEqual(latest.get(record.label));
        const times = listed.map((record) => record.savedAt);
        expect(times).toEqual([...times].sort().reverse());
        const first = listed[0];
        if (first === undefined) return;
        await store.delete(first.label);
        expect((await store.list()).some((record) => record.label === first.label)).toBe(false);
        const replacement = { ...first, savedAt: "2031-01-01T00:00:00.000Z", sourceText: null };
        await store.put(first);
        await store.put(replacement);
        const again = (await store.list()).filter((record) => record.label === first.label);
        expect(again).toEqual([replacement]);
      }),
      RUNS,
    );
  });
});

describe("P3 URL parse (7.2)", () => {
  // The grammar, written here as one pattern and not taken from the code under test.
  const PART = "[A-Za-z0-9_.-]+";
  const GRAMMAR = new RegExp(`^https://github\\.com/(${PART})/(${PART})(?:/tree/(${PART}))?/?$`);
  const dotsOnly = (part: string) => /^\.+$/.test(part);
  function expected(input: string): { owner: string; repo: string; ref: string | null } | null {
    const match = GRAMMAR.exec(input.trim());
    if (match === null) return null;
    const owner = match[1] ?? "";
    let repo = match[2] ?? "";
    const ref = match[3] ?? null;
    if (ref === null && repo.endsWith(".git")) repo = repo.slice(0, -4);
    if (repo === "" || dotsOnly(owner) || dotsOnly(repo) || (ref !== null && dotsOnly(ref))) return null;
    return { owner, repo, ref };
  }

  it("returns ok only for strings of the grammar, and one of the two messages otherwise", () => {
    fc.assert(
      fc.property(arbUrl, (input) => {
        const result = parseGithubUrl(input);
        const want = expected(input);
        if (want === null) {
          expect(result.ok).toBe(false);
          if (!result.ok) expect([SUBFOLDER_REJECTED, URL_FORMAT]).toContain(result.message);
        } else {
          expect(result).toEqual({ ok: true, ...want });
        }
      }),
      RUNS,
    );
  });

  it("a rebuilt address with and without /tree/<ref> parses to the same owner, repo and ref", () => {
    fc.assert(
      fc.property(arbUrl, (input) => {
        const result = parseGithubUrl(input);
        if (!result.ok) return;
        const base = `https://github.com/${result.owner}/${result.repo}`;
        expect(parseGithubUrl(result.ref === null ? base : `${base}/tree/${result.ref}`)).toEqual(result);
        expect(parseGithubUrl(`${base}/`)).toEqual({ ...result, ref: null });
      }),
      RUNS,
    );
  });

  it("a rejection that shows the ref field is always a subfolder message", () => {
    fc.assert(
      fc.property(arbUrl, (input) => {
        const result = parseGithubUrl(input);
        if (!result.ok && result.showRefField) expect(result.message).toBe(SUBFOLDER_REJECTED);
      }),
      RUNS,
    );
  });
});
describe("P4 bounded concurrency (8.1)", () => {
  it("never has more than 6 file requests pending, and requests each included path once", async () => {
    await fc.assert(
      fc.asyncProperty(arbListing, fc.array(fc.integer({ min: 0, max: 2 }), { minLength: 1, maxLength: 8 }), async (listing, delays) => {
        const review = classify("octo/cat@main", listing.map((entry) => ({ path: entry.path.slice(1), size: entry.size })), options);
        const included = review.included.slice(0, 60);
        let next = 0;
        const fake = createFakeFetch(() => ({ body: "export const x = 1;\n", delayMs: delays[next++ % delays.length] }));
        const result = await fetchFiles("octo", "cat", "main", included, fake.fetch, new AbortController().signal, () => undefined);
        expect(result.ok).toBe(true);
        expect(fake.maxPending).toBeLessThanOrEqual(6);
        expect(fake.pending).toBe(0);
        expect(fake.calls.map((call) => call.url)).toEqual(included.map((entry) => fileUrl("octo", "cat", "main", entry.path)));
      }),
      RUNS,
    );
  }, 120_000);
});

describe("P6 caps are errors (2.5, 7.5)", () => {
  it("a listing with more than 400 included files makes no file request and names the count and the 401st path", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 401, max: 420 }), fc.array(fc.constantFrom(".env", "a.md", "node_modules/x/i.js", "dist/o.js", "k.pem", "z.png"), { maxLength: 6 }), async (n, noise) => {
        const entries = [...listingOf(n).map((entry) => ({ name: entry.path, hash: "h", size: entry.size })), ...[...new Set(noise)].map((name) => ({ name: `/${name}`, hash: "h", size: 5 }))];
        const fake = createFakeFetch({ [listingUrl("octo", "cat", "main")]: { body: { files: entries } } });
        const store = recordingStore();
        const outcome = await runGithubIntake(githubDeps(store, instantAnalysisClient(), fake), "open", recordingUi("https://github.com/octo/cat/tree/main"));
        const first = listingOf(n).map((entry) => entry.path.slice(1)).sort()[400];
        expect(outcome).toEqual({ ok: false, reason: "failed", message: githubText.cap("octo", "cat", "main", n, first ?? "") });
        expect(fake.calls.map((call) => call.url)).toEqual([listingUrl("octo", "cat", "main")]);
        expect(store.calls).toEqual(["setStatus"]);
      }),
      RUNS,
    );
  });

  it("a folder with more than 1,000 included files is told the count before anything is read", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1001, max: 1040 }), (n) => {
        const review = classify("big", Array.from({ length: n }, (_, i) => ({ path: `src/m${i}.ts`, size: 10 })), options);
        expect(capMessage(review, 1000, options.maxTotalBytes, "local")).toBe(tooManyFiles(n));
      }),
      RUNS,
    );
  });

  it("the review's GitHub cap sentences equal the message file's", () => {
    const review = classify("octo/cat@main", listingOf(401).map((entry) => ({ path: entry.path.slice(1), size: entry.size })), options);
    expect(capMessage(review, 400, options.maxTotalBytes, "github")).toBe(githubText.cap("octo", "cat", "main", 401, "src/m99.ts"));
    const heavy = classify("octo/cat@main", Array.from({ length: 26 }, (_, i) => ({ path: `src/h${i}.ts`, size: 1_048_576 })), options);
    expect(capMessage(heavy, 400, options.maxTotalBytes, "github")).toBe(githubText.capBytes("octo", "cat", "main", "26.0 MiB"));
    expect(capMessage(classify("octo/cat@main", [{ path: "README.md", size: 3 }], options), 400, options.maxTotalBytes, "github")).toBe(githubText.noFilesGh("octo", "cat", "main"));
  });
});

describe("P7 request discipline (4.1, 8.8)", () => {
  it("the GitHub flow sends the resolve URL only without a ref, the listing URL and the file URLs of the included entries, nothing else", async () => {
    await fc.assert(
      fc.asyncProperty(fc.boolean(), arbListing, async (withRef, listing) => {
        const small = listing.slice(0, 40);
        const ref = withRef ? "main" : "v9.9.9";
        const review = classify(`octo/cat@${ref}`, small.map((entry) => ({ path: entry.path.slice(1), size: entry.size })), options);
        const capped = capMessage(review, 400, options.maxTotalBytes, "github") !== null;
        const fake = createFakeFetch((url) => {
          if (url === resolveUrl("octo", "cat")) return { body: { version: "v9.9.9" } };
          if (url === listingUrl("octo", "cat", ref)) return { body: { files: small.map((entry) => ({ name: entry.path, hash: "h", size: entry.size })) } };
          return url.startsWith("https://cdn.jsdelivr.net/") ? { body: "export const x = 1;\n" } : undefined;
        });
        await runGithubIntake(githubDeps(recordingStore(), instantAnalysisClient(), fake), "open", recordingUi(withRef ? "https://github.com/octo/cat/tree/main" : "https://github.com/octo/cat"));
        const wanted = [
          ...(withRef ? [] : [resolveUrl("octo", "cat")]),
          listingUrl("octo", "cat", ref),
          ...(capped ? [] : review.included.map((entry) => fileUrl("octo", "cat", ref, entry.path))),
        ];
        expect(fake.calls.map((call) => call.url)).toEqual(wanted);
        for (const call of fake.calls) {
          expect(call.credentials).toBe("omit");
          expect(call.headers).toEqual({});
          expect(call.method).toBe("GET");
        }
      }),
      RUNS,
    );
  }, 120_000);
});