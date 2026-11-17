import { describe, expect, it } from "vitest";
import { findCycles, trace } from "../../src/analysis";
import { analysisApi } from "../../src/features/investigation/analysisApi";
import { boundaryRelations, drawnRelations, wingOf, wingsOf } from "../../src/features/investigation/wings";
import type { ImportRecord } from "../../src/contracts/types";
import { fixture } from "./fixtureFiles";

describe("analysisApi", () => {
  it("cycles and trace are the functions of src/analysis", () => {
    const cycle = fixture("cycle");
    expect(analysisApi.cycles(cycle, "static-value")).toEqual(findCycles(cycle, "static-value"));
    const triad = fixture("triad");
    expect(analysisApi.trace(triad, "src/c.ts", "imported-by", "static-value")).toEqual(
      trace(triad, "src/c.ts", "imported-by", "static-value"),
    );
  });

  it("trace throws an Error naming an unknown origin", () => {
    expect(() => analysisApi.trace(fixture("triad"), "src/nope.ts", "imported-by", "static-value")).toThrow(/src\/nope\.ts/);
  });

  it("judges the three presets on mixed-presets.json", () => {
    const [typeReexport, mixed, dynamic] = fixture("mixed-presets").imports as [ImportRecord, ImportRecord, ImportRecord];
    const admitted = (preset: "static-value" | "type-inclusive" | "dynamic-inclusive") =>
      [typeReexport, mixed, dynamic].filter((r) => analysisApi.inPreset(r, preset)).map((r) => r.specifier);
    expect(admitted("static-value")).toEqual(["./m"]);
    expect(admitted("type-inclusive")).toEqual(["./x", "./m"]);
    expect(admitted("dynamic-inclusive")).toEqual(["./m", "./d"]);
  });

  it("presetMembership names the first preset that admits the record", () => {
    const [typeReexport, mixed, dynamic] = fixture("mixed-presets").imports as [ImportRecord, ImportRecord, ImportRecord];
    expect(analysisApi.presetMembership(mixed)).toBe("static-value");
    expect(analysisApi.presetMembership(typeReexport)).toBe("type-inclusive");
    expect(analysisApi.presetMembership(dynamic)).toBe("dynamic-inclusive");
  });

  it("judges a boundary record by its kinds, not by its resolution", () => {
    const records = fixture("boundary").imports;
    expect(records.map((r) => r.resolution)).toEqual(["external", "unresolved", "unresolved"]);
    for (const record of records) expect(analysisApi.inPreset(record, "static-value")).toBe(true);
    for (const record of records) expect(analysisApi.presetMembership(record)).toBe("static-value");
    const typeOnlyBoundary: ImportRecord = { ...records[0]!, dependencyKind: "type" };
    expect(analysisApi.inPreset(typeOnlyBoundary, "static-value")).toBe(false);
    expect(analysisApi.inPreset(typeOnlyBoundary, "type-inclusive")).toBe(true);
  });
});

describe("wings", () => {
  it("wingOf is the directory of the module, or (root)", () => {
    expect(wingOf("src/orders/checkout.ts")).toBe("src/orders");
    expect(wingOf("index.ts")).toBe("(root)");
    expect(wingOf("a/b/c/d.ts")).toBe("a/b/c");
  });

  it("wingsOf groups and sorts", () => {
    expect(wingsOf(fixture("two-wings"))).toEqual([
      { wing: "src/orders", moduleIds: ["src/orders/a.ts", "src/orders/b.ts", "src/orders/c.ts"] },
      { wing: "src/payments", moduleIds: ["src/payments/p.ts", "src/payments/q.ts"] },
    ]);
  });

  it("drawnRelations keeps one record per relation ID that the preset admits", () => {
    const mixed = fixture("mixed-presets");
    expect(drawnRelations(mixed, "static-value", analysisApi).map((r) => r.specifier)).toEqual(["./m"]);
    expect(drawnRelations(mixed, "type-inclusive", analysisApi).map((r) => r.specifier).sort()).toEqual(["./m", "./x"]);
    expect(drawnRelations(mixed, "dynamic-inclusive", analysisApi).map((r) => r.specifier).sort()).toEqual(["./d", "./m"]);
  });

  it("drawnRelations collapses a repeated import and needs both ends", () => {
    const triad = fixture("triad");
    const first = triad.imports[0]!;
    const repeated: ImportRecord = { ...first, line: 5, occurrenceId: "other" };
    const withRepeat = { ...triad, imports: [repeated, ...triad.imports] };
    const drawn = drawnRelations(withRepeat, "static-value", analysisApi);
    expect(drawn).toHaveLength(3);
    expect(drawn.find((r) => r.relationId === first.relationId)?.line).toBe(1);
    const missingEnd = { ...triad, modules: triad.modules.filter((m) => m.id !== "src/c.ts") };
    expect(drawnRelations(missingEnd, "static-value", analysisApi).map((r) => r.to)).toEqual(["src/b.ts", "src/b.ts"]);
  });

  it("boundaryRelations lists the external and unresolved relations the preset admits", () => {
    expect(boundaryRelations(fixture("boundary"), "static-value", analysisApi).map((r) => r.specifier).sort()).toEqual([
      "./ghosts/missing",
      "@/lib/format",
      "zod",
    ]);
    expect(boundaryRelations(fixture("triad"), "static-value", analysisApi)).toEqual([]);
  });
});
