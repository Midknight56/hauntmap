import { createHash, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findCycles } from "../../src/analysis/graph/cycles";
import { trace } from "../../src/analysis/graph/trace";
import { analyze } from "../../src/analysis/parser/analyze";
import { selectSources } from "../../src/analysis/parser/select";
import { DEFAULT_ANALYSIS_OPTIONS } from "../../src/contracts/options";
import type { CyclicComponent, Diagnostic, ImportRecord, Investigation, Preset, SourceFile } from "../../src/contracts/types";
import { FIXTURES_ROOT, loadFixtureFiles } from "./load";

// The bundled samples live under public/demo. Their expected.json files are written by hand.
const DEMO_ROOT = join(FIXTURES_ROOT, "..", "..", "public", "demo");
const PRESETS: Preset[] = ["static-value", "type-inclusive", "dynamic-inclusive"];

const nodeHash = (text: string): Promise<string> => Promise.resolve(createHash("sha256").update(text, "utf8").digest("hex"));
const webHash = async (text: string): Promise<string> => {
  const digest = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

interface ExpectedImport {
  from: string;
  specifier: string;
  syntaxKind: string;
  dependencyKind: string;
  resolution: string;
  to: string | null;
  reason?: string;
  line: number;
  column: number;
}

interface Expected {
  modules: { id: string; language: string; parseStatus: string }[];
  imports: ExpectedImport[];
  diagnostics: Record<string, unknown>[];
  cycles: Record<Preset, CyclicComponent[]>;
  wings?: Record<string, number>;
  receiptToCheckout?: { specifier: string; importLine: number; useLine: number };
  removedRelations?: string[];
  addedRelations?: string[];
  changedModules?: string[];
}

function sampleDir(name: string): string {
  return join(DEMO_ROOT, ...name.split("/"));
}

function readExpected(name: string): Expected {
  return JSON.parse(readFileSync(join(sampleDir(name), "expected.json"), "utf8")) as Expected;
}

function sampleFiles(name: string): SourceFile[] {
  return loadFixtureFiles(sampleDir(name));
}

async function analyzeSample(name: string, files: SourceFile[] = sampleFiles(name), hash = nodeHash): Promise<Investigation> {
  const selected = selectSources(files, name, DEFAULT_ANALYSIS_OPTIONS);
  if (!selected.ok) throw new Error(`selection failed for ${name}`);
  return analyze(selected.sourceSet, DEFAULT_ANALYSIS_OPTIONS, hash, undefined, selected.diagnostics);
}

function byOccurrence(a: ExpectedImport, b: ExpectedImport): number {
  const x = JSON.stringify([a.from, a.line, a.column, a.specifier]);
  const y = JSON.stringify([b.from, b.line, b.column, b.specifier]);
  return x < y ? -1 : x > y ? 1 : 0;
}

function pickImport(record: ImportRecord): ExpectedImport {
  const picked: ExpectedImport = {
    from: record.from,
    specifier: record.specifier,
    syntaxKind: record.syntaxKind,
    dependencyKind: record.dependencyKind,
    resolution: record.resolution,
    to: record.to,
    line: record.line,
    column: record.column,
  };
  if (record.reason !== undefined) picked.reason = record.reason;
  return picked;
}

function pickDiagnostic(d: Diagnostic): Record<string, unknown> {
  const picked: Record<string, unknown> = { code: d.code };
  if (d.module !== undefined) picked.module = d.module;
  if (d.line !== undefined) picked.line = d.line;
  if (d.column !== undefined) picked.column = d.column;
  if (d.specifier !== undefined) picked.specifier = d.specifier;
  return picked;
}

function relationIds(investigation: Investigation): Set<string> {
  return new Set(investigation.imports.map((record) => record.relationId));
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

const RECEIPT = "src/notifications/receipt.ts";
const CHECKOUT = "src/orders/checkout.ts";
const CHARGE = "src/payments/charge.ts";
const SUMMARY = "src/orders/summary.ts";
const REMOVED = JSON.stringify([RECEIPT, ["local", CHECKOUT], "import", "value"]);
const ADDED = JSON.stringify([RECEIPT, ["local", SUMMARY], "import", "value"]);

const SAMPLES: [string, number][] = [
  ["manor/before", 40],
  ["manor/after", 40],
  ["annex", 18],
];

for (const [name, moduleCount] of SAMPLES) {
  describe(`${name} against its expected.json`, () => {
    const expected = readExpected(name);

    it("has the modules of expected.json, with a SHA-256 hash of each text", async () => {
      const investigation = await analyzeSample(name);
      expect(investigation.modules.map((m) => ({ id: m.id, language: m.language, parseStatus: m.parseStatus }))).toEqual(
        expected.modules,
      );
      const files = sampleFiles(name);
      for (const record of investigation.modules) {
        const file = files.find((f) => f.path === record.id);
        expect(record.sourceHash).toBe(createHash("sha256").update(file?.text ?? "", "utf8").digest("hex"));
      }
    });

    it("has the imports of expected.json with both ids built from the formulas", async () => {
      const investigation = await analyzeSample(name);
      const wanted = [...expected.imports].sort(byOccurrence);
      expect(investigation.imports.map(pickImport)).toEqual(wanted);
      investigation.imports.forEach((record, position) => {
        const w = wanted[position] as ExpectedImport;
        expect(record.occurrenceId).toBe(JSON.stringify([w.from, w.line, w.column, w.specifier]));
        const targetKey = w.resolution === "local" ? ["local", w.to] : [w.resolution, w.specifier];
        expect(record.relationId).toBe(JSON.stringify([w.from, targetKey, w.syntaxKind, w.dependencyKind]));
      });
    });

    it("has the diagnostics of expected.json", async () => {
      const investigation = await analyzeSample(name);
      expect(investigation.diagnostics.map(pickDiagnostic)).toEqual(expected.diagnostics);
    });

    for (const preset of PRESETS) {
      it(`has the cyclic components of expected.json under ${preset}`, async () => {
        const report = findCycles(await analyzeSample(name), preset);
        expect(report.components).toEqual(expected.cycles[preset]);
      });
    }

    it(`has exactly ${moduleCount} modules, all parsed`, async () => {
      const investigation = await analyzeSample(name);
      expect(investigation.modules).toHaveLength(moduleCount);
      expect(investigation.modules.every((m) => m.parseStatus === "ok")).toBe(true);
    });

    it("gives the same JSON for a shuffled file list and for Web Crypto against node:crypto", async () => {
      const files = sampleFiles(name);
      const first = JSON.stringify(await analyzeSample(name, files, nodeHash));
      const second = JSON.stringify(await analyzeSample(name, [...files].reverse(), webHash));
      expect(second).toBe(first);
      expect(first).not.toContain("export function");
      expect(first).not.toContain("import {");
    });
  });
}

describe("manor/before facts of requirement 8.1", () => {
  const expected = readExpected("manor/before");

  it("has one component under static-value, with the three members of the checkout loop", async () => {
    const report = findCycles(await analyzeSample("manor/before"), "static-value");
    expect(report.components).toHaveLength(1);
    expect(report.components[0]?.members).toEqual([RECEIPT, CHECKOUT, CHARGE]);
  });

  it("has the type only re-export cycle under type-inclusive alone, and none under dynamic-inclusive beyond the static one", async () => {
    const investigation = await analyzeSample("manor/before");
    expect(findCycles(investigation, "type-inclusive").components.map((c) => c.members)).toEqual([
      ["src/catalog/price.ts", "src/catalog/product.ts"],
      [RECEIPT, CHECKOUT, CHARGE],
    ]);
    expect(findCycles(investigation, "dynamic-inclusive").components.map((c) => c.members)).toEqual([[RECEIPT, CHECKOUT, CHARGE]]);
  });

  it("has one external, one absent file, one mixed, one literal dynamic import, one type only re-export, and nothing else unusual", async () => {
    const investigation = await analyzeSample("manor/before");
    const imports = investigation.imports;
    expect(imports.filter((i) => i.resolution === "external").map((i) => i.specifier)).toEqual(["nanoid"]);
    expect(imports.filter((i) => i.resolution === "unresolved").map((i) => [i.specifier, i.reason])).toEqual([["./synonyms", "absent-file"]]);
    expect(imports.filter((i) => i.resolution === "unsupported")).toEqual([]);
    expect(imports.filter((i) => i.dependencyKind === "mixed").map((i) => i.from)).toEqual(["src/orders/totals.ts"]);
    expect(imports.filter((i) => i.syntaxKind === "dynamic-literal").map((i) => i.specifier)).toEqual(["../payments/invoice"]);
    expect(imports.filter((i) => i.dependencyKind === "type").map((i) => [i.from, i.syntaxKind])).toEqual([["src/catalog/product.ts", "re-export"]]);
    expect(investigation.diagnostics.map((d) => d.code)).toEqual(["unresolved"]);
  });

  it("lists the wings with their module counts, and they add up to the 40 modules", async () => {
    const investigation = await analyzeSample("manor/before");
    const counts: Record<string, number> = {};
    for (const record of investigation.modules) {
      const wing = record.id.split("/")[1] as string;
      counts[wing] = (counts[wing] ?? 0) + 1;
    }
    expect(expected.wings).toEqual(counts);
    expect(Object.values(counts).reduce((sum, n) => sum + n, 0)).toBe(40);
  });

  it("has receipt.ts importing one binding from checkout.ts in one statement, used in one statement", () => {
    const text = sampleFiles("manor/before").find((f) => f.path === RECEIPT)?.text ?? "";
    const lines = text.split("\n");
    const listed = expected.receiptToCheckout;
    expect(listed?.specifier).toBe("../orders/checkout");
    const importLines = lines.map((l, i) => [l, i + 1] as const).filter(([l]) => l.includes('"../orders/checkout"'));
    expect(importLines.map(([, n]) => n)).toEqual([listed?.importLine]);
    expect(importLines[0]?.[0]).toBe('import { describeOrder } from "../orders/checkout";');
    const users = lines.map((l, i) => [l, i + 1] as const).filter(([l]) => l.includes("describeOrder") && !l.startsWith("import"));
    expect(users.map(([, n]) => n)).toEqual([listed?.useLine]);
    expect(users[0]?.[0].trim().endsWith(";")).toBe(true);
  });

  it("has summary.ts with no import path to receipt.ts", async () => {
    const result = trace(await analyzeSample("manor/before"), SUMMARY, "imports", "dynamic-inclusive");
    expect(result.visited).not.toContain(RECEIPT);
    expect(result.visited).toContain("src/orders/totals.ts");
  });
});

describe("manor/after against manor/before (requirement 8.2)", () => {
  it("has the same 40 module ids", async () => {
    const before = await analyzeSample("manor/before");
    const after = await analyzeSample("manor/after");
    expect(after.modules.map((m) => m.id)).toEqual(before.modules.map((m) => m.id));
  });

  it("has exactly one removed relation and one added relation", async () => {
    const before = relationIds(await analyzeSample("manor/before"));
    const after = relationIds(await analyzeSample("manor/after"));
    expect(sorted([...before].filter((id) => !after.has(id)))).toEqual([REMOVED]);
    expect(sorted([...after].filter((id) => !before.has(id)))).toEqual([ADDED]);
    const expected = readExpected("manor/after");
    expect(expected.removedRelations).toEqual([REMOVED]);
    expect(expected.addedRelations).toEqual([ADDED]);
  });

  it("has exactly receipt.ts and checkout.ts with a different sourceHash", async () => {
    const before = await analyzeSample("manor/before");
    const after = await analyzeSample("manor/after");
    const changed = after.modules.filter((m, i) => m.sourceHash !== before.modules[i]?.sourceHash).map((m) => m.id);
    expect(sorted(changed)).toEqual([RECEIPT, CHECKOUT]);
    expect(readExpected("manor/after").changedModules).toEqual([RECEIPT, CHECKOUT]);
  });

  it("changes checkout.ts only by one comment line above its first import", () => {
    const before = sampleFiles("manor/before").find((f) => f.path === CHECKOUT)?.text ?? "";
    const after = sampleFiles("manor/after").find((f) => f.path === CHECKOUT)?.text ?? "";
    const lines = after.split("\n");
    expect(lines[0]?.startsWith("//")).toBe(true);
    expect(lines.slice(1).join("\n")).toBe(before);
  });

  it("has one component under static-value before and none after", async () => {
    expect(findCycles(await analyzeSample("manor/before"), "static-value").components).toHaveLength(1);
    expect(findCycles(await analyzeSample("manor/after"), "static-value").components).toHaveLength(0);
  });

  it("keeps the diagnostics and the other relations of before", async () => {
    const before = await analyzeSample("manor/before");
    const after = await analyzeSample("manor/after");
    expect(after.diagnostics.map(pickDiagnostic)).toEqual(before.diagnostics.map(pickDiagnostic));
    expect(after.imports.length).toBe(before.imports.length);
  });
});

describe("annex facts of requirement 8.3", () => {
  it("has exactly three cyclic components under static-value, of sizes 2 and 3 and a self-loop, sharing no module", async () => {
    const report = findCycles(await analyzeSample("annex"), "static-value");
    expect(report.components.map((c) => c.members)).toEqual([
      ["models/account.js", "models/user.js"],
      ["util/events.js"],
      ["views/widgets/cell.js", "views/widgets/row.js", "views/widgets/table.js"],
    ]);
    const all = report.components.flatMap((c) => c.members);
    expect(new Set(all).size).toBe(all.length);
    expect(report.components.map((c) => c.witness.modules.length)).toEqual([2, 1, 3]);
  });

  it("has exactly two alias-not-configured diagnostics, for @/lib/format and ~/config/env, and no other unresolved or external import", async () => {
    const investigation = await analyzeSample("annex");
    expect(investigation.diagnostics.map((d) => [d.code, d.specifier])).toEqual([
      ["unresolved", "~/config/env"],
      ["unresolved", "@/lib/format"],
    ]);
    expect(investigation.imports.filter((i) => i.resolution !== "local").map((i) => [i.specifier, i.resolution, i.reason])).toEqual([
      ["~/config/env", "unresolved", "alias-not-configured"],
      ["@/lib/format", "unresolved", "alias-not-configured"],
    ]);
  });

  it("is the same under the other two presets", async () => {
    const investigation = await analyzeSample("annex");
    const base = findCycles(investigation, "static-value").components;
    expect(findCycles(investigation, "type-inclusive").components).toEqual(base);
    expect(findCycles(investigation, "dynamic-inclusive").components).toEqual(base);
  });
});