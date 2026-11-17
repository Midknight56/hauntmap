import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, posix, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";
import { describe, expect, it } from "vitest";
import * as analysis from "../src/analysis/index";
import { DEFAULT_ANALYSIS_OPTIONS } from "../src/contracts/options";

// Requirement 9.1 and 9.3. Two checks:
//  1. nothing under src/analysis or src/contracts imports the scene, the features, the components,
//     React or a worker module, or uses a DOM API or a worker global;
//  2. nothing outside those two folders implements extraction, resolution, cycles or trace again.

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts"];

interface SourceText {
  path: string; // relative to the repository root, forward slashes
  text: string;
}

const FORBIDDEN_FOLDERS = ["src/scene", "src/features", "src/components", "src/workers"];
const FORBIDDEN_PACKAGES = ["react", "react-dom", "pixi.js", "@pixi"];
const FORBIDDEN_GLOBALS = new Set([
  "document",
  "window",
  "navigator",
  "location",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "self",
  "postMessage",
  "importScripts",
  "WorkerGlobalScope",
  "Worker",
  "SharedWorker",
  "MessageChannel",
  "DOMParser",
  "XMLHttpRequest",
  "requestAnimationFrame",
  "HTMLElement",
  "HTMLCanvasElement",
  "Element",
  "Node",
]);
const PARSER_PACKAGES = ["@babel/parser", "@babel/core", "@babel/traverse", "typescript", "acorn", "esprima", "espree", "@typescript-eslint/parser"];
const FORBIDDEN_DECLARATIONS = new Set(["extractImports", "resolveSpecifier", "findCycles", "trace", "tarjan"]);

type Node = { type: string; [key: string]: unknown };

function parseSource(file: SourceText): Node {
  const isTsx = file.path.endsWith(".tsx");
  const isTs = file.path.endsWith(".ts") || file.path.endsWith(".mts") || isTsx;
  const plugins: ("typescript" | "jsx")[] = isTs ? (isTsx ? ["typescript", "jsx"] : ["typescript"]) : ["jsx"];
  return parse(file.text, { sourceType: "module", plugins }) as unknown as Node;
}

/** Calls `visit(node, parent, key)` for every node of the tree, without recursion limits for the size of these files. */
function walk(root: Node, visit: (node: Node, parent: Node | null, key: string) => void): void {
  const stack: { node: Node; parent: Node | null; key: string }[] = [{ node: root, parent: null, key: "" }];
  while (stack.length > 0) {
    const { node, parent, key } = stack.pop() as { node: Node; parent: Node | null; key: string };
    visit(node, parent, key);
    for (const [name, value] of Object.entries(node)) {
      if (name === "loc" || name === "extra" || name === "leadingComments" || name === "trailingComments" || name === "innerComments") continue;
      const children = Array.isArray(value) ? value : [value];
      for (const child of children) {
        if (child !== null && typeof child === "object" && typeof (child as Node).type === "string") {
          stack.push({ node: child as Node, parent: node, key: name });
        }
      }
    }
  }
}

