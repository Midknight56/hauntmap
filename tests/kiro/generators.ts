import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import fc from "fast-check";
import { DEFAULT_ANALYSIS_OPTIONS, occurrenceId, relationId } from "../../src/analysis/index";
import type { DependencyKind, Diagnostic, ImportRecord, Investigation, ModuleRecord, Preset, SyntaxKind } from "../../src/contracts/types";
import type { ManifestEntry, TreeManifest } from "./materialize";

export type { ManifestEntry, TreeManifest } from "./materialize";

// Generators of design.md, "Correctness Properties". Tests run on Windows, so file names are
// unique without regard to case, never end in a dot and are never reserved device names.

const NAME_CHARS = [..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-"];
const LITERAL_NAMES = ["node_modules", ".git", "dist", ".env", "x.pem"];
const EXTENSIONS = [".js", ".jsx", ".ts", ".tsx", ".mjs", ".mts", ".md", ".json", ".png"];
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function validName(name: string): boolean {
  return name.length > 0 && !name.endsWith(".") && !/^\.+$/.test(name) && !RESERVED.test(name.split(".")[0] ?? "");
}

const arbStem = fc.array(fc.constantFrom(...NAME_CHARS), { minLength: 1, maxLength: 8 }).map((chars) => chars.join(""));
const arbDirName = fc
  .oneof({ weight: 8, arbitrary: arbStem }, { weight: 1, arbitrary: fc.constantFrom(...LITERAL_NAMES) })
  .filter(validName);
const arbFileName = fc
  .oneof(
    { weight: 8, arbitrary: fc.tuple(arbStem, fc.constantFrom(...EXTENSIONS)).map(([stem, extension]) => `${stem}${extension}`) },
    { weight: 1, arbitrary: fc.constantFrom(...LITERAL_NAMES) },
  )
  .filter(validName);

const arbText = fc
  .array(
    fc.oneof(
      fc.string({ maxLength: 16 }),
      fc.constantFrom("\ufeff", "\r\n", "\n", "é漢字", 'import x from "./y";\n', "export const q = 1;\n"),
    ),
    { maxLength: 6 },
  )
  .map((parts) => parts.join(""));

const arbContent: fc.Arbitrary<ManifestEntry> = fc.oneof(
  { weight: 97, arbitrary: arbText },
  { weight: 1, arbitrary: arbText.map((text) => `\u0000${text}`) },
  { weight: 2, arbitrary: fc.constant<ManifestEntry>({ bytes: 1_048_577, fill: "/" }) },
);

/** Drops entries that collide on a case-folding file system or that use a file as a directory. */
function sanitize(entries: [string, ManifestEntry][]): TreeManifest {
  const files: Record<string, ManifestEntry> = {};
  const fileLower = new Set<string>();
  const dirs = new Map<string, string>();
  for (const [path, content] of entries) {
    const segments = path.split("/");
    const lower = path.toLowerCase();
    if (fileLower.has(lower) || dirs.has(lower)) continue;
    let clash = false;
    for (let i = 1; i < segments.length; i += 1) {
      const prefix = segments.slice(0, i).join("/");
      const seen = dirs.get(prefix.toLowerCase());
      if ((seen !== undefined && seen !== prefix) || fileLower.has(prefix.toLowerCase())) clash = true;
    }
    if (clash) continue;
    for (let i = 1; i < segments.length; i += 1) {
      const prefix = segments.slice(0, i).join("/");
      dirs.set(prefix.toLowerCase(), prefix);
    }
    fileLower.add(lower);
    files[path] = content;
  }
  return { files };
}

/** A directory manifest of 1 to 60 files at depth 0 to 4. */
export const arbTree: fc.Arbitrary<TreeManifest> = fc
  .array(
    fc.tuple(fc.array(arbDirName, { maxLength: 4 }), arbFileName, arbContent).map(([dirs, file, content]): [string, ManifestEntry] => [[...dirs, file].join("/"), content]),
    { minLength: 1, maxLength: 60 },
  )
  .map(sanitize);

/** Arbitrary JSON values and objects shaped like tool arguments with wrong types. */
export const arbArgs: fc.Arbitrary<unknown> = fc.oneof(
  fc.jsonValue(),
  fc.record(
    {
      root: fc.oneof(fc.string(), fc.integer(), fc.constant(null), fc.constant("samples/manor"), fc.constant("")),
      preset: fc.oneof(fc.string(), fc.integer(), fc.constant("static-value"), fc.constant("type-inclusive"), fc.constant(null)),
      module: fc.oneof(fc.string(), fc.integer(), fc.constant("src/orders/checkout.ts"), fc.constant(null)),
      rootBefore: fc.oneof(fc.string(), fc.constant("public/demo/manor/before"), fc.constant(null)),
      rootAfter: fc.oneof(fc.string(), fc.constant("samples/manor"), fc.constant(null)),
    },
    { requiredKeys: [] },
  ),
);

const PATH_PARTS = [".", "..", "src", "link", "outside", "samples", "manor", "x.ts", "C:", "Users", "node_modules"];

/** Root strings with `..`, absolute prefixes, backslashes and link names. */
export const arbPath: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom("", "/", "\\", "C:\\", "C:/", "./", "../", "..\\"),
    fc.array(fc.constantFrom(...PATH_PARTS), { minLength: 0, maxLength: 5 }),
    fc.constantFrom("/", "\\"),
  )
  .map(([prefix, parts, separator]) => `${prefix}${parts.join(separator)}`);

