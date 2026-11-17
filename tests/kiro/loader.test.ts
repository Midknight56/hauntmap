import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { analyze, DEFAULT_ANALYSIS_OPTIONS } from "../../src/analysis/index";
import { loadSourceSet, resolveRoot, sha256Hex, sourceLabelFor } from "../../packages/hauntmap-mcp/src/loader";
import { RecordingFs } from "./fakeFs";
import { makeCapBytesWorkspace, makeCapFilesWorkspace } from "./generators";
import { loadLoaderRoot, materialize, symlinkDirectory } from "./materialize";
import { REPO, webCryptoHash } from "./appPath";

// Requirements 2.1 to 2.8: the Node source loader.

const temporary: string[] = [];
/** A temp directory whose path is a realpath, as the workspace root of a ToolContext is. */
function makeWorkspace(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "hauntmap-loader-")));
  temporary.push(dir);
  return dir;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const code = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

async function load(workspace: string, root: string, fs?: RecordingFs) {
  const resolved = await resolveRoot(workspace, root, fs);
  if (!resolved.ok) throw new Error(`resolveRoot failed: ${resolved.error.message}`);
  return loadSourceSet(resolved.root, DEFAULT_ANALYSIS_OPTIONS, fs);
}

describe("2.8 sourceLabelFor", () => {
  it.each([
    ["haunts/manor", "live:haunts/manor"],
    ["./haunts/manor/", "live:haunts/manor"],
    ["haunts\\manor", "live:haunts/manor"],
    ["./public/demo/manor/before/", "live:public/demo/manor/before"],
    [".", "live:."],
  ])("%s -> %s", (given, label) => {
    expect(sourceLabelFor(given)).toBe(label);
  });
});

describe("2.1 options come from the analysis, not from the loader", () => {
  it("the investigation's options deep-equal { ...DEFAULT_ANALYSIS_OPTIONS, preset }", async () => {
    const workspace = makeWorkspace();
    mkdirSync(join(workspace, "root"));
    materialize(loadLoaderRoot(), join(workspace, "root"));
    const loaded = await load(workspace, "root");
    if (!loaded.ok) throw new Error(loaded.error.message);
    for (const preset of ["static-value", "type-inclusive", "dynamic-inclusive"] as const) {
      const investigation = await analyze(loaded.sourceSet, { ...DEFAULT_ANALYSIS_OPTIONS, preset }, sha256Hex, undefined, loaded.diagnostics);
      expect(investigation.options).toEqual({ ...DEFAULT_ANALYSIS_OPTIONS, preset });
    }
  });

  it("loader.ts repeats no option value (extensions, excluded names, limits)", () => {
    const source = readFileSync(join(REPO, "packages", "hauntmap-mcp", "src", "loader.ts"), "utf8");
    for (const literal of ["node_modules", ".next", "coverage", "id_rsa", "1048576", "26214400", '".mjs"', '".mts"']) {
      expect(source, literal).not.toContain(literal);
    }
  });
});

describe("2.2 the loader-root fixture", () => {
  it("returns the included files in code-point order and the skipped reasons of the manifest", async () => {
    const workspace = makeWorkspace();
    mkdirSync(join(workspace, "root"));
    const manifest = loadLoaderRoot();
    materialize(manifest, join(workspace, "root"));
    const loaded = await load(workspace, "root");
    if (!loaded.ok) throw new Error(loaded.error.message);
    expect(loaded.sourceSet.rootLabel).toBe("live:root");
    expect(loaded.sourceSet.files.map((f) => f.path)).toEqual(manifest.expected.files);
    expect(Object.fromEntries(loaded.sourceSet.skipped.map((s) => [s.path, s.reason]))).toEqual(manifest.expected.skipped);
    expect(loaded.sourceSet.skipped.map((s) => s.path)).toEqual([...loaded.sourceSet.skipped.map((s) => s.path)].sort(code));
    expect(loaded.diagnostics.some((d) => d.code === "oversized" && d.module === "big.ts")).toBe(true);
    for (const file of loaded.sourceSet.files) expect(file.bytes, file.path).toBe(Buffer.byteLength(file.text, "utf8") + (file.path === "bom.ts" ? 3 : 0));
  });

  it("does not list an excluded directory and reads only what may be included", async () => {
    const workspace = makeWorkspace();
    mkdirSync(join(workspace, "root"));
    materialize(loadLoaderRoot(), join(workspace, "root"));
    const fs = new RecordingFs();
    const loaded = await load(workspace, "root", fs);
    expect(loaded.ok).toBe(true);
    const root = join(workspace, "root");
    for (const excluded of ["node_modules", ".git", "dist", "build", "out", ".next", "coverage"]) {
      expect(fs.touched().filter((p) => p.startsWith(join(root, excluded))), excluded).toEqual([]);
    }
    const read = fs.reads.map((p) => p.slice(root.length + 1).replace(/\\/g, "/"));
    expect(read).toContain("src/a.ts");
    expect(read).toContain("bin.ts");
    for (const notRead of ["big.ts", ".env", ".env.local", "secret.pem", "server.key", "id_rsa", "id_rsa.pub", "Readme.md"]) {
      expect(read, notRead).not.toContain(notRead);
    }
    expect(fs.writes).toEqual([]);
  });
});

