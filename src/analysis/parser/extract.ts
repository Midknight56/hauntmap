import { parse } from "@babel/parser";
import type { ParserPlugin } from "@babel/parser";
import type { DependencyKind, ModuleRecord, SyntaxKind } from "../../contracts/types";

export interface RawImport {
  specifier: string;
  syntaxKind: SyntaxKind;
  dependencyKind: DependencyKind;
  line: number;
  column: number;
}

export interface ExtractResult {
  language: ModuleRecord["language"];
  status: "ok" | "failed";
  imports: RawImport[];
  error?: { line: number; column: number; message: string };
}

/** The language of a path by extension. `.mjs` is `js` and `.mts` is `ts`. */
export function languageOf(path: string): ModuleRecord["language"] {
  if (path.endsWith(".tsx")) return "tsx";
  if (path.endsWith(".ts") || path.endsWith(".mts")) return "ts";
  if (path.endsWith(".jsx")) return "jsx";
  return "js";
}

/** Parser plugins for each language: `ts` uses typescript, `tsx` typescript and jsx, the rest jsx. */
function pluginsFor(language: ModuleRecord["language"]): ParserPlugin[] {
  if (language === "ts") return ["typescript"];
  if (language === "tsx") return ["typescript", "jsx"];
  return ["jsx"];
}

// The parts of the Babel 8 syntax tree that this module reads. The kind fields are
// ImportDeclaration.importKind ("value" | "type" | "typeof"), ImportSpecifier.importKind
// ("value" | "type"), ExportNamedDeclaration.exportKind and ExportAllDeclaration.exportKind
// ("value" | "type"), and ExportSpecifier.exportKind ("value" | "type").
interface Position {
  line: number;
  column: number;
}
interface SpecifierNode {
  type: string;
  importKind?: string | null;
  exportKind?: string | null;
}
interface StatementNode {
  type: string;
  loc?: { start: Position } | null;
  source?: { type: string; value?: unknown } | null;
  importKind?: string | null;
  exportKind?: string | null;
  specifiers?: SpecifierNode[] | null;
}

function isTypeKind(kind: string | null | undefined): boolean {
  return kind === "type" || kind === "typeof";
}

/** A declaration with only type specifiers is type, with value and type specifiers mixed, otherwise value. */
function dependencyKindOf(node: StatementNode, specifierKind: (s: SpecifierNode) => string | null | undefined): DependencyKind {
  const declarationKind = node.type === "ImportDeclaration" ? node.importKind : node.exportKind;
  if (isTypeKind(declarationKind)) return "type";
  const specifiers = node.specifiers ?? [];
  if (specifiers.length === 0) return "value";
  const typeCount = specifiers.filter((s) => isTypeKind(specifierKind(s))).length;
  if (typeCount === 0) return "value";
  return typeCount === specifiers.length ? "type" : "mixed";
}

/**
 * Parses one file with Babel and lists its static imports, side effect imports, `export ... from`
 * and `export * from`, in source order. The text is only parsed, never executed.
 * Parse errors are not recovered from: any syntax error gives status `failed` and no imports.
 */
export function extractImports(path: string, text: string): ExtractResult {
  const language = languageOf(path);
  let body: StatementNode[];
  try {
    const file = parse(text, { sourceType: "module", plugins: pluginsFor(language), errorRecovery: false });
    body = file.program.body as unknown as StatementNode[];
  } catch (caught) {
    const error = caught as { message?: string; loc?: Position };
    return {
      language,
      status: "failed",
      imports: [],
      error: {
        line: error.loc?.line ?? 1,
        column: (error.loc?.column ?? 0) + 1,
        message: error.message ?? "Parse error",
      },
    };
  }

  const imports: RawImport[] = [];
  for (const node of body) {
    const source = node.source;
    if (source === null || source === undefined || source.type !== "StringLiteral" || typeof source.value !== "string") continue;
    const start = node.loc?.start;
    if (start === undefined) continue;
    let syntaxKind: SyntaxKind;
    let dependencyKind: DependencyKind;
    if (node.type === "ImportDeclaration") {
      syntaxKind = "import";
      dependencyKind = dependencyKindOf(node, (s) => s.importKind);
    } else if (node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") {
      syntaxKind = "re-export";
      dependencyKind = dependencyKindOf(node, (s) => s.exportKind);
    } else {
      continue;
    }
    imports.push({ specifier: source.value, syntaxKind, dependencyKind, line: start.line, column: start.column + 1 });
  }
  return { language, status: "ok", imports };
}