function importSpecifiers(tree: Node): string[] {
  const specifiers: string[] = [];
  walk(tree, (node) => {
    if ((node.type === "ImportDeclaration" || node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") && node.source) {
      specifiers.push((node.source as { value: string }).value);
    } else if (node.type === "ImportExpression") {
      const source = node.source as { type: string; value?: string };
      if (source.type === "StringLiteral" && source.value !== undefined) specifiers.push(source.value);
    } else if (node.type === "TSImportType") {
      const argument = node.argument as { value?: string };
      if (argument.value !== undefined) specifiers.push(argument.value);
    }
  });
  return specifiers;
}

function resolvedPath(from: string, specifier: string): string {
  return posix.normalize(posix.join(posix.dirname(from), specifier));
}

function isUnder(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}/`);
}

/** Check 1: the files that belong to src/analysis or src/contracts. Returns one message per violation. */
export function checkInside(files: SourceText[]): string[] {
  const problems: string[] = [];
  for (const file of files) {
    const tree = parseSource(file);
    for (const specifier of importSpecifiers(tree)) {
      if (specifier.startsWith(".")) {
        const target = resolvedPath(file.path, specifier);
        const folder = FORBIDDEN_FOLDERS.find((candidate) => isUnder(target, candidate));
        if (folder !== undefined) problems.push(`${file.path} imports ${specifier} (${folder})`);
      } else if (FORBIDDEN_PACKAGES.some((name) => specifier === name || specifier.startsWith(`${name}/`))) {
        problems.push(`${file.path} imports the package ${specifier}`);
      }
    }
    walk(tree, (node, parent, key) => {
      if (node.type !== "Identifier" || !FORBIDDEN_GLOBALS.has(node.name as string)) return;
      const name = node.name as string;
      const isPropertyName =
        parent !== null &&
        ((parent.type === "MemberExpression" && key === "property" && parent.computed !== true) ||
          (parent.type === "OptionalMemberExpression" && key === "property" && parent.computed !== true) ||
          ((parent.type === "ObjectProperty" || parent.type === "ObjectMethod" || parent.type === "ClassMethod" || parent.type === "ClassProperty") &&
            key === "key" &&
            parent.computed !== true) ||
          parent.type === "TSPropertySignature" ||
          parent.type === "TSMethodSignature" ||
          (parent.type === "TSQualifiedName" && key === "right") ||
          parent.type === "ImportSpecifier" ||
          parent.type === "ExportSpecifier");
      if (!isPropertyName) problems.push(`${file.path} uses the DOM or worker global ${name}`);
    });
  }
  return problems;
}

/** Check 2: the files outside src/analysis and src/contracts. */
export function checkOutside(files: SourceText[]): string[] {
  const problems: string[] = [];
  for (const file of files) {
    const tree = parseSource(file);
    for (const specifier of importSpecifiers(tree)) {
      if (PARSER_PACKAGES.some((name) => specifier === name || specifier.startsWith(`${name}/`))) {
        problems.push(`${file.path} imports the parser package ${specifier}`);
      }
    }
    walk(tree, (node) => {
      let name: string | undefined;
      if (node.type === "FunctionDeclaration" && node.id) name = (node.id as { name: string }).name;
      else if (
        node.type === "VariableDeclarator" &&
        (node.id as Node).type === "Identifier" &&
        node.init &&
        ["ArrowFunctionExpression", "FunctionExpression"].includes((node.init as Node).type)
      ) {
        name = (node.id as { name: string }).name;
      } else if ((node.type === "ClassMethod" || node.type === "ObjectMethod") && (node.key as Node).type === "Identifier") {
        name = (node.key as { name: string }).name;
      }
      if (name !== undefined && FORBIDDEN_DECLARATIONS.has(name)) problems.push(`${file.path} declares ${name}`);
    });
  }
  return problems;
}

function collect(dir: string, out: SourceText[]): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension)) && !entry.name.endsWith(".d.ts")) {
      out.push({ path: relative(REPO, full).split("\\").join("/"), text: readFileSync(full, "utf8") });
    }
  }
}

function filesUnder(...folders: string[]): SourceText[] {
  const out: SourceText[] = [];
  for (const folder of folders) collect(join(REPO, folder), out);
  return out;
}

const INSIDE = ["src/analysis", "src/contracts"];

function outsideFiles(): SourceText[] {
  const all = filesUnder("src", "scripts", "packages");
  return all.filter((file) => !INSIDE.some((folder) => isUnder(file.path, folder)));
}

describe("check 1: src/analysis and src/contracts stay free of the app", () => {
  it("passes for the real files", () => {
    const files = filesUnder(...INSIDE);
    expect(files.length).toBeGreaterThan(10);
    expect(checkInside(files)).toEqual([]);
  });

  it("fails on an import from src/scene, src/features or src/components, by any relative path", () => {
    const sample = (path: string, specifier: string) => checkInside([{ path, text: `import { x } from "${specifier}";\nexport const y = x;\n` }]);
    expect(sample("src/analysis/a.ts", "../scene/map")).toHaveLength(1);
    expect(sample("src/analysis/graph/a.ts", "../../features/investigation/store")).toHaveLength(1);
    expect(sample("src/contracts/a.ts", "../components/Map")).toHaveLength(1);
    expect(sample("src/analysis/a.ts", "../workers/client")).toHaveLength(1);
    expect(sample("src/analysis/a.ts", "../scene")).toHaveLength(1);
    expect(sample("src/analysis/a.ts", "./graph/ids")).toEqual([]);
  });

  it("fails on a re-export, a dynamic import and a type import of the app", () => {
    expect(checkInside([{ path: "src/analysis/a.ts", text: 'export { x } from "../scene/map";\n' }])).toHaveLength(1);
    expect(checkInside([{ path: "src/analysis/a.ts", text: 'export const load = () => import("../features/a");\n' }])).toHaveLength(1);
    expect(checkInside([{ path: "src/analysis/a.ts", text: 'import type { P } from "../components/P";\nexport type Q = P;\n' }])).toHaveLength(1);
  });

  it("fails on React and on a drawing library", () => {
    expect(checkInside([{ path: "src/analysis/a.ts", text: 'import { useState } from "react";\nexport const s = useState;\n' }])).toHaveLength(1);
    expect(checkInside([{ path: "src/analysis/a.ts", text: 'import { Application } from "pixi.js";\nexport const a = Application;\n' }])).toHaveLength(1);
  });

  it("fails on a DOM API or a worker global", () => {
    const code = (text: string) => checkInside([{ path: "src/analysis/a.ts", text }]);
    expect(code("export const t = document.title;\n")).toHaveLength(1);
    expect(code("export const w = window.innerWidth;\n")).toHaveLength(1);
    expect(code("export const s = localStorage.getItem('k');\n")).toHaveLength(1);
    expect(code("self.postMessage(1);\n").length).toBeGreaterThan(0);
    expect(code("export function f(e: HTMLElement) { return e; }\n")).toHaveLength(1);
    expect(code("importScripts('x.js');\n")).toHaveLength(1);
    expect(code("export const k = typeof WorkerGlobalScope;\n")).toHaveLength(1);
  });

  it("does not fail on a property of that name, a comment or a string", () => {
    const code = (text: string) => checkInside([{ path: "src/analysis/a.ts", text }]);
    expect(code("export const a = { document: 1 }.document;\n")).toEqual([]);
    expect(code("// the document and the window are not used here\nexport const b = 'window';\n")).toEqual([]);
    expect(code("export const c = (x: { location: string }) => x.location;\n")).toEqual([]);
  });
});

describe("check 2: nothing outside src/analysis and src/contracts implements the analysis again", () => {
  it("passes for the real files outside the two folders", () => {
    const files = outsideFiles();
    expect(files.length).toBeGreaterThan(0);
    expect(checkOutside(files)).toEqual([]);
  });

  it("fails on a parser package imported outside", () => {
    expect(checkOutside([{ path: "src/features/a.ts", text: 'import { parse } from "@babel/parser";\nexport const p = parse;\n' }])).toHaveLength(1);
    expect(checkOutside([{ path: "scripts/a.ts", text: 'import ts from "typescript";\nexport const t = ts;\n' }])).toHaveLength(1);
    expect(checkOutside([{ path: "packages/hauntmap-mcp/a.ts", text: 'import { parse } from "@babel/parser/lib/index";\nexport const p = parse;\n' }])).toHaveLength(1);
  });

  it("fails on a declaration of extraction, resolution, cycle or trace code outside", () => {
    const code = (text: string) => checkOutside([{ path: "src/features/a.ts", text }]);
    expect(code("export function extractImports(text: string) { return [text]; }\n")).toHaveLength(1);
    expect(code("export const resolveSpecifier = (from: string) => from;\n")).toHaveLength(1);
    expect(code("export function findCycles() { return []; }\n")).toHaveLength(1);
    expect(code("export const trace = function () { return 1; };\n")).toHaveLength(1);
    expect(code("class G { tarjan() { return 1; } }\nexport { G };\n")).toHaveLength(1);
  });

  it("does not fail on a plain value named trace, or on a call of the analysis", () => {
    const code = (text: string) => checkOutside([{ path: "src/features/a.ts", text }]);
    expect(code("export const trace = { steps: [] };\n")).toEqual([]);
    expect(code('import { findCycles } from "../analysis";\nexport const c = (i: never) => findCycles(i, "static-value");\n')).toEqual([]);
  });

  it("allows the same code inside src/analysis", () => {
    const inside = [{ path: "src/analysis/a.ts", text: "export function findCycles() { return []; }\n" }];
    expect(checkInside(inside)).toEqual([]);
  });
});

describe("src/analysis/index.ts, the only export file (requirement 9.1)", () => {
  it("re-exports DEFAULT_ANALYSIS_OPTIONS and the functions of the design", () => {
    expect(analysis.DEFAULT_ANALYSIS_OPTIONS).toBe(DEFAULT_ANALYSIS_OPTIONS);
    for (const name of ["selectSources", "analyze", "findCycles", "trace", "occurrenceId", "relationId"] as const) {
      expect(typeof analysis[name]).toBe("function");
    }
    expect(Object.keys(analysis).sort()).toEqual(
      ["DEFAULT_ANALYSIS_OPTIONS", "analyze", "findCycles", "occurrenceId", "relationId", "selectSources", "trace"].sort(),
    );
  });

  it("is the only index file under src/analysis", () => {
    const indexes = filesUnder("src/analysis").filter((file) => /(^|\/)index\.[a-z]+$/.test(file.path));
    expect(indexes.map((file) => file.path)).toEqual(["src/analysis/index.ts"]);
  });

  it("lets the worker reach the analysis through the index and not through a deep path", () => {
    const worker = readFileSync(join(REPO, "src", "workers", "analysis.worker.ts"), "utf8");
    expect(worker).not.toMatch(/analysis\/(parser|graph)\//);
    expect(worker).toMatch(/from "\.\.\/analysis"/);
  });
});
