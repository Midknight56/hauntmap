import { beforeAll, describe, expect, it } from "vitest";
import { validateComparison, validateInvestigation } from "../../src/contracts/validate";
import type { Investigation } from "../../src/contracts/types";
import { appInvestigation, DEMO_RELATION_ID, packedFiles } from "./appPath";

// The validator table of design.md. The first error of a failing check is exact where the table
// gives the whole string, and starts with `<path> must be ` where it gives only the field.

let valid: Investigation;
beforeAll(async () => {
  valid = await appInvestigation(packedFiles("manor/before"), "manor/before");
});

function clone(): Record<string, unknown> {
  return structuredClone(valid) as unknown as Record<string, unknown>;
}
function errorsOf(value: unknown): string[] {
  const result = validateInvestigation(value);
  if (result.ok) throw new Error("expected the validator to reject the value");
  return result.errors;
}

describe("validateInvestigation: accepts", () => {
  it("a real analyze output (40 modules, 72 imports)", () => {
    expect(valid.modules).toHaveLength(40);
    expect(validateInvestigation(valid)).toEqual({ ok: true });
  });

  it("an empty investigation with the live label", () => {
    expect(validateInvestigation({ ...clone(), modules: [], imports: [], diagnostics: [] })).toEqual({ ok: true });
  });
});

describe("validateInvestigation: document, version and mode", () => {
  it.each([[null], [[]], ["text"], [3]])("%j is not a JSON object", (value) => {
    expect(errorsOf(value)[0]).toBe("document must be a JSON object");
  });

  it("schemaVersion must be 1, and says what it found", () => {
    expect(errorsOf({ ...clone(), schemaVersion: 2 })[0]).toBe("schemaVersion must be 1 (found 2)");
    const missing = clone();
    delete missing.schemaVersion;
    expect(errorsOf(missing)[0]).toBe("schemaVersion must be 1 (found missing)");
    expect(errorsOf({ ...clone(), schemaVersion: "1" })[0]).toBe('schemaVersion must be 1 (found "1")');
  });

  it("resolverMode must be documented-source-subset, and says what it found", () => {
    expect(errorsOf({ ...clone(), resolverMode: "typescript" })[0]).toBe('resolverMode must be "documented-source-subset" (found "typescript")');
  });

  it("sourceLabel must be a string", () => {
    expect(errorsOf({ ...clone(), sourceLabel: 4 })[0]).toBe("sourceLabel must be a string");
  });

  it.each(["modules", "imports", "diagnostics"])("%s must be an array", (field) => {
    expect(errorsOf({ ...clone(), [field]: {} })[0]).toBe(`${field} must be an array`);
  });
});

describe("validateInvestigation: modules", () => {
  function withModule(change: (module: Record<string, unknown>) => void): unknown {
    const value = clone();
    change((value.modules as Record<string, unknown>[])[3] as Record<string, unknown>);
    return value;
  }

  it.each([
    ["id", (m: Record<string, unknown>) => (m.id = 5)],
    ["sourceHash", (m: Record<string, unknown>) => (m.sourceHash = "ABC")],
    ["sourceHash", (m: Record<string, unknown>) => (m.sourceHash = "a".repeat(63))],
    ["language", (m: Record<string, unknown>) => (m.language = "py")],
    ["parseStatus", (m: Record<string, unknown>) => (m.parseStatus = "maybe")],
  ])("modules[3].%s is checked", (field, change) => {
    expect(errorsOf(withModule(change))[0]?.startsWith(`modules[3].${field} must be `)).toBe(true);
  });

  it("a duplicate module ID names both indexes", () => {
    const value = clone();
    const modules = value.modules as Record<string, unknown>[];
    (modules[5] as Record<string, unknown>).id = (modules[2] as Record<string, unknown>).id;
    expect(errorsOf(value)[0]).toBe("modules[5].id duplicates modules[2].id");
  });
});

describe("validateInvestigation: imports", () => {
  function withImport(index: number, change: (record: Record<string, unknown>) => void): unknown {
    const value = clone();
    change((value.imports as Record<string, unknown>[])[index] as Record<string, unknown>);
    return value;
  }

  it.each([
    ["occurrenceId", (r: Record<string, unknown>) => (r.occurrenceId = "not json")],
    ["occurrenceId", (r: Record<string, unknown>) => (r.occurrenceId = JSON.stringify(["only", 1]))],
    ["relationId", (r: Record<string, unknown>) => (r.relationId = 7)],
    ["relationId", (r: Record<string, unknown>) => (r.relationId = JSON.stringify(["other.ts", ["local", "x.ts"], "import", "value"]))],
    ["from", (r: Record<string, unknown>) => (r.from = "src/not-a-module.ts")],
    ["specifier", (r: Record<string, unknown>) => (r.specifier = 1)],
    ["syntaxKind", (r: Record<string, unknown>) => (r.syntaxKind = "require")],
    ["dependencyKind", (r: Record<string, unknown>) => (r.dependencyKind = "both")],
    ["resolution", (r: Record<string, unknown>) => (r.resolution = "guessed")],
    ["line", (r: Record<string, unknown>) => (r.line = 0)],
    ["column", (r: Record<string, unknown>) => (r.column = 1.5)],
    ["reason", (r: Record<string, unknown>) => (r.reason = "because")],
  ])("imports[2].%s is checked", (field, change) => {
    expect(errorsOf(withImport(2, change))[0]?.startsWith(`imports[2].${field} must be `)).toBe(true);
  });

  it("to must be null or a module ID, and local resolution holds exactly when to is not null", () => {
    expect(errorsOf(withImport(2, (r) => (r.to = "src/ghost.ts")))[0]?.startsWith("imports[2].to must be ")).toBe(true);
    expect(errorsOf(withImport(2, (r) => (r.to = null)))[0]?.startsWith("imports[2].")).toBe(true);
  });
});

