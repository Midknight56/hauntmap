import { createHash } from "node:crypto";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyze } from "../../src/analysis/parser/analyze";
import { selectSources } from "../../src/analysis/parser/select";
import { occurrenceId, relationId } from "../../src/analysis/graph/ids";
import { DEFAULT_ANALYSIS_OPTIONS } from "../../src/contracts/options";
import type { Investigation, SourceFile } from "../../src/contracts/types";
import { FIXTURES_ROOT, loadFixtureFiles } from "../fixtures/load";

const nodeHash = (text: string): Promise<string> => Promise.resolve(createHash("sha256").update(text, "utf8").digest("hex"));

async function webCryptoHash(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function file(path: string, text: string): SourceFile {
  return { path, text, bytes: Buffer.byteLength(text, "utf8") };
}

async function run(files: SourceFile[], hash = nodeHash, progress?: (done: number, total: number) => void): Promise<Investigation> {
  const selected = selectSources(files, "test", DEFAULT_ANALYSIS_OPTIONS);
  if (!selected.ok) throw new Error("selection failed");
  return analyze(selected.sourceSet, DEFAULT_ANALYSIS_OPTIONS, hash, progress, selected.diagnostics);
}

describe("ids", () => {
  it("builds the occurrence id as a JSON array of from, line, column and specifier", () => {
    expect(occurrenceId("a.ts", 3, 1, "./b")).toBe('["a.ts",3,1,"./b"]');
  });

  it("builds the relation id with a local target key", () => {
    expect(relationId("a.ts", ["local", "b.ts"], "import", "value")).toBe('["a.ts",["local","b.ts"],"import","value"]');
  });

  it("builds the relation id with a [resolution, specifier] key for other targets", () => {
    expect(relationId("a.ts", ["external", "react"], "import", "value")).toBe('["a.ts",["external","react"],"import","value"]');
  });

  it("cannot be confused by a delimiter inside a path", () => {
    expect(occurrenceId('a",1,"b', 1, 1, "x")).not.toBe(occurrenceId("a", 1, 1, 'b",1,"x'));
  });
});

describe("analyze", () => {
  it("returns schemaVersion 1 and the documented resolver mode, with the label", async () => {
    const investigation = await run([file("a.ts", "export const a = 1;\n")]);
    expect(investigation.schemaVersion).toBe(1);
    expect(investigation.resolverMode).toBe("documented-source-subset");
    expect(investigation.sourceLabel).toBe("test");
    expect(investigation.options).toEqual(DEFAULT_ANALYSIS_OPTIONS);
  });

  it("uses the hash function it is given", async () => {
    const investigation = await run([file("a.ts", "export const a = 1;\n")], () => Promise.resolve("fixed"));
    expect(investigation.modules[0]?.sourceHash).toBe("fixed");
  });

  it("calls onProgress once after each file with the number done and the total", async () => {
    const calls: [number, number][] = [];
    await run([file("a.ts", ""), file("b.ts", ""), file("c.ts", "")], nodeHash, (done, total) => calls.push([done, total]));
    expect(calls).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it("merges the selection diagnostics with its own and sorts them by module, line, column and code", async () => {
    const investigation = await run([file("b.ts", 'import "./nope";\n'), file("a.ts", "export const = 1;\n"), file("A.ts", "")]);
    expect(investigation.diagnostics.map((d) => [d.code, d.module])).toEqual([
      ["case-collision", "A.ts"],
      ["case-collision", "a.ts"],
      ["parse-failed", "a.ts"],
      ["unresolved", "b.ts"],
    ]);
  });

  it("writes an unresolved diagnostic for an absent file with line, column and specifier", async () => {
    const investigation = await run([file("a.ts", '\n  import { x } from "./nope";\n')]);
    expect(investigation.diagnostics).toHaveLength(1);
    expect(investigation.diagnostics[0]).toMatchObject({ code: "unresolved", module: "a.ts", line: 2, column: 3, specifier: "./nope" });
  });

  it("writes no diagnostic for an external package", async () => {
    const investigation = await run([file("a.ts", 'import React from "react";\n')]);
    expect(investigation.diagnostics).toEqual([]);
    expect(investigation.imports[0]).toMatchObject({ resolution: "external", to: null });
    expect(investigation.imports[0]?.relationId).toBe('["a.ts",["external","react"],"import","value"]');
  });

  it("records an http or https URL import as external with no reason and no diagnostic", async () => {
    const investigation = await run([
      file("a.ts", 'import { x } from "https://cdn.example.com/lib.js";\n'),
      file("b.ts", 'import { y } from "https://cdn.example.com/lib.js";\nimport { z } from "./gone";\n'),
    ]);
    const urlRecords = investigation.imports.filter((i) => i.specifier === "https://cdn.example.com/lib.js");
    expect(urlRecords).toHaveLength(2);
    for (const record of urlRecords) {
      expect(record.resolution).toBe("external");
      expect(record.to).toBeNull();
      expect(record).not.toHaveProperty("reason");
    }
    expect(urlRecords.find((i) => i.from === "a.ts")?.relationId).toBe(
      relationId("a.ts", ["external", "https://cdn.example.com/lib.js"], "import", "value"),
    );
    expect(investigation.diagnostics.filter((d) => d.specifier?.startsWith("https://"))).toEqual([]);
    const unresolved = investigation.diagnostics.filter((d) => d.code === "unresolved");
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]).toMatchObject({ module: "b.ts", specifier: "./gone" });
    expect(investigation.modules.map((m) => m.id)).toEqual(["a.ts", "b.ts"]);
  });

  it("keeps a failed module with no imports and still analyzes the others", async () => {
    const investigation = await run([file("bad.ts", "export const = 1;\n"), file("ok.ts", 'import "./bad";\n')]);
    expect(investigation.modules.map((m) => [m.id, m.parseStatus])).toEqual([
      ["bad.ts", "failed"],
      ["ok.ts", "ok"],
    ]);
    expect(investigation.imports.filter((i) => i.from === "bad.ts")).toEqual([]);
    expect(investigation.imports.filter((i) => i.from === "ok.ts")).toHaveLength(1);
  });

  it("keeps both occurrences of a repeated import, with one relation id", async () => {
    const investigation = await run([file("a.ts", 'import { x } from "./b";\nimport { x as y } from "./b";\n'), file("b.ts", "export const x = 1;\n")]);
    expect(investigation.imports).toHaveLength(2);
    expect(investigation.imports[0]?.relationId).toBe(investigation.imports[1]?.relationId);
    expect(investigation.imports[0]?.occurrenceId).not.toBe(investigation.imports[1]?.occurrenceId);
  });

  it("never executes analyzed source", async () => {
    const flag = "__hauntmapExecuted";
    await run([file("evil.ts", `(globalThis as Record<string, unknown>).${flag} = true;\nthrow new Error("run");\nimport "./x";\n`)]);
    await run([file("evil.js", `globalThis.${flag} = true;\nthrow new Error("run");\n`)]);
    expect((globalThis as Record<string, unknown>)[flag]).toBeUndefined();
  });
});

describe("determinism", () => {
  const names = ["kinds", "case", "parse-fail", "two-cycles", "same-names", "alias"];

  function shuffled<T>(items: T[], seed: number): T[] {
    const copy = [...items];
    let state = seed;
    for (let i = copy.length - 1; i > 0; i--) {
      state = (state * 1103515245 + 12345) % 2147483648;
      const j = state % (i + 1);
      const a = copy[i] as T;
      copy[i] = copy[j] as T;
      copy[j] = a;
    }
    return copy;
  }

  for (const name of names) {
    it(`${name}: shuffled file order, twice, and both SHA-256 routes give the same JSON text`, async () => {
      const files = loadFixtureFiles(join(FIXTURES_ROOT, name));
      const first = JSON.stringify(await run(files, nodeHash));
      const second = JSON.stringify(await run(files, nodeHash));
      const reversed = JSON.stringify(await run([...files].reverse(), nodeHash));
      const mixed = JSON.stringify(await run(shuffled(files, 7), webCryptoHash));
      expect(second).toBe(first);
      expect(reversed).toBe(first);
      expect(mixed).toBe(first);
    });

    it(`${name}: no line of source text appears in the JSON`, async () => {
      const files = loadFixtureFiles(join(FIXTURES_ROOT, name));
      const json = JSON.stringify(await run(files));
      for (const f of files) {
        for (const line of f.text.split("\n")) {
          const trimmed = line.trim();
          // Skip short lines and lines that are only a specifier the records legitimately hold.
          if (trimmed.length < 12) continue;
          expect(json, `line "${trimmed}" of ${f.path}`).not.toContain(JSON.stringify(trimmed).slice(1, -1));
        }
      }
    });
  }

  it("gives the same JSON text for the same input called twice on one set", async () => {
    const files = loadFixtureFiles(join(FIXTURES_ROOT, "kinds"));
    const selected = selectSources(files, "kinds", DEFAULT_ANALYSIS_OPTIONS);
    if (!selected.ok) throw new Error("selection failed");
    const a = JSON.stringify(await analyze(selected.sourceSet, DEFAULT_ANALYSIS_OPTIONS, nodeHash, undefined, selected.diagnostics));
    const b = JSON.stringify(await analyze(selected.sourceSet, DEFAULT_ANALYSIS_OPTIONS, nodeHash, undefined, selected.diagnostics));
    expect(b).toBe(a);
  });
});
