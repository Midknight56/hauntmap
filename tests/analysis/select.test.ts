import { describe, expect, it } from "vitest";
import { selectSources } from "../../src/analysis/parser/select";
import { DEFAULT_ANALYSIS_OPTIONS } from "../../src/contracts/options";
import type { AnalysisOptions, SourceFile } from "../../src/contracts/types";
import { FIXTURES_ROOT, loadFixtureFiles, readExpected } from "../fixtures/load";
import { join } from "node:path";

function file(path: string, text = "export const a = 1;\n"): SourceFile {
  return { path, text, bytes: Buffer.byteLength(text, "utf8") };
}

const options = (patch: Partial<AnalysisOptions> = {}): AnalysisOptions => ({ ...DEFAULT_ANALYSIS_OPTIONS, ...patch });

function select(files: SourceFile[], patch: Partial<AnalysisOptions> = {}) {
  const result = selectSources(files, "root", options(patch));
  if (!result.ok) throw new Error(`unexpected cap: ${JSON.stringify(result.diagnostics)}`);
  return result;
}

describe("selectSources, requirement 1.1: extensions and reasons", () => {
  it("keeps the six extensions and skips the others with reason `extension`", () => {
    const names = ["a.js", "b.jsx", "c.ts", "d.tsx", "e.mjs", "f.mts", "g.css", "h.json", "i.cjs", "README.md"];
    const { sourceSet } = select(names.map((name) => file(name)));
    expect(sourceSet.files.map((f) => f.path)).toEqual(["a.js", "b.jsx", "c.ts", "d.tsx", "e.mjs", "f.mts"]);
    expect(sourceSet.skipped).toEqual([
      { path: "README.md", reason: "extension" },
      { path: "g.css", reason: "extension" },
      { path: "h.json", reason: "extension" },
      { path: "i.cjs", reason: "extension" },
    ]);
  });

  it("carries the root label", () => {
    expect(select([file("a.ts")]).sourceSet.rootLabel).toBe("root");
  });

  it("marks a file binary when a NUL character is in its first 8,192 characters", () => {
    const atLast = "a".repeat(8191) + "\u0000";
    const beyond = "a".repeat(8192) + "\u0000";
    const { sourceSet } = select([file("nul-first.ts", atLast), file("nul-late.ts", beyond), file("clean.ts")]);
    expect(sourceSet.skipped).toEqual([{ path: "nul-first.ts", reason: "binary" }]);
    expect(sourceSet.files.map((f) => f.path)).toEqual(["clean.ts", "nul-late.ts"]);
  });

  it("uses the reasons excluded-dir, secret-pattern, extension, oversized and binary", () => {
    const { sourceSet } = select(
      [
        file("node_modules/x/index.js"),
        file("config/.env"),
        file("notes.txt"),
        file("big.ts", "x".repeat(20)),
        file("bin.ts", "\u0000"),
        file("ok.ts", "x"),
      ],
      { maxFileBytes: 10 },
    );
    expect(Object.fromEntries(sourceSet.skipped.map((s) => [s.path, s.reason]))).toEqual({
      "node_modules/x/index.js": "excluded-dir",
      "config/.env": "secret-pattern",
      "notes.txt": "extension",
      "big.ts": "oversized",
      "bin.ts": "binary",
    });
    expect(sourceSet.files.map((f) => f.path)).toEqual(["ok.ts"]);
  });
});

describe("selectSources, requirement 1.2: excluded directories and secret patterns", () => {
  it("skips a file inside any excluded directory at any depth, even when its extension is included", () => {
    const paths = [".git/hooks/x.js", "a/node_modules/p/i.js", "dist/a.js", "build/a.js", "out/a.js", ".next/a.js", "coverage/a.js"];
    const { sourceSet } = select([...paths.map((p) => file(p)), file("src/dist-like/a.ts")]);
    expect(sourceSet.files.map((f) => f.path)).toEqual(["src/dist-like/a.ts"]);
    expect(sourceSet.skipped.every((s) => s.reason === "excluded-dir")).toBe(true);
    expect(sourceSet.skipped).toHaveLength(paths.length);
  });

  it("does not treat a file named like an excluded directory as excluded", () => {
    const { sourceSet } = select([file("src/dist.ts"), file("build.ts")]);
    expect(sourceSet.files.map((f) => f.path)).toEqual(["build.ts", "src/dist.ts"]);
  });

  it("skips secret file names with reason secret-pattern", () => {
    const names = [".env", ".env.local", "key.pem", "server.key", "id_rsa", "id_rsa.pub"];
    const { sourceSet } = select([...names.map((n) => file(`cfg/${n}`)), file("cfg/a.ts")]);
    expect(sourceSet.skipped.map((s) => s.reason)).toEqual(names.map(() => "secret-pattern"));
    expect(sourceSet.files.map((f) => f.path)).toEqual(["cfg/a.ts"]);
  });

  it("decides on the path alone, before the text is read", () => {
    const hostile = {
      path: "node_modules/a.js",
      bytes: 5,
      get text(): string {
        throw new Error("text was read");
      },
    } as SourceFile;
    expect(() => select([hostile, file("ok.ts")])).not.toThrow();
  });
});