const HEX = [..."0123456789abcdef"];
const PRESETS: Preset[] = ["static-value", "type-inclusive", "dynamic-inclusive"];
const SYNTAX: SyntaxKind[] = ["import", "re-export", "dynamic-literal"];
const DEPENDENCY: DependencyKind[] = ["value", "type", "mixed"];
const DIAGNOSTIC_CODES: Diagnostic["code"][] = ["parse-failed", "unresolved", "unsupported", "case-collision", "duplicate-path", "oversized", "cap-reached"];
const REASONS: NonNullable<ImportRecord["reason"]>[] = ["absent-file", "alias-not-configured", "nonliteral-dynamic", "unsupported-construct", "ambiguous-candidate"];
const MODULE_LANGUAGES: { extension: string; language: ModuleRecord["language"] }[] = [
  { extension: "ts", language: "ts" },
  { extension: "tsx", language: "tsx" },
  { extension: "js", language: "js" },
  { extension: "jsx", language: "jsx" },
];

const arbHash = fc.array(fc.constantFrom(...HEX), { minLength: 64, maxLength: 64 }).map((chars) => chars.join(""));

const arbModules: fc.Arbitrary<ModuleRecord[]> = fc
  .array(fc.tuple(fc.constantFrom(...MODULE_LANGUAGES), fc.constantFrom("ok", "partial", "failed" as const), arbHash), { minLength: 1, maxLength: 50 })
  .map((rows) =>
    rows.map(([kind, parseStatus, sourceHash], index): ModuleRecord => ({
      id: `src/w${index % 5}/m${index}.${kind.extension}`,
      sourceHash,
      language: kind.language,
      parseStatus: parseStatus as ModuleRecord["parseStatus"],
    })),
  );

interface ImportDraft {
  from: number;
  to: number;
  resolution: ImportRecord["resolution"];
  syntaxKind: SyntaxKind;
  dependencyKind: DependencyKind;
  line: number;
  column: number;
  reason: ImportRecord["reason"] | null;
  external: string;
}

const arbImportDraft: fc.Arbitrary<ImportDraft> = fc.record({
  from: fc.nat(1000),
  to: fc.nat(1000),
  resolution: fc.constantFrom<ImportRecord["resolution"]>("local", "local", "local", "external", "unresolved", "unsupported"),
  syntaxKind: fc.constantFrom(...SYNTAX),
  dependencyKind: fc.constantFrom(...DEPENDENCY),
  line: fc.integer({ min: 1, max: 200 }),
  column: fc.integer({ min: 1, max: 80 }),
  reason: fc.option(fc.constantFrom(...REASONS), { nil: null }),
  external: fc.constantFrom("react", "@scope/pkg", "@/lib/format", "./missing", "~/config/env"),
});