describe("2.3 text and hashes agree with Web Crypto", () => {
  it("removes the byte order mark, keeps CRLF and hashes like Blob.text() plus crypto.subtle", async () => {
    const workspace = makeWorkspace();
    mkdirSync(join(workspace, "root"));
    materialize(loadLoaderRoot(), join(workspace, "root"));
    const loaded = await load(workspace, "root");
    if (!loaded.ok) throw new Error(loaded.error.message);
    for (const path of ["bom.ts", "crlf.ts"]) {
      const file = loaded.sourceSet.files.find((f) => f.path === path);
      expect(file, path).toBeDefined();
      const bytes = readFileSync(join(workspace, "root", path));
      const appText = await new Blob([bytes]).text();
      const nodeHash = await sha256Hex((file as { text: string }).text);
      const appHash = await webCryptoHash(appText);
      console.info(`${path}: node:crypto ${nodeHash}, Web Crypto ${appHash}`);
      expect((file as { text: string }).text).toBe(appText);
      expect(nodeHash).toBe(appHash);
    }
    const bom = loaded.sourceSet.files.find((f) => f.path === "bom.ts") as { text: string };
    const crlf = loaded.sourceSet.files.find((f) => f.path === "crlf.ts") as { text: string };
    expect(bom.text.startsWith("e")).toBe(true);
    expect(crlf.text).toContain("\r\n");
  });
});

describe("2.5 caps are errors", () => {
  it("cap-files: 1,001 files give cap-reached and name the last path in code-point order", async () => {
    const workspace = makeWorkspace();
    makeCapFilesWorkspace(join(workspace, "cap-files"));
    const names = Array.from({ length: 1001 }, (_, i) => `m${i}.ts`).sort(code);
    const first = names[1000] as string;
    expect(first).toBe("m999.ts");
    const loaded = await load(workspace, "cap-files");
    expect(loaded).toEqual({
      ok: false,
      error: { code: "cap-reached", message: `Root "cap-files" has more than 1000 included files; first excluded: ${first}.` },
    });
  });

  it("cap-bytes: 26 files of 1,048,576 bytes give cap-reached and name the 26th sorted file", async () => {
    const workspace = makeWorkspace();
    makeCapBytesWorkspace(join(workspace, "cap-bytes"));
    const names = Array.from({ length: 26 }, (_, i) => `b${String(i).padStart(2, "0")}.ts`).sort(code);
    const loaded = await load(workspace, "cap-bytes");
    expect(loaded).toEqual({
      ok: false,
      error: { code: "cap-reached", message: `Root "cap-bytes" exceeds 25 MiB of included text; first excluded: ${names[25] as string}.` },
    });
  });
});

describe("2.6 containment", () => {
  it("rejects a root that is a link to a folder outside the workspace and reads nothing there", async () => {
    const workspace = makeWorkspace();
    const outside = makeWorkspace();
    writeFileSync(join(outside, "secret.ts"), "export const secret = 1;\n");
    symlinkDirectory(outside, join(workspace, "link"));
    const fs = new RecordingFs();
    const result = await resolveRoot(workspace, "link", fs);
    expect(result).toEqual({
      ok: false,
      error: { code: "root-outside-workspace", message: `Root "link" resolves outside the working directory "${workspace}".` },
    });
    expect(fs.touched().filter((p) => p.startsWith(outside))).toEqual([]);
  });

  it("rejects an absolute path outside the workspace and a path with ..", async () => {
    const workspace = makeWorkspace();
    const outside = makeWorkspace();
    for (const given of [outside, `..${join("/", outside.split(/[\\/]/).pop() as string)}`]) {
      const fs = new RecordingFs();
      const result = await resolveRoot(workspace, given, fs);
      expect(result.ok, given).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("root-outside-workspace");
      expect(fs.reads).toEqual([]);
      expect(fs.readdirs).toEqual([]);
    }
  });

  it("accepts the workspace itself and a folder inside it", async () => {
    const workspace = makeWorkspace();
    mkdirSync(join(workspace, "inner"));
    const here = await resolveRoot(workspace, ".");
    expect(here.ok).toBe(true);
    const inner = await resolveRoot(workspace, "./inner/");
    expect(inner.ok && inner.root.label).toBe("live:inner");
  });

  it("skips a link inside the root that leaves the workspace, logs one stderr line and never reads through it", async () => {
    const workspace = makeWorkspace();
    const outside = makeWorkspace();
    writeFileSync(join(outside, "secret.ts"), "export const secret = 1;\n");
    mkdirSync(join(workspace, "root"));
    writeFileSync(join(workspace, "root", "real.ts"), "export const real = 1;\n");
    symlinkDirectory(outside, join(workspace, "root", "escape"));
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const fs = new RecordingFs();
    const loaded = await load(workspace, "root", fs);
    if (!loaded.ok) throw new Error(loaded.error.message);
    expect(loaded.sourceSet.files.map((f) => f.path)).toEqual(["real.ts"]);
    expect(fs.reads.filter((p) => p.startsWith(outside))).toEqual([]);
    expect(fs.readdirs.filter((p) => p.startsWith(outside))).toEqual([]);
    expect(stderr.mock.calls.some(([text]) => String(text).includes("escape"))).toBe(true);
  });
});

describe("2.7 missing roots", () => {
  it("returns root-not-found for a missing folder and for a file", async () => {
    const workspace = makeWorkspace();
    writeFileSync(join(workspace, "file.ts"), "export {};\n");
    for (const given of ["missing", "file.ts"]) {
      expect(await resolveRoot(workspace, given)).toEqual({
        ok: false,
        error: { code: "root-not-found", message: `Root "${given}" does not exist or is not a directory.` },
      });
    }
  });
});