describe("selectSources, requirement 1.3: oversized files", () => {
  it("skips a file larger than maxFileBytes with an oversized diagnostic, and keeps a file of exactly that size", () => {
    const result = select([file("exact.ts", "x".repeat(10)), file("big.ts", "x".repeat(11))], { maxFileBytes: 10 });
    expect(result.sourceSet.skipped).toEqual([{ path: "big.ts", reason: "oversized" }]);
    expect(result.sourceSet.files.map((f) => f.path)).toEqual(["exact.ts"]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({ code: "oversized", module: "big.ts" });
  });
});

describe("selectSources, requirement 1.4: caps", () => {
  it("returns no source set and one cap-reached diagnostic for maxFiles, naming the limit, the count and the first path over it", () => {
    const files = ["e.ts", "b.ts", "d.ts", "a.ts", "c.ts"].map((p) => file(p));
    const result = selectSources(files, "root", options({ maxFiles: 3 }));
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("sourceSet");
    expect(result.diagnostics).toHaveLength(1);
    const [diagnostic] = result.diagnostics;
    expect(diagnostic?.code).toBe("cap-reached");
    expect(diagnostic?.module).toBe("d.ts");
    expect(diagnostic?.message).toContain("3");
    expect(diagnostic?.message).toContain("5");
    expect(diagnostic?.message).toContain("d.ts");
  });

  it("accepts exactly maxFiles files", () => {
    const files = ["a.ts", "b.ts", "c.ts"].map((p) => file(p));
    expect(selectSources(files, "root", options({ maxFiles: 3 })).ok).toBe(true);
  });

  it("counts only kept files toward maxFiles", () => {
    const files = [file("a.ts"), file("b.ts"), file("x.png"), file("node_modules/z.js")];
    expect(selectSources(files, "root", options({ maxFiles: 2 })).ok).toBe(true);
  });

  it("for maxTotalBytes names the first file whose running total, in code unit order, passes the limit", () => {
    const files = [file("c.ts", "x".repeat(4)), file("a.ts", "x".repeat(4)), file("b.ts", "x".repeat(4))];
    const result = selectSources(files, "root", options({ maxTotalBytes: 9 }));
    expect(result.ok).toBe(false);
    const [diagnostic] = result.diagnostics;
    expect(result.diagnostics).toHaveLength(1);
    expect(diagnostic?.code).toBe("cap-reached");
    expect(diagnostic?.module).toBe("c.ts");
    expect(diagnostic?.message).toContain("9");
    expect(diagnostic?.message).toContain("12");
    expect(diagnostic?.message).toContain("c.ts");
  });

  it("accepts a running total equal to maxTotalBytes", () => {
    const files = [file("a.ts", "x".repeat(4)), file("b.ts", "x".repeat(5))];
    expect(selectSources(files, "root", options({ maxTotalBytes: 9 })).ok).toBe(true);
  });

  it("sorts paths by code unit, so an uppercase path comes before a lowercase one", () => {
    const files = [file("b.ts"), file("B.ts"), file("a.ts")];
    const result = selectSources(files, "root", options({ maxFiles: 2 }));
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.module).toBe("b.ts");
  });
});

describe("selectSources, requirement 1.5: normalized paths", () => {
  it("normalizes every path in the source set and in the skipped list", () => {
    const { sourceSet } = select([file(".\\src\\a.ts"), file("./notes.txt")]);
    expect(sourceSet.files.map((f) => f.path)).toEqual(["src/a.ts"]);
    expect(sourceSet.skipped).toEqual([{ path: "notes.txt", reason: "extension" }]);
  });
});

describe("selectSources, requirement 1.6: case collisions and duplicates", () => {
  it("keeps both files and adds a case-collision diagnostic for each", () => {
    const result = select([file("Util.ts"), file("util.ts"), file("a.ts")]);
    expect(result.sourceSet.files.map((f) => f.path)).toEqual(["Util.ts", "a.ts", "util.ts"]);
    expect(result.diagnostics.map((d) => [d.code, d.module])).toEqual([
      ["case-collision", "Util.ts"],
      ["case-collision", "util.ts"],
    ]);
  });

  it("rejects the second of two inputs that normalize to one path, with a duplicate-path diagnostic", () => {
    const first = file("src/a.ts", "export const first = 1;\n");
    const second = file(".\\src\\a.ts", "export const second = 1;\n");
    const result = select([first, second]);
    expect(result.sourceSet.files).toHaveLength(1);
    expect(result.sourceSet.files[0]?.text).toBe(first.text);
    expect(result.diagnostics.map((d) => [d.code, d.module])).toEqual([["duplicate-path", "src/a.ts"]]);
  });

  it("gives the same result when the input order changes, apart from which duplicate is second", () => {
    const files = [file("b.ts"), file("a.ts"), file("B.ts")];
    const forward = select(files);
    const backward = select([...files].reverse());
    expect(forward.sourceSet).toEqual(backward.sourceSet);
    expect(forward.diagnostics).toEqual(backward.diagnostics);
  });
});

describe("selectSources on the case fixture", () => {
  it("produces the case-collision diagnostics of its expected.json", () => {
    const dir = join(FIXTURES_ROOT, "case");
    const expected = readExpected(dir) as { diagnostics: { code: string; module: string }[] };
    const result = select(loadFixtureFiles(dir));
    const actual = result.diagnostics.filter((d) => d.code === "case-collision").map((d) => ({ code: d.code, module: d.module }));
    const wanted = expected.diagnostics.filter((d) => d.code === "case-collision").map((d) => ({ code: d.code, module: d.module }));
    expect(actual).toEqual(wanted);
    expect(result.sourceSet.files.map((f) => f.path)).toEqual(["Util.ts", "a.ts", "util.ts"]);
  });
});