const arbDiagnostics: fc.Arbitrary<Diagnostic[]> = fc.array(
  fc.record({
    code: fc.constantFrom(...DIAGNOSTIC_CODES),
    message: fc.string({ minLength: 1, maxLength: 30 }),
  }),
  { maxLength: 5 },
);

/** A valid investigation with 1 to 50 modules; every import starts at a module of the same investigation. */
export const arbInvestigation: fc.Arbitrary<Investigation> = fc
  .tuple(arbModules, fc.array(arbImportDraft, { maxLength: 80 }), arbDiagnostics, fc.constantFrom(...PRESETS), fc.constantFrom("live:samples/manor", "manor/before"))
  .map(([modules, drafts, diagnostics, preset, sourceLabel]): Investigation => {
    const imports = drafts.map((draft, index): ImportRecord => {
      const from = (modules[draft.from % modules.length] as ModuleRecord).id;
      const local = draft.resolution === "local";
      const to = local ? (modules[draft.to % modules.length] as ModuleRecord).id : null;
      const specifier = local ? `./target${index}` : draft.external;
      const record: ImportRecord = {
        occurrenceId: occurrenceId(from, draft.line, draft.column, specifier),
        relationId: relationId(from, local ? ["local", to as string] : [draft.resolution, specifier], draft.syntaxKind, draft.dependencyKind),
        from,
        to,
        specifier,
        syntaxKind: draft.syntaxKind,
        dependencyKind: draft.dependencyKind,
        resolution: draft.resolution,
        line: draft.line,
        column: draft.column,
      };
      if (!local && draft.reason !== null && draft.reason !== undefined) record.reason = draft.reason;
      return record;
    });
    return {
      schemaVersion: 1,
      resolverMode: "documented-source-subset",
      sourceLabel,
      modules,
      imports,
      diagnostics,
      options: { ...DEFAULT_ANALYSIS_OPTIONS, preset },
    };
  });

export interface Mutation {
  /** The investigation with one required field deleted, retyped to null or duplicated. */
  value: Record<string, unknown>;
  /** What the first validation error must start with: a top-level field name, `modules[i].`, `imports[i].` or `options.`. */
  prefix: string;
  /** The exact field that was changed, for failure messages. */
  field: string;
  kind: "delete" | "retype" | "duplicate";
}

const TOP_FIELDS = ["schemaVersion", "resolverMode", "sourceLabel", "modules", "imports", "diagnostics", "options"] as const;
const MODULE_FIELDS = ["id", "sourceHash", "language", "parseStatus"] as const;
const IMPORT_FIELDS = ["occurrenceId", "relationId", "from", "specifier", "syntaxKind", "dependencyKind", "resolution", "line", "column"] as const;
const OPTION_FIELDS = ["preset", "includeExtensions", "excludeDirectories", "excludeFilePatterns", "maxFiles", "maxFileBytes", "maxTotalBytes", "jsToTsFallback"] as const;

