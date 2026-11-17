import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findCycles, trace } from "../../src/analysis";
import type { Investigation } from "../../src/contracts/types";
import { validateInvestigation } from "../../src/contracts/validate";
import { perf1000, perf200, wide } from "./generators";
import { occurrenceId, relationId, relationIdFor } from "./ids";

const HERE = dirname(fileURLToPath(import.meta.url));

function fixture(name: string): Investigation {
  return JSON.parse(readFileSync(join(HERE, "fixtures", `${name}.json`), "utf8")) as Investigation;
}

const COUNTS: Record<string, { modules: number; relations: number }> = {
  triad: { modules: 4, relations: 3 },
  escaped: { modules: 1, relations: 1 },
  boundary: { modules: 1, relations: 3 },
  cycle: { modules: 3, relations: 3 },
  "two-wings": { modules: 5, relations: 3 },
  "mixed-presets": { modules: 4, relations: 3 },
  "long-name": { modules: 1, relations: 0 },
};

describe("ids helpers", () => {
  it("re-export the analysis ID builders and build the local key", () => {
    expect(relationIdFor("src/a.ts", "src/b.ts", "import", "value")).toBe(
      relationId("src/a.ts", ["local", "src/b.ts"], "import", "value"),
    );
    expect(occurrenceId("src/a.ts", 1, 1, "./b")).toBe(JSON.stringify(["src/a.ts", 1, 1, "./b"]));
  });
});

describe("hand-authored fixtures", () => {
  for (const [name, count] of Object.entries(COUNTS)) {
    it(`${name}.json has schemaVersion 1, ${count.modules} modules and ${count.relations} imports`, () => {
      const inv = fixture(name);
      expect(inv.schemaVersion).toBe(1);
      expect(inv.resolverMode).toBe("documented-source-subset");
      expect(inv.modules).toHaveLength(count.modules);
      expect(inv.imports).toHaveLength(count.relations);
      expect(validateInvestigation(inv)).toEqual({ ok: true });
    });

    it(`${name}.json carries IDs equal to the analysis ID builders`, () => {
      const inv = fixture(name);
      for (const record of inv.imports) {
        const key: [string, string] =
          record.resolution === "local" && record.to !== null ? ["local", record.to] : [record.resolution, record.specifier];
        expect(record.relationId).toBe(relationId(record.from, key, record.syntaxKind, record.dependencyKind));
        expect(record.occurrenceId).toBe(occurrenceId(record.from, record.line, record.column, record.specifier));
      }
    });
  }

  it("escaped.json keeps the hostile specifier as plain data", () => {
    const record = fixture("escaped").imports[0];
    expect(record?.from).toBe("src/a&b.ts");
    expect(record?.specifier).toBe("./<img src=x onerror=alert(1)>");
    expect(record?.to).toBeNull();
    expect(record?.resolution).toBe("unresolved");
    expect(record?.reason).toBe("absent-file");
  });

  it("boundary.json has one external and two unresolved imports on lines 1 to 3", () => {
    const records = fixture("boundary").imports;
    expect(records.map((r) => [r.specifier, r.resolution, r.reason ?? null, r.line, r.column])).toEqual([
      ["zod", "external", null, 1, 1],
      ["./ghosts/missing", "unresolved", "absent-file", 2, 1],
      ["@/lib/format", "unresolved", "alias-not-configured", 3, 1],
    ]);
  });

  it("mixed-presets.json has the three kinds of the design", () => {
    const records = fixture("mixed-presets").imports;
    expect(records.map((r) => [r.syntaxKind, r.dependencyKind, r.to])).toEqual([
      ["re-export", "type", "src/x.ts"],
      ["import", "mixed", "src/m.ts"],
      ["dynamic-literal", "value", "src/d.ts"],
    ]);
  });

  it("long-name.json has a 22-character file name", () => {
    const id = fixture("long-name").modules[0]?.id ?? "";
    expect(id).toBe("src/long/aVeryLongModuleName.ts");
    expect(id.split("/").pop()).toHaveLength(22);
  });

  it("two-wings.json has the wings and imports of the design", () => {
    const inv = fixture("two-wings");
    expect(inv.modules.map((m) => m.id)).toEqual([
      "src/orders/a.ts",
      "src/orders/b.ts",
      "src/orders/c.ts",
      "src/payments/p.ts",
      "src/payments/q.ts",
    ]);
    expect(inv.imports.map((r) => [r.from, r.to])).toEqual([
      ["src/orders/a.ts", "src/payments/p.ts"],
      ["src/orders/b.ts", "src/payments/p.ts"],
      ["src/payments/q.ts", "src/orders/c.ts"],
    ]);
  });
});

