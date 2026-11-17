import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runDemoLive } from "../../scripts/demo-live";
import { makeDemoLiveWorkspace } from "./generators";

// Requirement 6.8. The three branches of scripts/demo-live.ts on a generated workspace, with the
// command runner injected so that the CLI does not have to be built.

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKIP_ABSENT = "demo:live: skipped (dist/cli.js absent; run pnpm build:mcp)\n";
const SKIP_IDENTICAL = "demo:live: skipped (samples/manor is identical to public/demo/manor/before)\n";

const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function write(root: string, path: string, text: string): void {
  const target = join(root, ...path.split("/"));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text, "utf8");
}

/** A workspace with the fixture, an identical samples/manor and, optionally, a dist/cli.js marker. */
function workspace(withCli: boolean): string {
  const root = mkdtempSync(join(tmpdir(), "hauntmap-demo-live-"));
  temporary.push(root);
  return makeDemoLiveWorkspace(root, withCli);
}

function run(root: string, exitCode = 0): { code: number; out: string[]; calls: string[][] } {
  const out: string[] = [];
  const calls: string[][] = [];
  const code = runDemoLive(root, {
    stdout: (s) => out.push(s),
    runner: (args) => {
      calls.push(args);
      return exitCode;
    },
  });
  return { code, out, calls };
}

describe("scripts/demo-live.ts", () => {
  it("skips with the dist/cli.js line, exit 0, and runs nothing when the CLI is not built", () => {
    const root = workspace(false);
    write(root, "samples/manor/src/a.ts", "changed\n");
    const result = run(root);
    expect(result).toEqual({ code: 0, out: [SKIP_ABSENT], calls: [] });
  });

  it("skips with the identical line, exit 0, and writes nothing when the sample equals the fixture", () => {
    const root = workspace(true);
    const result = run(root);
    expect(result).toEqual({ code: 0, out: [SKIP_IDENTICAL], calls: [] });
    expect(() => readFileSync(join(root, "public", "demo", "live.json"))).toThrow();
  });

  it("ignores a difference in a file that has no included extension", () => {
    const root = workspace(true);
    write(root, "samples/manor/notes.md", "scratch\n");
    expect(run(root).out).toEqual([SKIP_IDENTICAL]);
  });

  it("runs the injected runner once with exactly analyze samples/manor --out public/demo/live.json when one byte differs", () => {
    const root = workspace(true);
    write(root, "samples/manor/src/a.ts", 'import { b } from "./b";\nexport const a = b; \n');
    const result = run(root);
    expect(result.calls).toEqual([["analyze", "samples/manor", "--out", "public/demo/live.json"]]);
    expect(result.out).toEqual([]);
    expect(result.code).toBe(0);
  });

  it("runs the runner when a file of the sample is missing or extra", () => {
    const missing = workspace(true);
    rmSync(join(missing, "samples", "manor", "src", "c.ts"));
    expect(run(missing).calls).toHaveLength(1);
    const extra = workspace(true);
    write(extra, "samples/manor/src/d.ts", "export {};\n");
    expect(run(extra).calls).toHaveLength(1);
  });

  it("exits with the code of the runner", () => {
    const root = workspace(true);
    write(root, "samples/manor/src/a.ts", "changed\n");
    expect(run(root, 5).code).toBe(5);
  });

  it("names no root and no output other than samples/manor and public/demo/live.json (source check)", () => {
    const source = readFileSync(join(REPO, "scripts", "demo-live.ts"), "utf8");
    expect(source.split("analyze samples/manor --out public/demo/live.json")).toHaveLength(2);
    expect([...source.matchAll(/--out/g)]).toHaveLength(1);
    expect(source).not.toMatch(/public\/demo\/manor\/after|public\/demo\/annex/);
  });
});