/** One mutation of `investigation`, chosen at random: delete or retype (to null) one required field, or duplicate a module id. */
export function arbMutation(investigation: Investigation): fc.Arbitrary<Mutation> {
  const choices: Omit<Mutation, "value">[] = [];
  for (const field of TOP_FIELDS) {
    for (const kind of ["delete", "retype"] as const) choices.push({ prefix: field, field, kind });
  }
  investigation.modules.forEach((_, index) => {
    for (const field of MODULE_FIELDS) {
      for (const kind of ["delete", "retype"] as const) choices.push({ prefix: `modules[${index}].`, field: `modules[${index}].${field}`, kind });
    }
    if (index > 0) choices.push({ prefix: `modules[${index}].`, field: `modules[${index}].id`, kind: "duplicate" });
  });
  investigation.imports.forEach((_, index) => {
    for (const field of IMPORT_FIELDS) {
      for (const kind of ["delete", "retype"] as const) choices.push({ prefix: `imports[${index}].`, field: `imports[${index}].${field}`, kind });
    }
  });
  for (const field of OPTION_FIELDS) {
    for (const kind of ["delete", "retype"] as const) choices.push({ prefix: "options.", field: `options.${field}`, kind });
  }
  return fc.constantFrom(...choices).map((choice): Mutation => {
    const value = structuredClone(investigation) as unknown as Record<string, unknown>;
    const match = /^(\w+)(?:\[(\d+)\])?(?:\.(\w+))?$/.exec(choice.field) as RegExpExecArray;
    const container = match[2] !== undefined ? ((value[match[1] as string] as Record<string, unknown>[])[Number(match[2])] as Record<string, unknown>) : match[3] !== undefined ? (value[match[1] as string] as Record<string, unknown>) : value;
    const key = match[3] ?? (match[1] as string);
    if (choice.kind === "delete") delete container[key];
    else if (choice.kind === "retype") container[key] = null;
    else container[key] = (investigation.modules[0] as ModuleRecord).id;
    return { ...choice, value };
  });
}

function writeText(root: string, path: string, text: string): void {
  const target = join(root, ...path.split("/"));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text, "utf8");
}

/** `cap-files`: 1,001 files m0.ts to m1000.ts of one line each. In code-point order the last name is m999.ts. */
export function makeCapFilesWorkspace(dir: string): string {
  for (let i = 0; i <= 1000; i += 1) writeText(dir, `m${i}.ts`, `export const v${i} = ${i};\n`);
  return dir;
}

/** `cap-bytes`: 26 files b00.ts to b25.ts of exactly 1,048,576 bytes (a line comment). 25 of them total exactly 26,214,400 bytes. */
export function makeCapBytesWorkspace(dir: string): string {
  const body = `${"/".repeat(1_048_575)}\n`;
  for (let i = 0; i < 26; i += 1) writeText(dir, `b${String(i).padStart(2, "0")}.ts`, body);
  return dir;
}

/** `demo-live`: public/demo/manor/before (three .ts files and expected.json), samples/manor as its copy and, optionally, a dist/cli.js marker. */
export function makeDemoLiveWorkspace(dir: string, withCli: boolean): string {
  for (const base of ["public/demo/manor/before", "samples/manor"]) {
    writeText(dir, `${base}/src/a.ts`, 'import { b } from "./b";\nexport const a = b;\n');
    writeText(dir, `${base}/src/b.ts`, "export const b = 1;\n");
    writeText(dir, `${base}/src/c.ts`, "export const c = 2;\n");
  }
  writeText(dir, "public/demo/manor/before/expected.json", "{}\n");
  if (withCli) writeText(dir, "packages/hauntmap-mcp/dist/cli.js", "// marker\n");
  return dir;
}

/**
 * `manor-after-removal`: a copy of samples/manor at `destination` in which the demo relation's import line and its one use line
 * of src/notifications/receipt.ts are deleted. The two line numbers come from `receiptToCheckout` in expected.json.
 */
export function makeManorAfterRemoval(repoRoot: string, destination: string): string {
  const expected = JSON.parse(readFileSync(join(repoRoot, "public", "demo", "manor", "before", "expected.json"), "utf8")) as {
    receiptToCheckout: { importLine: number; useLine: number };
  };
  cpSync(join(repoRoot, "samples", "manor"), destination, { recursive: true });
  const target = join(destination, "src", "notifications", "receipt.ts");
  const lines = readFileSync(target, "utf8").split("\n");
  const drop = new Set([expected.receiptToCheckout.importLine, expected.receiptToCheckout.useLine]);
  writeFileSync(target, lines.filter((_, index) => !drop.has(index + 1)).join("\n"), "utf8");
  return destination;
}