describe("validateInvestigation: options and source text", () => {
  it("options fields are checked", () => {
    const value = clone();
    (value.options as Record<string, unknown>).preset = "fast";
    expect(errorsOf(value)[0]?.startsWith("options.preset must be ")).toBe(true);
    const flag = clone();
    (flag.options as Record<string, unknown>).jsToTsFallback = false;
    expect(errorsOf(flag)[0]?.startsWith("options.jsToTsFallback must be ")).toBe(true);
    const missing = clone();
    delete (missing.options as Record<string, unknown>).maxFiles;
    expect(errorsOf(missing)[0]?.startsWith("options.maxFiles must be ")).toBe(true);
  });

  it("source text anywhere is rejected", () => {
    const imports = clone();
    ((imports.imports as Record<string, unknown>[])[4] as Record<string, unknown>).text = "import x";
    expect(errorsOf(imports)).toContain("imports[4] must not carry source text");
    const modules = clone();
    ((modules.modules as Record<string, unknown>[])[1] as Record<string, unknown>).text = "export {}";
    expect(errorsOf(modules)).toContain("modules[1] must not carry source text");
  });

  it("collects every error, in document order", () => {
    const value = { ...clone(), schemaVersion: 3, sourceLabel: 1 };
    const errors = errorsOf(value);
    expect(errors.slice(0, 2)).toEqual(["schemaVersion must be 1 (found 3)", "sourceLabel must be a string"]);
  });
});

describe("validateComparison", () => {
  const relation = (id: string) => ({ relationId: id, from: "a.ts", to: "b.ts", specifier: "./b", syntaxKind: "import", dependencyKind: "value", resolution: "local" });
  const good = () => ({
    schemaVersion: 1,
    preset: "static-value",
    before: { label: "live:public/demo/manor/before", moduleCount: 40, relationCount: 72 },
    after: { label: "live:haunts/manor", moduleCount: 40, relationCount: 71 },
    addedModules: [],
    removedModules: [],
    changedModules: ["src/notifications/receipt.ts"],
    addedRelations: [],
    removedRelations: [relation(DEMO_RELATION_ID)],
    cyclicComponentsBefore: 1,
    cyclicComponentsAfter: 0,
  });

  it("accepts a hand-built result (task 9 replaces it with one from compareInvestigations)", () => {
    expect(validateComparison(good())).toEqual({ ok: true });
  });

  it("rejects a wrong schema version, preset, label and counts", () => {
    expect(validateComparison({ ...good(), schemaVersion: 2 })).toMatchObject({ ok: false });
    expect(validateComparison({ ...good(), preset: "type-inclusive" })).toMatchObject({ ok: false });
    expect(validateComparison({ ...good(), before: { label: 3, moduleCount: 1, relationCount: 1 } })).toMatchObject({ ok: false });
    expect(validateComparison({ ...good(), after: { label: "x", moduleCount: -1, relationCount: 1 } })).toMatchObject({ ok: false });
    expect(validateComparison({ ...good(), cyclicComponentsBefore: 1.5 })).toMatchObject({ ok: false });
  });

  it("rejects unsorted module lists and unsorted relation lists", () => {
    const modules = validateComparison({ ...good(), changedModules: ["b.ts", "a.ts"] });
    expect(modules.ok).toBe(false);
    if (!modules.ok) expect(modules.errors[0]?.startsWith("changedModules must be ")).toBe(true);
    const relations = validateComparison({ ...good(), removedRelations: [relation("[\"b\"]"), relation("[\"a\"]")] });
    expect(relations.ok).toBe(false);
    if (!relations.ok) expect(relations.errors[0]?.startsWith("removedRelations must be ")).toBe(true);
  });

  it("rejects a relation reference with a bad enum", () => {
    const bad = { ...good(), removedRelations: [{ ...relation(DEMO_RELATION_ID), syntaxKind: "require" }] };
    const result = validateComparison(bad);
    expect(result.ok).toBe(false);
  });

  it("is not satisfied by a non object", () => {
    expect(validateComparison(null)).toMatchObject({ ok: false });
  });
});
