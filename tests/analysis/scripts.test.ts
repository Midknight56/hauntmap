import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadFixtureFiles } from "../fixtures/load";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SAMPLES = ["manor/before", "manor/after", "annex"].map((name) => join(REPO, "public", "demo", ...name.split("/")));

interface Run {
  status: number;
  output: string;
}

function run(args: string[]): Run {
  try {
    const output = execFileSync(process.execPath, args, { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { status: 0, output };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failure.status ?? 1, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
}

const checkExpected = (...dirs: string[]): Run => run(["scripts/check-expected.mjs", ...dirs]);
const packSamples = (...args: string[]): Run => run(["--import", "tsx", "scripts/pack-samples.ts", ...args]);

function withCopy<T>(sample: string, body: (copy: string) => T): T {
  const temp = mkdtempSync(join(tmpdir(), "hauntmap-sample-"));
  try {
    const copy = join(temp, "sample");
    cpSync(sample, copy, { recursive: true });
    return body(copy);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

describe("scripts/check-expected.mjs (requirement 8.5)", () => {
  it("passes for the three samples", () => {
    const result = checkExpected();
    expect(result.output).toContain("annex");
    expect(result.status).toBe(0);
  });

  it("passes for each sample folder given on the command line", () => {
    for (const sample of SAMPLES) expect(checkExpected(sample).status).toBe(0);
  });

  it("fails and names the file when one import line is removed from a copy", () => {
    withCopy(join(REPO, "public", "demo", "annex"), (copy) => {
      const path = join(copy, "models", "user.js");
      const text = readFileSync(path, "utf8");
      writeFileSync(path, text.replace('import { Account } from "./account";\n', ""));
      const result = checkExpected(copy);
      expect(result.status).not.toBe(0);
      expect(result.output).toContain("models/user.js");
    });
  });

  it("fails when an import line is added to a copy", () => {
    withCopy(join(REPO, "public", "demo", "manor", "before"), (copy) => {
      const path = join(copy, "src", "shared", "types.ts");
      writeFileSync(path, `import { newId } from "./ids";\n${readFileSync(path, "utf8")}`);
      const result = checkExpected(copy);
      expect(result.status).not.toBe(0);
      expect(result.output).toContain("src/shared/types.ts");
    });
  });

  it("counts a literal dynamic import on its line", () => {
    withCopy(join(REPO, "public", "demo", "annex"), (copy) => {
      const path = join(copy, "util", "dom.js");
      writeFileSync(path, `${readFileSync(path, "utf8")}\nexport async function later() {\n  return import("./strings");\n}\n`);
      const result = checkExpected(copy);
      expect(result.status).not.toBe(0);
      expect(result.output).toContain("util/dom.js");
    });
  });
});

// Each test starts tsx in a child process, which takes a few seconds on a cold start.
describe("scripts/pack-samples.ts", { timeout: 60_000 }, () => {
  it("passes --check for the three committed sources.json files", () => {
    const result = packSamples("--check");
    expect(result.output).toBe("");
    expect(result.status).toBe(0);
  });

  it("writes sources.json with every source path and its text, and not expected.json", () => {
    withCopy(join(REPO, "public", "demo", "annex"), (copy) => {
      rmSync(join(copy, "sources.json"), { force: true });
      expect(packSamples(copy).status).toBe(0);
      const packed = JSON.parse(readFileSync(join(copy, "sources.json"), "utf8")) as { files: { path: string; text: string }[] };
      const files = loadFixtureFiles(copy);
      expect(packed.files.map((f) => f.path)).toEqual(files.map((f) => f.path).sort());
      for (const entry of packed.files) {
        expect(entry.text).toBe(files.find((f) => f.path === entry.path)?.text);
      }
      expect(packSamples("--check", copy).status).toBe(0);
    });
  });

  it("fails --check when a source file changes after packing, and when sources.json is missing", () => {
    withCopy(join(REPO, "public", "demo", "annex"), (copy) => {
      const path = join(copy, "util", "dom.js");
      writeFileSync(path, `${readFileSync(path, "utf8")}// changed\n`);
      const stale = packSamples("--check", copy);
      expect(stale.status).not.toBe(0);
      expect(stale.output).toContain("sources.json");
      rmSync(join(copy, "sources.json"));
      expect(packSamples("--check", copy).status).not.toBe(0);
    });
  });

  it("packs the same bytes twice", () => {
    withCopy(join(REPO, "public", "demo", "manor", "after"), (copy) => {
      packSamples(copy);
      const first = readFileSync(join(copy, "sources.json"), "utf8");
      packSamples(copy);
      expect(readFileSync(join(copy, "sources.json"), "utf8")).toBe(first);
      expect(first.includes("\r")).toBe(false);
    });
  });
});
