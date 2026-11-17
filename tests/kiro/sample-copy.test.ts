import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { resetSample, runReset } from "../../scripts/demo-reset";
import { listIncluded, treesEqual } from "../../scripts/sampleTree";

// Requirement 1.4 and 1.5. haunts/manor is a byte-identical copy of the included files of
// public/demo/manor/before, and pnpm demo:reset restores it.

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURE = join(REPO, "public", "demo", "manor", "before");
const SAMPLE = join(REPO, "haunts", "manor");

const temporary: string[] = [];
function makeTemp(): string {
  const dir = mkdtempSync(join(tmpdir(), "hauntmap-sample-"));
  temporary.push(dir);
  return dir;
}
function write(root: string, path: string, text: string): void {
  const target = join(root, ...path.split("/"));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text, "utf8");
}
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("listIncluded and treesEqual", () => {
  it("lists only the six included extensions, sorted, with forward slashes", () => {
    const root = makeTemp();
    write(root, "b.ts", "1");
    write(root, "a/z.mjs", "1");
    write(root, "a/y.json", "{}");
    write(root, "expected.json", "{}");
    write(root, "c.mts", "1");
    write(root, "README.md", "x");
    expect(listIncluded(root)).toEqual(["a/z.mjs", "b.ts", "c.mts"]);
  });

  it("treats a missing folder as empty", () => {
    expect(listIncluded(join(makeTemp(), "absent"))).toEqual([]);
  });

  it("is true for identical trees and ignores files with other extensions", () => {
    const a = makeTemp();
    const b = makeTemp();
    write(a, "src/x.ts", "export const x = 1;\n");
    write(b, "src/x.ts", "export const x = 1;\n");
    write(a, "expected.json", "{}");
    expect(treesEqual(a, b)).toBe(true);
  });

  it("is false when one byte differs, when a file is missing and when a file is extra", () => {
    const a = makeTemp();
    const b = makeTemp();
    write(a, "src/x.ts", "export const x = 1;\n");
    write(b, "src/x.ts", "export const x = 2;\n");
    expect(treesEqual(a, b)).toBe(false);
    write(b, "src/x.ts", "export const x = 1;\n");
    write(b, "src/y.ts", "");
    expect(treesEqual(a, b)).toBe(false);
    expect(treesEqual(b, a)).toBe(false);
  });

  it("is false when the first folder does not exist and the second has files", () => {
    const b = makeTemp();
    write(b, "x.ts", "");
    expect(treesEqual(join(makeTemp(), "absent"), b)).toBe(false);
  });
});

describe("haunts/manor (requirement 1.4)", () => {
  it("holds 40 included files, each byte-identical to public/demo/manor/before, and no other file", () => {
    const fixtureFiles = listIncluded(FIXTURE);
    expect(fixtureFiles).toHaveLength(40);
    expect(listIncluded(SAMPLE)).toEqual(fixtureFiles);
    for (const path of fixtureFiles) {
      const a = readFileSync(join(SAMPLE, ...path.split("/")));
      const b = readFileSync(join(FIXTURE, ...path.split("/")));
      expect(a.equals(b), path).toBe(true);
    }
    expect(treesEqual(SAMPLE, FIXTURE)).toBe(true);
  });
});

describe("demo:reset (requirement 1.5)", () => {
  function fakeRepo(): string {
    const repo = makeTemp();
    write(repo, "public/demo/manor/before/src/a.ts", 'import { b } from "./b";\nexport const a = b;\n');
    write(repo, "public/demo/manor/before/src/b.ts", "export const b = 1;\n");
    write(repo, "public/demo/manor/before/expected.json", "{}");
    write(repo, "public/demo/manor/before/sources.json", "{}");
    return repo;
  }

  it("restores a modified copy, copies only included files and returns the file count", () => {
    const repo = fakeRepo();
    write(repo, "haunts/manor/src/a.ts", "changed\n");
    write(repo, "haunts/manor/src/stale.ts", "stale\n");
    expect(resetSample(repo)).toBe(2);
    const copy = join(repo, "haunts", "manor");
    expect(listIncluded(copy)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(treesEqual(copy, join(repo, "public", "demo", "manor", "before"))).toBe(true);
    expect(() => readFileSync(join(copy, "expected.json"))).toThrow();
    expect(() => readFileSync(join(copy, "sources.json"))).toThrow();
  });

  it("creates the copy when haunts/manor is absent, and a second run gives the same tree", () => {
    const repo = fakeRepo();
    expect(resetSample(repo)).toBe(2);
    expect(resetSample(repo)).toBe(2);
    expect(listIncluded(join(repo, "haunts", "manor"))).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("prints the exact line and returns 0", () => {
    const repo = fakeRepo();
    const out: string[] = [];
    const err: string[] = [];
    expect(runReset(repo, (s) => out.push(s), (s) => err.push(s))).toBe(0);
    expect(out).toEqual(["demo:reset: haunts/manor restored from public/demo/manor/before (2 files)\n"]);
    expect(err).toEqual([]);
  });

  it("prints demo:reset: <message> to stderr and returns 1 when the fixture is missing", () => {
    const repo = makeTemp();
    const out: string[] = [];
    const err: string[] = [];
    expect(runReset(repo, (s) => out.push(s), (s) => err.push(s))).toBe(1);
    expect(out).toEqual([]);
    expect(err).toHaveLength(1);
    expect(err[0]).toMatch(/^demo:reset: .+\n$/);
  });
});
