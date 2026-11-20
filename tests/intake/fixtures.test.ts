import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import { validateInvestigation } from "../../src/contracts/validate";
import { folderOf, listingBody, listingOf, arbListing, arbRecord, arbTree, arbUrl } from "./generators";
import { entryBytes, filesOfManifest, readManifest, writeManifest } from "./materialize";

const temporary: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "hauntmap-intake-"));
  temporary.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function walk(dir: string, prefix = ""): { path: string; size: number }[] {
  const out: { path: string; size: number }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(join(dir, entry.name), path));
    else out.push({ path, size: statSync(join(dir, entry.name)).size });
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

describe("folder fixture", () => {
  it("writes the ten listed files with the listed sizes into a folder named sample-local", () => {
    const folder = writeManifest(readManifest("folder"), tempDir());
    expect(basename(folder)).toBe("sample-local");
    expect(walk(folder)).toEqual([
      { path: ".env", size: 6 },
      { path: "README.md", size: 10 },
      { path: "big.ts", size: 1_048_577 },
      { path: "bin.ts", size: 14 },
      { path: "dist/out.js", size: 11 },
      { path: "node_modules/pkg/index.js", size: 20 },
      { path: "secret.pem", size: 16 },
      { path: "src/a.ts", size: 70 },
      { path: "src/b.ts", size: 20 },
      { path: "src/c.tsx", size: 29 },
    ]);
  });

  it("keeps the content the spec lists: sentinel line, NUL bytes in bin.ts, slashes in big.ts", () => {
    const folder = writeManifest(readManifest("folder"), tempDir());
    expect(readFileSync(join(folder, "src/a.ts"), "utf8")).toBe('import { b } from "./b";\nexport const a = b; // SENTINEL-LOCAL-4e2b17\n');
    expect([...readFileSync(join(folder, "bin.ts")).subarray(0, 4)]).toEqual([0, 1, 2, 0x65]);
    const big = readFileSync(join(folder, "big.ts"));
    expect(big.every((byte) => byte === 0x2f)).toBe(true);
  });

  it("the four sizes that are included add up to 133 bytes", () => {
    const sizes = new Map(readManifest("folder").files.map((entry) => [entry.path, entryBytes(entry).byteLength]));
    expect(["bin.ts", "src/a.ts", "src/b.ts", "src/c.tsx"].reduce((sum, path) => sum + (sizes.get(path) ?? 0), 0)).toBe(133);
  });

  it("the second manifest holds the page, the postinstall script and src/a.ts", () => {
    const manifest = readManifest("folder-exec");
    expect(manifest.files.map((entry) => entry.path)).toEqual(["index.html", "postinstall.js", "src/a.ts"]);
    expect(readFileSync(new URL("./fixtures/folder-exec/manifest.json", import.meta.url), "utf8")).toContain("document.cookie");
  });

  it("builds File objects whose webkitRelativePath starts with the folder name", () => {
    const files = filesOfManifest(readManifest("folder"));
    expect(files).toHaveLength(10);
    const a = files.find((file) => file.name === "a.ts");
    expect(a?.webkitRelativePath).toBe("sample-local/src/a.ts");
    expect(a?.size).toBe(70);
    const descriptor = Object.getOwnPropertyDescriptor(a, "webkitRelativePath");
    expect(descriptor?.value).toBe("sample-local/src/a.ts");
    expect(filesOfManifest(readManifest("folder"), "other")[0]?.webkitRelativePath.startsWith("other/")).toBe(true);
  });
});

describe("generated folders and listings", () => {
  it("folderOf makes src/m<i>.ts files that import the next one", () => {
    const manifest = folderOf(3);
    expect(manifest.files.map((entry) => entry.path)).toEqual(["src/m0.ts", "src/m1.ts", "src/m2.ts"]);
    expect(manifest.files[0]?.text).toContain('from "./m1"');
    expect(manifest.files[2]?.text).not.toContain("import");
  });

  it("folderOf pads every file to the requested size", () => {
    const manifest = folderOf(200, { bytesEach: 10_240 });
    expect(manifest.files).toHaveLength(200);
    expect(manifest.files.every((entry) => entryBytes(entry).byteLength === 10_240)).toBe(true);
    expect(folderOf(1001).files).toHaveLength(1001);
  });

  it("listingOf(401) sorted in code unit order has src/m99.ts at index 400", () => {
    const paths = listingOf(401).map((entry) => entry.path.replace(/^\//, ""));
    expect(paths).toHaveLength(401);
    expect([...paths].sort()[400]).toBe("src/m99.ts");
    expect(listingOf(2).map((entry) => entry.path)).toEqual(["/src/m0.ts", "/src/m1.ts"]);
    expect(listingOf(1)[0]?.size).toBe(20);
    expect(listingBody("/src/m7.ts")).toBe("export const m7 = 7;\n");
  });

  it("arbitraries produce values of the stated shape", () => {
    for (const tree of fc.sample(arbTree, { numRuns: 30, seed: 7 })) {
      expect(tree.length).toBeGreaterThanOrEqual(1);
      expect(tree.length).toBeLessThanOrEqual(80);
      const lower = tree.map((candidate) => candidate.path.toLowerCase());
      expect(new Set(lower).size).toBe(lower.length);
      for (const candidate of tree) {
        expect(candidate.size).toBeGreaterThanOrEqual(0);
        expect(candidate.size).toBeLessThanOrEqual(2_000_000);
        expect(candidate.path.startsWith("/")).toBe(false);
      }
    }
    expect(fc.sample(arbListing, { numRuns: 20, seed: 7 }).every((listing) => listing.length <= 450)).toBe(true);
    expect(fc.sample(arbUrl, { numRuns: 20, seed: 7 }).every((url) => typeof url === "string")).toBe(true);
    const record = fc.sample(arbRecord, { numRuns: 3, seed: 7 })[0];
    expect(record?.savedVersion).toBe(1);
    expect(record !== undefined && validateInvestigation(record.investigation).ok).toBe(true);
  });
});

describe("graph fixtures", () => {
  it("malformed.json is JSON that does not validate", () => {
    const value: unknown = JSON.parse(readFileSync(new URL("./fixtures/graph/malformed.json", import.meta.url), "utf8"));
    expect(value).toEqual({ schemaVersion: 2 });
    expect(validateInvestigation(value).ok).toBe(false);
  });

  it("not-json.txt does not parse", () => {
    const text = readFileSync(new URL("./fixtures/graph/not-json.txt", import.meta.url), "utf8");
    expect(() => JSON.parse(text)).toThrow(SyntaxError);
  });

  it("public/demo/live.json validates and is only read", () => {
    const value: unknown = JSON.parse(readFileSync(new URL("../../public/demo/live.json", import.meta.url), "utf8"));
    expect(validateInvestigation(value).ok).toBe(true);
  });
});
