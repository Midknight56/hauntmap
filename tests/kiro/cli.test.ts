import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateComparison, validateInvestigation } from "../../src/contracts/validate";
import { main, USAGE } from "../../packages/hauntmap-mcp/src/cli";
import { createContext } from "../../packages/hauntmap-mcp/src/tools";
import { DEMO_RELATION_ID, expectedManor, REPO, repoTemp } from "./appPath";
import { makeManorAfterRemoval } from "./generators";

// Requirements 1.3, 5.1 to 5.6. `main` runs in process with captured output; the launcher test
// spawns bin/hauntmap.js.

const expected = expectedManor();
const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function repoOut(): string {
  const dir = repoTemp("cli-");
  temporary.push(dir);
  return dir;
}

async function run(argv: string[], cwd = REPO, extra: Record<string, unknown> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, { cwd, stdout: (s: string) => out.push(s), stderr: (s: string) => err.push(s), ...extra });
  return { code, stdout: out.join(""), stderr: err.join("") };
}

function hasTextProperty(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasTextProperty);
  if (value !== null && typeof value === "object") return Object.entries(value).some(([key, child]) => key === "text" || hasTextProperty(child));
  return false;
}

describe("5.1 usage", () => {
  it.each([[[]], [["frobnicate"]], [["analyze"]], [["analyze", "samples/manor"]], [["analyze", "samples/manor", "--out"]], [["compare", "only-one", "--out", "x.json"]]])(
    "%j prints the two usage lines and exits 2",
    async (argv) => {
      const result = await run(argv);
      expect(result.code).toBe(2);
      expect(result.stderr).toContain(USAGE);
      expect(USAGE.split("\n")).toHaveLength(2);
      expect(result.stdout).toBe("");
    },
  );

  it("an unknown preset exits 2 with its own message", async () => {
    const dir = repoOut();
    const result = await run(["analyze", "samples/manor", "--out", join(dir, "o.json"), "--preset", "bogus"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toBe("hauntmap: Preset \"bogus\" is not one of static-value, type-inclusive, dynamic-inclusive.\n");
    expect(existsSync(join(dir, "o.json"))).toBe(false);
  });
});

describe("5.2 and 5.6 analyze", () => {
  it("writes indented JSON with a trailing newline, prints the summary line and leaves no .tmp", async () => {
    const dir = repoOut();
    const out = join(dir, "live.json");
    const rel = relative(REPO, out).replace(/\\/g, "/");
    const result = await run(["analyze", "samples/manor", "--out", rel]);
    expect(result.code).toBe(0);
    expect([expected.modules.length, expected.imports.length, expected.diagnostics.length]).toEqual([40, 72, 1]);
    expect(result.stdout).toBe(`analyze: 40 modules, 72 relations, 1 diagnostics → ${rel}\n`);
    const text = readFileSync(out, "utf8");
    expect(text.endsWith("}\n")).toBe(true);
    expect(text.startsWith('{\n  "schemaVersion": 1,')).toBe(true);
    expect(existsSync(`${out}.tmp`)).toBe(false);
    const value = JSON.parse(text) as { sourceLabel: string; modules: unknown[] };
    expect(validateInvestigation(value)).toEqual({ ok: true });
    expect(value.sourceLabel).toBe("live:samples/manor");
    expect(value.modules).toHaveLength(40);
    expect(hasTextProperty(value)).toBe(false);
    expect(text).not.toContain("\\nimport ");
  });

  it("a second run is byte-identical", async () => {
    const dir = repoOut();
    const a = join(dir, "a.json");
    const b = join(dir, "b.json");
    expect((await run(["analyze", "samples/manor", "--out", a])).code).toBe(0);
    expect((await run(["analyze", "samples/manor", "--out", b])).code).toBe(0);
    expect(readFileSync(a).equals(readFileSync(b))).toBe(true);
  });

  it("--preset is recorded in the options", async () => {
    const dir = repoOut();
    const out = join(dir, "t.json");
    expect((await run(["analyze", "samples/manor", "--out", out, "--preset", "type-inclusive"])).code).toBe(0);
    expect((JSON.parse(readFileSync(out, "utf8")) as { options: { preset: string } }).options.preset).toBe("type-inclusive");
  });
});

describe("5.3 compare", () => {
  it("prints the compare line and writes a validated ComparisonResult", async () => {
    const dir = repoOut();
    const after = makeManorAfterRemoval(REPO, join(dir, "manor-after-removal"));
    const out = join(dir, "cmp.json");
    const result = await run(["compare", "public/demo/manor/before", relative(REPO, after), "--out", out]);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(`compare: 1 removed, 0 added, 1 changed modules → ${out}\n`);
    const value = JSON.parse(readFileSync(out, "utf8")) as { removedRelations: { relationId: string }[]; before: { relationCount: number }; after: { relationCount: number } };
    expect(validateComparison(value)).toEqual({ ok: true });
    expect(value.removedRelations[0]?.relationId).toBe(DEMO_RELATION_ID);
    expect(value.before.relationCount).toBe(72);
    expect(value.after.relationCount).toBe(71);
  });
});

describe("5.4 exit codes leave --out untouched", () => {
  function oldOut(): { dir: string; out: string } {
    const dir = repoOut();
    const out = join(dir, "out.json");
    writeFileSync(out, "old");
    return { dir, out };
  }

  it("exit 4 for a root outside the workspace and for a missing root", async () => {
    const { out } = oldOut();
    const outside = await run(["analyze", "..", "--out", out]);
    expect(outside.code).toBe(4);
    expect(outside.stderr.startsWith("hauntmap: Root \"..\" resolves outside the working directory ")).toBe(true);
    const missing = await run(["analyze", "samples/missing", "--out", out]);
    expect(missing).toMatchObject({ code: 4, stderr: 'hauntmap: Root "samples/missing" does not exist or is not a directory.\n' });
    expect(readFileSync(out, "utf8")).toBe("old");
  });

  it("exit 5 when the produced value fails validation", async () => {
    const { out } = oldOut();
    const failing = createContext(REPO, { validate: { investigation: () => ({ ok: false, errors: ["sourceLabel must be a string"] }), comparison: () => ({ ok: true }) } });
    const result = await run(["analyze", "samples/manor", "--out", out], REPO, { context: failing });
    expect(result.code).toBe(5);
    expect(result.stderr).toBe("hauntmap: internal error, output failed validation: sourceLabel must be a string\n");
    expect(readFileSync(out, "utf8")).toBe("old");
  });

  it("exit 6 when the file cannot be written, with <out> untouched and the .tmp removed", async () => {
    const { out } = oldOut();
    mkdirSync(`${out}.tmp`);
    const result = await run(["analyze", "samples/manor", "--out", out]);
    expect(result.code).toBe(6);
    expect(result.stderr).toMatch(/^hauntmap: cannot write .+ \(\w+\)\.\n$/);
    expect(readFileSync(out, "utf8")).toBe("old");
  });
});

describe("5.5 run from the repository root", () => {
  it("exit 4 from a folder without the root package.json", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hauntmap-cli-"));
    temporary.push(dir);
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "other" }));
    const result = await run(["analyze", "samples/manor", "--out", join(dir, "o.json")], dir);
    expect(result.code).toBe(4);
    expect(result.stderr).toBe(`hauntmap: run from the HauntMap repository root (no package.json named hauntmap in ${dir}).\n`);
    expect(existsSync(join(dir, "o.json"))).toBe(false);
  });
});

describe("1.3 launcher", () => {
  it("prints the not-built message and exits 3 when dist/cli.js is absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "hauntmap-launcher-"));
    temporary.push(dir);
    mkdirSync(join(dir, "bin"));
    cpSync(join(REPO, "packages", "hauntmap-mcp", "bin", "hauntmap.js"), join(dir, "bin", "hauntmap.js"));
    const result = spawnSync(process.execPath, [join(dir, "bin", "hauntmap.js"), "analyze"], { encoding: "utf8" });
    expect(result.status).toBe(3);
    expect(result.stderr).toBe("hauntmap: the CLI is not built. Run pnpm build:mcp first.\n");
    expect(result.stdout).toBe("");
  });

  it("runs the built CLI through the launcher", () => {
    const result = spawnSync(process.execPath, [join(REPO, "packages", "hauntmap-mcp", "bin", "hauntmap.js")], { encoding: "utf8", cwd: REPO });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(USAGE);
  });
});
