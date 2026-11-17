import type {
  AnalysisOptions,
  Diagnostic,
  ImportRecord,
  Investigation,
  ModuleRecord,
  SourceSet,
} from "../../contracts/types";
import { occurrenceId, relationId } from "../graph/ids";
import { extractImports } from "./extract";
import { compareStrings } from "./paths";
import { buildModuleIndex, describeUnresolved, resolveSpecifier } from "./resolve";

/** SHA-256 hex of a text. Web Crypto in the app, `node:crypto` in Node. */
export type HashFn = (text: string) => Promise<string>;

function compareDiagnostics(a: Diagnostic, b: Diagnostic): number {
  return (
    compareStrings(a.module ?? "", b.module ?? "") ||
    (a.line ?? 0) - (b.line ?? 0) ||
    (a.column ?? 0) - (b.column ?? 0) ||
    compareStrings(a.code, b.code)
  );
}

/**
 * Builds the investigation of a selected source set: one record per module, one per import,
 * and the diagnostics. Source text is parsed and hashed, never executed, and never stored in
 * the result. Files are processed in path order, so the input order does not change the bytes.
 * `selectionDiagnostics` are the ones `selectSources` returned; they are merged into the result.
 */
export async function analyze(
  sourceSet: SourceSet,
  options: AnalysisOptions,
  hash: HashFn,
  onProgress?: (done: number, total: number) => void,
  selectionDiagnostics: Diagnostic[] = [],
): Promise<Investigation> {
  const files = [...sourceSet.files].sort((a, b) => compareStrings(a.path, b.path));
  const index = buildModuleIndex(files.map((file) => file.path));
  const modules: ModuleRecord[] = [];
  const imports: ImportRecord[] = [];
  const diagnostics: Diagnostic[] = [...selectionDiagnostics];

  let done = 0;
  for (const file of files) {
    const extracted = extractImports(file.path, file.text);
    const sourceHash = await hash(file.text);
    modules.push({
      id: file.path,
      sourceHash,
      language: extracted.language,
      parseStatus: extracted.status,
    });
    if (extracted.status === "failed" && extracted.error !== undefined) {
      diagnostics.push({
        code: "parse-failed",
        module: file.path,
        line: extracted.error.line,
        column: extracted.error.column,
        message: `${file.path} could not be parsed: ${extracted.error.message}`,
      });
    }
    for (const found of extracted.imports) {
      const base = {
        from: file.path,
        specifier: found.specifier,
        syntaxKind: found.syntaxKind,
        dependencyKind: found.dependencyKind,
        line: found.line,
        column: found.column,
        occurrenceId: occurrenceId(file.path, found.line, found.column, found.specifier),
      };
      if (found.nonLiteral === true) {
        // The argument of import() is not a string literal: the target is unknown and never guessed.
        imports.push({
          ...base,
          relationId: relationId(file.path, ["unsupported", found.specifier], found.syntaxKind, found.dependencyKind),
          to: null,
          resolution: "unsupported",
          reason: "nonliteral-dynamic",
        });
        diagnostics.push({
          code: "unsupported",
          module: file.path,
          line: found.line,
          column: found.column,
          specifier: found.specifier,
          message: describeUnresolved("nonliteral-dynamic", found.specifier),
        });
        continue;
      }
      const resolved = resolveSpecifier(file.path, found.specifier, index);
      const record: ImportRecord = {
        ...base,
        relationId:
          resolved.resolution === "local"
            ? relationId(file.path, ["local", resolved.to], found.syntaxKind, found.dependencyKind)
            : relationId(file.path, [resolved.resolution, found.specifier], found.syntaxKind, found.dependencyKind),
        to: resolved.to,
        resolution: resolved.resolution,
      };
      if (resolved.resolution === "unresolved") {
        record.reason = resolved.reason;
        diagnostics.push({
          code: "unresolved",
          module: file.path,
          line: found.line,
          column: found.column,
          specifier: found.specifier,
          message: describeUnresolved(resolved.reason, found.specifier),
        });
      }
      imports.push(record);
    }    done += 1;
    onProgress?.(done, files.length);
  }

  modules.sort((a, b) => compareStrings(a.id, b.id));
  imports.sort((a, b) => compareStrings(a.occurrenceId, b.occurrenceId));
  diagnostics.sort(compareDiagnostics);

  return {
    schemaVersion: 1,
    resolverMode: "documented-source-subset",
    sourceLabel: sourceSet.rootLabel,
    modules,
    imports,
    diagnostics,
    options,
  };
}
