import type { AnalysisOptions, Diagnostic, SourceFile, SourceSet } from "../../contracts/types";
import {
  compareStrings,
  directorySegments,
  extensionOf,
  fileName,
  findCaseGroups,
  matchesFilePattern,
  normalizePath,
} from "./paths";

export type SelectResult =
  | { ok: true; sourceSet: SourceSet; diagnostics: Diagnostic[] }
  | { ok: false; diagnostics: Diagnostic[] };

const NUL_SCAN_LENGTH = 8192;

function compareDiagnostics(a: Diagnostic, b: Diagnostic): number {
  return (
    compareStrings(a.module ?? "", b.module ?? "") ||
    (a.line ?? 0) - (b.line ?? 0) ||
    (a.column ?? 0) - (b.column ?? 0) ||
    compareStrings(a.code, b.code)
  );
}

/**
 * Chooses the files to analyze. Order of the reasons for a skipped file: excluded directory,
 * secret pattern, extension, size, binary. The first three decide on the path alone, so the
 * text of such a file is never read. Returns `ok: false` only when a cap is exceeded; the file
 * cap is checked before the byte cap.
 */
export function selectSources(files: SourceFile[], rootLabel: string, options: AnalysisOptions): SelectResult {
  const diagnostics: Diagnostic[] = [];
  const skipped: SourceSet["skipped"] = [];
  const seen = new Set<string>();
  const kept: SourceFile[] = [];

  for (const input of files) {
    const path = normalizePath(input.path);
    if (seen.has(path)) {
      diagnostics.push({
        code: "duplicate-path",
        module: path,
        message: `Two inputs normalize to the path ${path}. The second one was rejected.`,
      });
      continue;
    }
    seen.add(path);

    if (directorySegments(path).some((segment) => options.excludeDirectories.includes(segment))) {
      skipped.push({ path, reason: "excluded-dir" });
      continue;
    }
    const name = fileName(path);
    if (options.excludeFilePatterns.some((pattern) => matchesFilePattern(name, pattern))) {
      skipped.push({ path, reason: "secret-pattern" });
      continue;
    }
    if (!options.includeExtensions.includes(extensionOf(path))) {
      skipped.push({ path, reason: "extension" });
      continue;
    }
    if (input.bytes > options.maxFileBytes) {
      skipped.push({ path, reason: "oversized" });
      diagnostics.push({
        code: "oversized",
        module: path,
        message: `${path} has ${input.bytes} bytes and the limit is ${options.maxFileBytes} bytes per file. It was skipped.`,
      });
      continue;
    }
    if (input.text.slice(0, NUL_SCAN_LENGTH).includes("\u0000")) {
      skipped.push({ path, reason: "binary" });
      continue;
    }
    kept.push({ path, text: input.text, bytes: input.bytes });
  }

  kept.sort((a, b) => compareStrings(a.path, b.path));

  if (kept.length > options.maxFiles) {
    const first = kept[options.maxFiles];
    return {
      ok: false,
      diagnostics: [
        {
          code: "cap-reached",
          module: first?.path,
          message: `${kept.length} files were found and the limit is ${options.maxFiles}. The first path over the limit is ${first?.path ?? ""}.`,
        },
      ],
    };
  }

  let total = 0;
  for (const file of kept) {
    total += file.bytes;
    if (total > options.maxTotalBytes) {
      const found = kept.reduce((sum, item) => sum + item.bytes, 0);
      return {
        ok: false,
        diagnostics: [
          {
            code: "cap-reached",
            module: file.path,
            message: `${found} bytes were found and the limit is ${options.maxTotalBytes} bytes. The first path over the limit is ${file.path}.`,
          },
        ],
      };
    }
  }

  for (const group of findCaseGroups(kept.map((file) => file.path))) {
    for (const path of group) {
      diagnostics.push({
        code: "case-collision",
        module: path,
        message: `${path} differs only in letter case from ${group.filter((other) => other !== path).join(", ")}. Both files were kept.`,
      });
    }
  }

  skipped.sort((a, b) => compareStrings(a.path, b.path));
  diagnostics.sort(compareDiagnostics);
  return { ok: true, sourceSet: { rootLabel, files: kept, skipped }, diagnostics };
}