describe("hand-written expectations equal the real analysis (a check of the fixtures, not of the UI)", () => {
  it("triad.json: who imports src/c.ts under static-value", () => {
    const result = trace(fixture("triad"), "src/c.ts", "imported-by", "static-value");
    expect(result.visited).toEqual(["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"]);
    expect(result.direct).toEqual(["src/b.ts"]);
    expect(result.indirect).toEqual(["src/a.ts", "src/d.ts"]);
    expect(result.predecessor).toEqual({ "src/b.ts": "src/c.ts", "src/a.ts": "src/b.ts", "src/d.ts": "src/b.ts" });
    expect(result.distance).toEqual({ "src/c.ts": 0, "src/b.ts": 1, "src/a.ts": 2, "src/d.ts": 2 });
  });

  it("cycle.json: the two components under static-value", () => {
    const report = findCycles(fixture("cycle"), "static-value");
    const xy = relationIdFor("src/x.ts", "src/y.ts", "import", "value");
    const yx = relationIdFor("src/y.ts", "src/x.ts", "import", "value");
    const zz = relationIdFor("src/z.ts", "src/z.ts", "import", "value");
    expect(report.components).toEqual([
      { members: ["src/x.ts", "src/y.ts"], witness: { modules: ["src/x.ts", "src/y.ts"], relationIds: [xy, yx] } },
      { members: ["src/z.ts"], witness: { modules: ["src/z.ts"], relationIds: [zz] } },
    ]);
  });
});

describe("generators", () => {
  it("perf200 has 200 modules in 8 wings and 600 relations", () => {
    expect(perf200.modules).toHaveLength(200);
    expect(perf200.imports).toHaveLength(600);
    expect(new Set(perf200.modules.map((m) => m.id.slice(0, m.id.lastIndexOf("/")))).size).toBe(8);
    expect(validateInvestigation(perf200)).toEqual({ ok: true });
  });

  it("perf1000 has 1,000 modules in 40 wings and 3,000 relations", () => {
    expect(perf1000.modules).toHaveLength(1000);
    expect(perf1000.imports).toHaveLength(3000);
    expect(new Set(perf1000.modules.map((m) => m.id.slice(0, m.id.lastIndexOf("/")))).size).toBe(40);
  });

  it("wide has 125 modules and src/big holds m000 to m119", () => {
    expect(wide.modules).toHaveLength(125);
    const big = wide.modules.map((m) => m.id).filter((id) => id.startsWith("src/big/"));
    expect(big).toHaveLength(120);
    expect(big[0]).toBe("src/big/m000.ts");
    expect(big[119]).toBe("src/big/m119.ts");
    expect([...big].sort()).toEqual(big);
  });

  it("every module imports distinct other modules and the same seed gives the same result", () => {
    const seen = new Set(perf200.imports.map((r) => r.relationId));
    expect(seen.size).toBe(perf200.imports.length);
    for (const record of perf200.imports) expect(record.to).not.toBe(record.from);
    const again = JSON.stringify(perf200);
    expect(again).toBe(JSON.stringify(perf200));
  });
});

describe("facts recorded in tests/ui/README.md", () => {
  it("lists the versions of package.json", () => {
    const readme = readFileSync(join(HERE, "README.md"), "utf8");
    const pkg = JSON.parse(readFileSync(join(HERE, "..", "..", "package.json"), "utf8")) as {
      devDependencies: Record<string, string>;
      packageManager: string;
    };
    for (const name of ["vitest", "vite", "typescript", "fast-check"]) {
      expect(readme).toContain(`${name} ${pkg.devDependencies[name]}`);
    }
    expect(readme).toContain(pkg.packageManager.replace("@", " "));
  });
});
