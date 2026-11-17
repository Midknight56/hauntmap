import { describe, expect, it } from "vitest";
import { validateInvestigation } from "../../src/contracts/validate";
import { analyzeTool, createContext, cyclesTool, PRESETS, whoImportsTool } from "../../packages/hauntmap-mcp/src/tools";
import { DEMO_RELATION_ID, expectedManor, REPO } from "./appPath";

// Requirements 3.2 to 3.6 on haunts/manor with the real src/analysis. Facts come from
// public/demo/manor/before/expected.json, never from the code under test.

const expected = expectedManor();
const ctx = createContext(REPO);

function hasTextProperty(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasTextProperty);
  if (value !== null && typeof value === "object") return Object.entries(value).some(([key, child]) => key === "text" || hasTextProperty(child));
  return false;
}

describe("PRESETS", () => {
  it("lists the three presets in the order of the contracts", () => {
    expect(PRESETS).toEqual(["static-value", "type-inclusive", "dynamic-inclusive"]);
  });
});

describe("analyze (3.2)", () => {
  it("returns a validated investigation of haunts/manor with the live label, no text and the requested preset", async () => {
    const result = await analyzeTool(ctx, { root: "haunts/manor" });
    if (!result.ok) throw new Error(result.error.message);
    expect(validateInvestigation(result.value)).toEqual({ ok: true });
    expect(result.value.sourceLabel).toBe("live:haunts/manor");
    expect(result.value.modules.map((m) => m.id)).toEqual(expected.modules.map((m) => m.id).sort());
    expect(result.value.imports).toHaveLength(expected.imports.length);
    expect(result.value.diagnostics).toHaveLength(expected.diagnostics.length);
    expect(result.value.options.preset).toBe("static-value");
    expect(hasTextProperty(result.value)).toBe(false);
    expect(JSON.stringify(result.value)).not.toContain("\\nimport ");
  });

  it("passes a requested preset through to the options", async () => {
    const result = await analyzeTool(ctx, { root: "haunts/manor", preset: "type-inclusive" });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.options.preset).toBe("type-inclusive");
  });
});

describe("cycles (3.3)", () => {
  it("returns the one component of the manor under static-value, with the demo relation first in its witness", async () => {
    const result = await cyclesTool(ctx, { root: "haunts/manor", preset: "static-value" });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.preset).toBe("static-value");
    expect(result.value.components).toHaveLength(expected.cycles["static-value"].length);
    expect(result.value.components[0]?.members).toEqual(expected.cycles["static-value"][0]?.members);
    expect(result.value.components[0]?.witness.relationIds[0]).toBe(DEMO_RELATION_ID);
    expect(result.value.components[0]?.witness.relationIds).toEqual(expected.cycles["static-value"][0]?.witness.relationIds);
  });

  it("defaults to static-value and reports the type-only cycle only under type-inclusive", async () => {
    const byDefault = await cyclesTool(ctx, { root: "haunts/manor" });
    const typed = await cyclesTool(ctx, { root: "haunts/manor", preset: "type-inclusive" });
    if (!byDefault.ok || !typed.ok) throw new Error("cycles failed");
    expect(byDefault.value.preset).toBe("static-value");
    expect(typed.value.components.map((c) => c.members)).toEqual(expected.cycles["type-inclusive"].map((c) => c.members));
  });
});

describe("who_imports (3.4)", () => {
  it("returns the importers of src/orders/checkout.ts", async () => {
    const result = await whoImportsTool(ctx, { root: "haunts/manor", module: "src/orders/checkout.ts" });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.origin).toBe("src/orders/checkout.ts");
    expect(result.value.direction).toBe("imported-by");
    expect(result.value.preset).toBe("static-value");
    const importers = expected.imports.filter((i) => i.to === "src/orders/checkout.ts" && i.syntaxKind === "import" && i.dependencyKind !== "type").map((i) => i.from);
    expect(result.value.direct).toEqual([...new Set(importers)].sort());
    expect(result.value.direct).toEqual(["src/notifications/receipt.ts"]);
  });
});

describe("errors (3.5, 3.6)", () => {
  it("module-not-found names the module and the root", async () => {
    expect(await whoImportsTool(ctx, { root: "haunts/manor", module: "src/nope.ts" })).toEqual({
      ok: false,
      error: {
        code: "module-not-found",
        message: 'Module "src/nope.ts" is not in the analysis of "haunts/manor"; module IDs are paths relative to the root, such as src/orders/checkout.ts.',
      },
    });
  });

  it("invalid-preset names the value", async () => {
    expect(await analyzeTool(ctx, { root: "haunts/manor", preset: "bogus" })).toEqual({
      ok: false,
      error: { code: "invalid-preset", message: 'Preset "bogus" is not one of static-value, type-inclusive, dynamic-inclusive.' },
    });
  });

  it("invalid-arguments names the argument", async () => {
    for (const args of [{}, { root: 3 }, null, "haunts/manor"]) {
      expect(await analyzeTool(ctx, args)).toEqual({ ok: false, error: { code: "invalid-arguments", message: 'Argument "root" must be a string.' } });
    }
    expect(await whoImportsTool(ctx, { root: "haunts/manor" })).toEqual({ ok: false, error: { code: "invalid-arguments", message: 'Argument "module" must be a string.' } });
  });

  it("root errors keep their codes", async () => {
    const outside = await analyzeTool(ctx, { root: ".." });
    expect(outside.ok === false && outside.error.code).toBe("root-outside-workspace");
    const missing = await analyzeTool(ctx, { root: "haunts/missing" });
    expect(missing).toEqual({ ok: false, error: { code: "root-not-found", message: 'Root "haunts/missing" does not exist or is not a directory.' } });
  });

  it("an analysis that throws becomes analysis-failed without a stack", async () => {
    const throwing = createContext(REPO, {
      analysis: {
        ...ctx.analysis,
        analyze: async () => {
          throw new Error("boom");
        },
      },
    });
    const result = await analyzeTool(throwing, { root: "haunts/manor" });
    expect(result).toEqual({ ok: false, error: { code: "analysis-failed", message: 'Analysis of "haunts/manor" failed: boom.' } });
    expect(JSON.stringify(result)).not.toContain("    at ");
  });

  it("an output that fails validation becomes analysis-failed with the first error", async () => {
    const failing = createContext(REPO, {
      validate: { investigation: () => ({ ok: false, errors: ["sourceLabel must be a string"] }), comparison: () => ({ ok: true }) },
      log: () => undefined,
    });
    expect(await analyzeTool(failing, { root: "haunts/manor" })).toEqual({
      ok: false,
      error: { code: "analysis-failed", message: "internal error, output failed validation: sourceLabel must be a string" },
    });
  });
});
