import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractImports, languageOf } from "../../src/analysis/parser/extract";
import { FIXTURES_ROOT, loadFixtureFiles, readExpected } from "../fixtures/load";

interface ExpectedImport {
  from: string;
  specifier: string;
  syntaxKind: string;
  dependencyKind: string;
  line: number;
  column: number;
}
interface ExpectedModule {
  id: string;
  language: string;
  parseStatus: string;
}
interface ExpectedDiagnostic {
  code: string;
  module?: string;
  line?: number;
  column?: number;
}
interface Expected {
  modules: ExpectedModule[];
  imports: ExpectedImport[];
  diagnostics: ExpectedDiagnostic[];
}

const FIXTURES = readdirSync(FIXTURES_ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

describe("extractImports against the fixtures' expected.json", () => {
  for (const name of FIXTURES) {
    it(`${name}: specifier, kinds, line and column of every import, and the parse status`, () => {
      const dir = join(FIXTURES_ROOT, name);
      const expected = readExpected(dir) as unknown as Expected;
      for (const file of loadFixtureFiles(dir)) {
        const result = extractImports(file.path, file.text);
        const module = expected.modules.find((m) => m.id === file.path);
        expect(module, `module ${file.path} in expected.json`).toBeDefined();
        expect(result.status).toBe(module?.parseStatus);
        expect(result.language).toBe(module?.language);
        const wanted = expected.imports
          .filter((i) => i.from === file.path)
          .map(({ specifier, syntaxKind, dependencyKind, line, column }) => ({ specifier, syntaxKind, dependencyKind, line, column }));
        const found = result.imports.map(({ specifier, syntaxKind, dependencyKind, line, column }) => ({ specifier, syntaxKind, dependencyKind, line, column }));
        expect(found, file.path).toEqual(wanted);
      }
    });
  }

  it("parse-fail: reports the line and column of the parse error and no imports", () => {
    const dir = join(FIXTURES_ROOT, "parse-fail");
    const expected = readExpected(dir) as unknown as Expected;
    const broken = loadFixtureFiles(dir).find((f) => f.path === "broken.ts");
    const result = extractImports("broken.ts", broken?.text ?? "");
    const diagnostic = expected.diagnostics.find((d) => d.code === "parse-failed");
    expect(result.status).toBe("failed");
    expect(result.imports).toEqual([]);
    expect(result.error?.line).toBe(diagnostic?.line);
    expect(result.error?.column).toBe(diagnostic?.column);
    expect(result.error?.message.length).toBeGreaterThan(0);
  });
});

describe("extractImports, requirement 2.3: kinds", () => {
  const kinds = (text: string, path = "a.ts") =>
    extractImports(path, text).imports.map((i) => [i.syntaxKind, i.dependencyKind]);

  it("classifies a declaration with only type specifiers as type", () => {
    expect(kinds('import type { A } from "./x";')).toEqual([["import", "type"]]);
    expect(kinds('import { type A, type B } from "./x";')).toEqual([["import", "type"]]);
    expect(kinds('export type { A } from "./x";')).toEqual([["re-export", "type"]]);
    expect(kinds('export { type A } from "./x";')).toEqual([["re-export", "type"]]);
  });

  it("classifies a declaration with value and type specifiers as mixed, never type", () => {
    expect(kinds('import { formatMoney, type Money } from "../shared/money";')).toEqual([["import", "mixed"]]);
    expect(kinds('import d, { type A } from "./x";')).toEqual([["import", "mixed"]]);
    expect(kinds('export { a, type B } from "./x";')).toEqual([["re-export", "mixed"]]);
  });

  it("classifies side effect imports, default, namespace and star forms as value", () => {
    expect(kinds('import "./x";')).toEqual([["import", "value"]]);
    expect(kinds('import d from "./x";')).toEqual([["import", "value"]]);
    expect(kinds('import * as ns from "./x";')).toEqual([["import", "value"]]);
    expect(kinds('import {} from "./x";')).toEqual([["import", "value"]]);
    expect(kinds('export * from "./x";')).toEqual([["re-export", "value"]]);
    expect(kinds('export * as ns from "./x";')).toEqual([["re-export", "value"]]);
    expect(kinds('export { a as default } from "./x";')).toEqual([["re-export", "value"]]);
  });

  it("classifies export type * from as type", () => {
    expect(kinds('export type * from "./x";')).toEqual([["re-export", "type"]]);
  });

  it("does not record exports without a source, require(), or import = require", () => {
    expect(kinds("export const a = 1;\nexport { a as b };")).toEqual([]);
    expect(kinds('const x = require("./x");')).toEqual([]);
    expect(kinds('import x = require("./x");')).toEqual([]);
  });
});

describe("extractImports, requirement 2.2: line and column", () => {
  it("uses one based line and column of the first character of the declaration", () => {
    const text = '// first\n\n  import a from "./a";\nexport * from "./b";\n';
    expect(extractImports("m.ts", text).imports.map((i) => [i.specifier, i.line, i.column])).toEqual([
      ["./a", 3, 3],
      ["./b", 4, 1],
    ]);
  });

  it("keeps source order and every occurrence of a repeated import", () => {
    const text = 'import { a } from "./x";\nimport { b } from "./x";\n';
    expect(extractImports("m.ts", text).imports.map((i) => [i.specifier, i.line])).toEqual([
      ["./x", 1],
      ["./x", 2],
    ]);
  });
});

describe("extractImports, requirement 2.1: the parser mode of each extension", () => {
  it("maps extensions to languages", () => {
    expect(languageOf("a.js")).toBe("js");
    expect(languageOf("a.mjs")).toBe("js");
    expect(languageOf("a.jsx")).toBe("jsx");
    expect(languageOf("a.ts")).toBe("ts");
    expect(languageOf("a.mts")).toBe("ts");
    expect(languageOf("a.tsx")).toBe("tsx");
  });

  it("parses JSX in .js, .jsx, .mjs and .tsx", () => {
    const text = 'import a from "./a";\nexport const el = <div />;\n';
    for (const path of ["a.js", "a.jsx", "a.mjs", "a.tsx"]) {
      expect(extractImports(path, text).status, path).toBe("ok");
    }
  });

  it("parses TypeScript syntax in .ts, .mts and .tsx, and fails it in .js, .jsx and .mjs", () => {
    const text = 'import a from "./a";\nexport const n: number = 1;\n';
    for (const path of ["a.ts", "a.mts", "a.tsx"]) expect(extractImports(path, text).status, path).toBe("ok");
    for (const path of ["a.js", "a.jsx", "a.mjs"]) expect(extractImports(path, text).status, path).toBe("failed");
  });

  it("does not parse JSX in .ts and .mts", () => {
    const text = "export const el = <div />;\n";
    expect(extractImports("a.ts", text).status).toBe("failed");
    expect(extractImports("a.mts", text).status).toBe("failed");
  });

  it("parses as a module and does not recover from errors", () => {
    expect(extractImports("a.ts", 'import a from "./a";\nawait Promise.resolve(1);\n').status).toBe("ok");
    const broken = extractImports("a.ts", 'import a from "./a";\nlet = = ;\n');
    expect(broken.status).toBe("failed");
    expect(broken.imports).toEqual([]);
  });
});

describe("extractImports, requirement 2.5: never executes the source", () => {
  it("leaves a global flag unset for a file whose top level sets it and throws", () => {
    const key = "__hauntmapExecuted";
    const flags = globalThis as unknown as Record<string, unknown>;
    delete flags[key];
    const text = `import "./x";\nglobalThis.${key} = true;\nthrow new Error("executed");\n`;
    const result = extractImports("trap.ts", text);
    expect(result.status).toBe("ok");
    expect(result.imports.map((i) => i.specifier)).toEqual(["./x"]);
    expect(flags[key]).toBeUndefined();
  });
});
describe("extractImports, requirement 10: literal dynamic imports", () => {
  const dynamic = (text: string, path = "a.ts") =>
    extractImports(path, text).imports.map((i) => [i.specifier, i.syntaxKind, i.dependencyKind, i.line, i.column, i.nonLiteral === true]);

  it("records a string literal import() as dynamic-literal and value, at the import keyword", () => {
    expect(dynamic('await import("./b");\n')).toEqual([["./b", "dynamic-literal", "value", 1, 7, false]]);
  });

  it("finds import() at any depth: functions, arrows, classes, conditions and JSX attributes", () => {
    const text = [
      'export function f() { return import("./a"); }',
      'export const g = () => import("./b");',
      'export class C { m() { return import("./c"); } }',
      'export const h = true ? import("./d") : null;',
      'export const j = <button onClick={() => import("./e")} />;',
    ].join("\n");
    expect(dynamic(text, "a.tsx").map((r) => r[0])).toEqual(["./a", "./b", "./c", "./d", "./e"]);
  });

  it("works in every supported extension", () => {
    for (const path of ["a.js", "a.jsx", "a.mjs", "a.ts", "a.mts", "a.tsx"]) {
      expect(dynamic('import("./x");\n', path).map((r) => r[0]), path).toEqual(["./x"]);
    }
  });

  it("keeps an import() with an options argument literal", () => {
    expect(dynamic('import("./x", { with: { type: "json" } });\n').map((r) => [r[0], r[5]])).toEqual([["./x", false]]);
  });

  it("marks a non literal argument and gives its source text as the specifier", () => {
    expect(dynamic("import(name);\nimport(`./t`);\nimport(base + '/x');\n")).toEqual([
      ["name", "dynamic-literal", "value", 1, 1, true],
      ["`./t`", "dynamic-literal", "value", 2, 1, true],
      ["base + '/x'", "dynamic-literal", "value", 3, 1, true],
    ]);
  });

  it("lists static and dynamic imports together in source order", () => {
    const text = 'import a from "./a";\nconst x = () => import("./b");\nexport * from "./c";\n';
    expect(extractImports("m.ts", text).imports.map((i) => [i.specifier, i.line])).toEqual([
      ["./a", 1],
      ["./b", 2],
      ["./c", 3],
    ]);
  });

  it("does not record import.meta, require(), strings or comments that contain import(", () => {
    const text = [
      'const u = import.meta.url;',
      'const r = require("./r");',
      'const s = "import(\'./s\')";',
      '// import("./c")',
      '/* import("./d") */',
    ].join("\n");
    expect(dynamic(text)).toEqual([]);
  });

  it("records a static import with no nonLiteral flag", () => {
    expect(extractImports("m.ts", 'import "./x";\n').imports[0]?.nonLiteral).toBeUndefined();
  });

  it("finds an import() in a very deeply nested expression without a stack overflow", () => {
    const depth = 3000;
    const text = `export const x = ${"(".repeat(depth)}import("./deep")${")".repeat(depth)};\n`;
    const result = extractImports("a.ts", text);
    if (result.status === "ok") expect(result.imports.map((i) => i.specifier)).toEqual(["./deep"]);
    else expect(result.imports).toEqual([]);
  });
});