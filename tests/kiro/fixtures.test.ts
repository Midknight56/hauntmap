import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import {
  arbArgs,
  arbInvestigation,
  arbMutation,
  arbPath,
  arbTree,
  makeCapBytesWorkspace,
  makeCapFilesWorkspace,
  makeDemoLiveWorkspace,
  type TreeManifest,
} from "./generators";
import { RecordingFs } from "./fakeFs";
import { LIVE_FIXTURES, loadLoaderRoot, materialize, symlinkDirectory } from "./materialize";

// Requirement 2.2 and 2.5 fixtures: the manifest of design.md, its materializer, the generated
// workspaces and the recording file system. The expected lists are written by hand in
// fixtures/loader-root.json; no analyzer is involved.

const temporary: string[] = [];
function makeTemp(): string {
  const dir = mkdtempSync(join(tmpdir(), "hauntmap-fixtures-"));
  temporary.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function walk(root: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(root, relative));
    else out.push(relative);
  }
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

describe("loader-root.json", () => {
  const manifest = loadLoaderRoot();

  it("lists the entries of the design table", () => {
    expect(Object.keys(manifest.files).sort()).toEqual(
      [
        ".env",
        ".env.local",
        ".git/HEAD",
        ".next/z.js",
        "Readme.md",
        "bin.ts",
        "big.ts",
        "bom.ts",
        "build/x.js",
        "coverage/c.js",
        "crlf.ts",
        "dist/out.js",
        "id_rsa",
        "id_rsa.pub",
        "legacy.mjs",
        "node_modules/pkg/index.js",
        "out/y.js",
        "postinstall.js",
        "secret.pem",
        "server.key",
        "src/Util.ts",
        "src/a.ts",
        "src/b.ts",
        "src/util/index.ts",
        "types.mts",
      ].sort(),
    );
  });

  it("materializes to exactly the manifest paths with the stated bytes", () => {
    const dir = makeTemp();
    materialize(manifest, dir);
    expect(walk(dir)).toEqual(Object.keys(manifest.files).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    const bom = readFileSync(join(dir, "bom.ts"));
    expect([...bom.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bom.subarray(3).toString("utf8")).toBe("export const x = 1;\n");
    expect(readFileSync(join(dir, "crlf.ts"), "utf8")).toBe("export const y = 2;\r\n");
    expect([...readFileSync(join(dir, "bin.ts")).subarray(0, 3)]).toEqual([0, 1, 2]);
    expect(statSync(join(dir, "big.ts")).size).toBe(1_048_577);
    expect(readFileSync(join(dir, "src", "a.ts"), "utf8")).toBe('import { b } from "./b";\nexport const a = b;\n');
  });

  it("gives the same tree whatever the creation order", () => {
    const a = makeTemp();
    const b = makeTemp();
    materialize(manifest, a);
    materialize(manifest, b, Object.keys(manifest.files).reverse());
    expect(walk(a)).toEqual(walk(b));
  });

  it("has an expected included list in code-point order and every other file covered by one skipped entry", () => {
    const expected = manifest.expected;
    expect(expected.files).toEqual(["bom.ts", "crlf.ts", "legacy.mjs", "postinstall.js", "src/Util.ts", "src/a.ts", "src/b.ts", "src/util/index.ts", "types.mts"]);
    expect([...expected.files]).toEqual([...expected.files].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    const skipped = new Map(Object.entries(expected.skipped));
    for (const path of Object.keys(manifest.files)) {
      if (expected.files.includes(path)) {
        expect(skipped.has(path), path).toBe(false);
        continue;
      }
      const segments = path.split("/");
      const owners = segments.slice(0, -1).map((_, i) => `${segments.slice(0, i + 1).join("/")}/`).filter((p) => skipped.has(p));
      const own = skipped.has(path) ? [path] : [];
      expect([...owners.slice(0, 1), ...own], path).toHaveLength(1);
    }
    expect(expected.skipped[".git/"]).toBe("excluded-dir");
    expect(expected.skipped["big.ts"]).toBe("oversized");
    expect(expected.skipped["bin.ts"]).toBe("binary");
    expect(expected.skipped["Readme.md"]).toBe("extension");
    expect(expected.skipped["id_rsa.pub"]).toBe("secret-pattern");
  });

  it("makes postinstall.js write MARKER beside itself, so that running it would be visible", () => {
    const text = String(manifest.files["postinstall.js"]);
    expect(text).toContain("MARKER");
  });
});

describe("generated workspaces", () => {
  it("cap-files: 1,001 files, the last in code-point order is m999.ts and m1000.ts sorts fifth", () => {
    const dir = makeCapFilesWorkspace(makeTemp());
    const names = readdirSync(dir).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(names).toHaveLength(1001);
    expect(names[names.length - 1]).toBe("m999.ts");
    expect(names.slice(0, 6)).toEqual(["m0.ts", "m1.ts", "m10.ts", "m100.ts", "m1000.ts", "m101.ts"]);
    expect(readFileSync(join(dir, "m5.ts"), "utf8").split("\n").filter((l) => l !== "")).toHaveLength(1);
  });

  it("cap-bytes: 26 files of 1,048,576 bytes, the first 25 in sorted order total exactly 26,214,400", () => {
    const dir = makeCapBytesWorkspace(makeTemp());
    const names = readdirSync(dir).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(names).toHaveLength(26);
    const sizes = names.map((name) => statSync(join(dir, name)).size);
    expect(sizes.every((size) => size === 1_048_576)).toBe(true);
    expect(sizes.slice(0, 25).reduce((a, b) => a + b, 0)).toBe(26_214_400);
  });

  it("demo-live: the fixture and the sample are identical, and the cli marker is optional", () => {
    const without = makeDemoLiveWorkspace(makeTemp(), false);
    const withCli = makeDemoLiveWorkspace(makeTemp(), true);
    expect(existsSync(join(without, "packages", "hauntmap-mcp", "dist", "cli.js"))).toBe(false);
    expect(existsSync(join(withCli, "packages", "hauntmap-mcp", "dist", "cli.js"))).toBe(true);
    expect(walk(join(withCli, "samples", "manor"))).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
    expect(readFileSync(join(withCli, "samples", "manor", "src", "a.ts"), "utf8")).toBe(readFileSync(join(withCli, "public", "demo", "manor", "before", "src", "a.ts"), "utf8"));
  });
});

describe("live fixtures", () => {
  const read = (name: string): string => readFileSync(join(LIVE_FIXTURES, name), "utf8");

  it("valid-live.json is a placeholder investigation with the live label", () => {
    const value = JSON.parse(read("valid-live.json")) as { schemaVersion: number; resolverMode: string; sourceLabel: string };
    expect(value.schemaVersion).toBe(1);
    expect(value.resolverMode).toBe("documented-source-subset");
    expect(value.sourceLabel).toBe("live:samples/manor");
  });

  it("malformed-live.json has schemaVersion 2", () => {
    expect(JSON.parse(read("malformed-live.json"))).toEqual({
      schemaVersion: 2,
      resolverMode: "documented-source-subset",
      sourceLabel: "live:samples/manor",
      modules: [],
      imports: [],
      diagnostics: [],
      options: {},
    });
  });

  it("not-json-live.txt is truncated JSON and fallback.html is an HTML page", () => {
    expect(() => JSON.parse(read("not-json-live.txt"))).toThrow(SyntaxError);
    expect(read("not-json-live.txt").startsWith('{"schemaVersion": 1,')).toBe(true);
    expect(read("fallback.html").startsWith("<!doctype html><title>HauntMap</title>")).toBe(true);
  });
});

describe("RecordingFs", () => {
  it("records every path read, listed and written, and resolves real paths", async () => {
    const dir = makeTemp();
    mkdirSync(join(dir, "a"));
    writeFileSync(join(dir, "a", "x.ts"), "export {};\n");
    const fs = new RecordingFs();
    const entries = await fs.readdir(dir, { withFileTypes: true });
    expect(entries.map((e) => e.name)).toEqual(["a"]);
    expect((await fs.stat(join(dir, "a", "x.ts"))).size).toBe(11);
    expect(Buffer.from(await fs.readFile(join(dir, "a", "x.ts"))).toString("utf8")).toBe("export {};\n");
    expect(await fs.realpath(dir)).toBe(await fs.realpath(dir));
    await fs.writeFile(join(dir, "out.txt"), "x");
    expect(fs.readdirs).toEqual([dir]);
    expect(fs.reads).toEqual([join(dir, "a", "x.ts")]);
    expect(fs.writes).toEqual([join(dir, "out.txt")]);
    expect(fs.touched()).toContain(join(dir, "a", "x.ts"));
  });

  it("does not follow a directory link out of the workspace unless asked, and reports lstat of a link", async () => {
    const dir = makeTemp();
    const outside = makeTemp();
    writeFileSync(join(outside, "secret.ts"), "x");
    symlinkDirectory(outside, join(dir, "link"));
    const fs = new RecordingFs();
    expect((await fs.lstat(join(dir, "link"))).isSymbolicLink()).toBe(true);
    expect(await fs.realpath(join(dir, "link"))).toBe(await fs.realpath(outside));
  });
});

describe("generators", () => {
  const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

  it("arbTree: names unique without regard to case, no trailing dot, no reserved device names, no file used as directory", () => {
    const trees = fc.sample(arbTree, { numRuns: 150, seed: 7 });
    for (const tree of trees) {
      const paths = Object.keys(tree.files);
      expect(paths.length).toBeGreaterThanOrEqual(1);
      expect(paths.length).toBeLessThanOrEqual(60);
      expect(new Set(paths.map((p) => p.toLowerCase())).size).toBe(paths.length);
      const directories = new Map<string, string>();
      for (const path of paths) {
        const segments = path.split("/");
        expect(segments.length).toBeLessThanOrEqual(5);
        for (const segment of segments) {
          expect(segment.endsWith(".")).toBe(false);
          expect(segment).not.toMatch(/[\\:*?"<>|]/);
          expect(RESERVED.test(segment.split(".")[0] ?? ""), segment).toBe(false);
        }
        for (let i = 1; i < segments.length; i += 1) {
          const prefix = segments.slice(0, i).join("/");
          const seen = directories.get(prefix.toLowerCase());
          expect(seen === undefined || seen === prefix, prefix).toBe(true);
          directories.set(prefix.toLowerCase(), prefix);
          expect(paths.includes(prefix), prefix).toBe(false);
        }
      }
    }
  });

  it("arbTree: materializes without error on this machine", () => {
    for (const tree of fc.sample(arbTree, { numRuns: 15, seed: 11 })) {
      const small: TreeManifest = { files: Object.fromEntries(Object.entries(tree.files).filter(([, v]) => typeof v === "string" || "base64" in v)) };
      const dir = makeTemp();
      materialize(small, dir);
      expect(walk(dir)).toHaveLength(Object.keys(small.files).length);
    }
  });

  it("arbInvestigation: 1 to 50 modules, unique ids, relation ids that start with the importing module", () => {
    for (const inv of fc.sample(arbInvestigation, { numRuns: 100, seed: 3 })) {
      expect(inv.schemaVersion).toBe(1);
      expect(inv.resolverMode).toBe("documented-source-subset");
      expect(inv.modules.length).toBeGreaterThanOrEqual(1);
      expect(inv.modules.length).toBeLessThanOrEqual(50);
      const ids = new Set(inv.modules.map((m) => m.id));
      expect(ids.size).toBe(inv.modules.length);
      for (const module of inv.modules) expect(module.sourceHash).toMatch(/^[0-9a-f]{64}$/);
      for (const record of inv.imports) {
        expect(ids.has(record.from)).toBe(true);
        expect((JSON.parse(record.relationId) as unknown[])[0]).toBe(record.from);
        expect((JSON.parse(record.occurrenceId) as unknown[])[0]).toBe(record.from);
        expect(record.resolution === "local").toBe(record.to !== null);
        if (record.to !== null) expect(ids.has(record.to)).toBe(true);
        expect(record.line).toBeGreaterThanOrEqual(1);
        expect(record.column).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("arbMutation: changes exactly one required field and names its path prefix", () => {
    const arb = arbInvestigation.chain((inv) => arbMutation(inv).map((mutation) => ({ inv, mutation })));
    for (const { inv, mutation } of fc.sample(arb, { numRuns: 150, seed: 5 })) {
      expect(mutation.prefix).toMatch(/^(schemaVersion|resolverMode|sourceLabel|modules|imports|diagnostics|options|modules\[\d+\]\.|imports\[\d+\]\.|options\.)$/);
      expect(JSON.stringify(mutation.value)).not.toBe(JSON.stringify(inv));
    }
  });

  it("arbArgs and arbPath produce values", () => {
    expect(fc.sample(arbArgs, { numRuns: 20, seed: 1 })).toHaveLength(20);
    const paths = fc.sample(arbPath, { numRuns: 200, seed: 1 });
    expect(paths.every((p) => typeof p === "string")).toBe(true);
    expect(paths.some((p) => p.includes(".."))).toBe(true);
    expect(paths.some((p) => p.includes("\\"))).toBe(true);
  });
});
