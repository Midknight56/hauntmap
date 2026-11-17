# Design Document

## Overview

This spec turns HauntMap's analysis module into something Kiro can call and something the judge can see Kiro having called. One package, `packages/hauntmap-mcp`, builds two self-contained Node bundles from the same `src/analysis` and `src/contracts` code the app runs in its worker: `dist/index.js`, a stdio MCP server with the tools `analyze`, `cycles`, `who_imports` and `compare`, and `dist/cli.js`, the `hauntmap` CLI with `analyze` and `compare`. A Node source loader applies the app's `AnalysisOptions` defaults to a directory exactly as the browser applies them to a directory input, so module IDs, source hashes and relation IDs agree across the two paths (matrix row 26). The repository's `.kiro/` registers the server (`settings/mcp.json`), instructs Kiro to call `cycles` before an import change and `compare` after it (`steering/refactoring.md`), and runs `pnpm verify` and `pnpm demo:live` (which runs `pnpm hauntmap analyze samples/manor --out public/demo/live.json` only when `samples/manor` differs from the fixture it copies) as command hooks whose trigger names are observed before they are cited. In the app, `src/features/liveSnapshot` registers the **Open live snapshot** toolbar control, which fetches `demo/live.json`, validates it and hands it to `snapshot-comparison` as the newer snapshot, so the corridor Kiro broke closes on screen with every other room in place (matrix row 28). The recorded session of November 22–23 is the H9 acceptance: the transcript, both tool results, the hook-written `live.json` and the app's comparison export are committed under `docs/acceptance/2026-11-24-h9/` and `tests/mcp-agreement.test.ts` asserts they agree (matrix row 27). The Crew agent definitions and `docs/crew.md` are the Kiro Crew bonus evidence (H12).

Owner: kiro, in the worktree `../HauntMap-kiro-integration` (branch `kiro/kiro-integration`), integrated by the integrator of `.kiro/steering/ownership.md`. Folders written: `packages/hauntmap-mcp`, `.kiro/settings`, `.kiro/hooks`, `.kiro/steering/refactoring.md`, `src/features/liveSnapshot`, `samples`, `scripts/demo-reset.ts`, `scripts/demo-live.ts`, `public/demo/live.json`, `tests/kiro`, `tests/mcp-agreement.test.ts`, `tests/e2e/live-snapshot.spec.ts`, `docs/demo/h9-session-script.md`, `docs/acceptance/2026-11-24-h9/`, `docs/crew.md`. Shared files (`package.json` scripts, `pnpm-workspace.yaml`, `src/contracts/validate.ts`, `.gitignore`, `.kiro/steering/ownership.md`) change only through the integrator on a one-line request in the task's log row. Credit budget 600; figures in this document (2,000 ms, 90 s, 120 s) are targets until a `docs/performance.md` or `docs/kiro-log.md` row records them.

Dependencies that must exist on `main` first: `src/contracts/` with the plan's types and the `AnalysisOptions` defaults as an exported constant (*verify* its name; expected `DEFAULT_ANALYSIS_OPTIONS`); `src/analysis` with an entry point that turns a `SourceSet` and `AnalysisOptions` into an `Investigation` (*verify* the export name; expected `analyze`), `cycles` and `trace` in `src/analysis/graph` (`investigation-ui` consumes the same names); `src/analysis/graph/compare.ts` from `snapshot-comparison` (needed by task 9 only); `public/demo/manor/before/` with `expected.json`; `scripts/pack-samples.ts` and `src/features/samples/loadSample.ts` from `investigation-ui`; the registry (`src/features/investigation/registry.ts`) with the `live-snapshot` slot and the `compare` handoff. Until `compare.ts` lands, the `compare` tool is registered with a handler that returns `analysis-failed` with `compare is not available until snapshot-comparison lands` and the agreement test's row-27 cases are the failing tests of task 1c.

## Architecture

```mermaid
flowchart LR
  K["Kiro CLI session<br/>steering: refactoring.md"] -->|"stdio JSON-RPC"| S["dist/index.js<br/>MCP server [kiro]"]
  H["hook analyze-live<br/>(Stop or PostFileSave, verify)"] -->|"pnpm demo:live: skip when samples/manor equals the fixture or dist/cli.js is absent, else hauntmap analyze samples/manor --out public/demo/live.json"| C["dist/cli.js<br/>hauntmap CLI [kiro]"]
  S --> T["tools.ts<br/>analyze · cycles · who_imports · compare"]
  C --> T
  T --> L["loader.ts<br/>Node SourceSet loader<br/>same AnalysisOptions as the app"]
  L --> A["src/analysis [analysis-core]<br/>analyze · cycles · trace"]
  T --> CMP["src/analysis/graph/compare.ts<br/>[snapshot-comparison]"]
  T --> V["src/contracts/validate.ts<br/>validateInvestigation · validateComparison"]
  C -->|"atomic write"| J["public/demo/live.json<br/>(served at demo/live.json)"]
  J -->|"fetch ?t=… no-store"| LS["src/features/liveSnapshot [kiro]<br/>Open live snapshot"]
  LS --> V
  LS -->|"registry.getHandoff('compare')({ before, after, layoutKey })"| SC["snapshot-comparison<br/>union layout · comparison panel"]
  LS -->|"setStatus(message)"| ST["investigation store · status region [investigation-ui]"]
```

The recorded session, in order (Requirement 9):

```mermaid
sequenceDiagram
  participant B as builder
  participant K as Kiro CLI
  participant S as hauntmap MCP server
  participant F as samples/manor
  participant HK as analyze-live hook
  participant APP as app (manor/before open)
  B->>K: prompt of docs/demo/h9-session-script.md
  K->>S: cycles({ root: "samples/manor", preset: "static-value" })
  S-->>K: CycleReport: 1 component [receipt, checkout, charge]
  K->>F: edit src/notifications/receipt.ts (delete the import of ../orders/checkout and its one use)
  K->>S: compare({ rootBefore: "public/demo/manor/before", rootAfter: "samples/manor" })
  S-->>K: ComparisonResult: removedRelations [demo relation], addedRelations []
  K-->>B: final message with the removed relationId, labels and cycle counts 1 → 0
  K->>HK: agent stop
  HK->>HK: pnpm demo:live → samples/manor differs from the fixture → hauntmap analyze samples/manor --out public/demo/live.json → "analyze: 40 modules, …"
  Note over APP: served by `pnpm dev` (reads public/demo/live.json from disk), or rebuilt with `pnpm build && pnpm preview` on camera
  B->>APP: Open live snapshot
  APP->>APP: fetch demo/live.json → validate → compare handoff (before = manor/before, after = live:samples/manor)
  APP-->>B: comparison panel: 1 removed relation; rooms unchanged; corridor closes
```

Open live snapshot, with every outcome (Requirement 8):

```mermaid
sequenceDiagram
  participant U as user
  participant LC as LiveSnapshotControl
  participant O as openLiveSnapshot()
  participant N as fetch
  participant R as registry
  participant ST as store
  U->>LC: activate (click / Enter / Space)
  LC->>O: run({ store, registry, fetchImpl, base, now })
  O->>ST: pending = true (button aria-disabled)
  O->>N: GET base + "demo/live.json?t=" + now(), cache "no-store"
  alt status 404, or 200 non-JSON without a json content-type
    O->>ST: setStatus(MISSING)
  else fetch rejects or other status
    O->>ST: setStatus(FETCH_FAILED(reason))
  else 200 JSON
    O->>O: parse → validateInvestigation
    alt invalid
      O->>ST: setStatus(MALFORMED(firstError))
    else valid
      alt no investigation open
        O->>ST: loadSample("manor/before") → analysisClient.analyze(sourceSet, options) → openInvestigation(inv, map from sourceSet.files, { demo: false })
        Note over O: load failure → setStatus(investigation-ui 1.6 text); analysis rejection → setStatus(SAMPLE_ANALYZE_FAILED(message)); both return "sample-failed"
      end
      alt no compare handoff
        O->>ST: setStatus("Comparison is not available in this build.")
      else
        O->>R: getHandoff("compare")({ before, after: live, layoutKey })
        alt resolves
          O->>ST: setStatus(LOADED(after.sourceLabel, n, before.sourceLabel))
        else rejects (the handoff already wrote its message)
          O->>O: return "compare-failed", no status write
        end
      end
    end
  end
  O->>ST: pending = false
```

### File layout for this spec

| Path | Role | Writer |
| --- | --- | --- |
| `packages/hauntmap-mcp/package.json`, `tsconfig.json`, `build.config.*` | package `hauntmap-mcp` (private), scripts `build`, `test`; bundler configuration producing `dist/index.js` and `dist/cli.js` with every dependency inlined | kiro |
| `packages/hauntmap-mcp/bin/hauntmap.js` | 20-line launcher: checks `dist/cli.js` exists, else prints the not-built message and exits 3; otherwise imports it | kiro |
| `packages/hauntmap-mcp/src/index.ts` | MCP server entry: transport, tool registration, stderr logging | kiro |
| `packages/hauntmap-mcp/src/cli.ts` | argument parsing, exit codes, atomic write | kiro |
| `packages/hauntmap-mcp/src/tools.ts` | the four tool handlers as pure async functions over a `ToolContext`; shared by server and CLI | kiro |
| `packages/hauntmap-mcp/src/loader.ts` | `resolveRoot`, `loadSourceSet`, `sourceLabelFor`, hashing | kiro |
| `packages/hauntmap-mcp/src/errors.ts` | `ToolError` codes and messages | kiro |
| `packages/hauntmap-mcp/README.md` | pinned versions and licenses, build and run instructions, the *verify* ledger of this package | kiro |
| `src/contracts/validate.ts` | `validateInvestigation`, `validateComparison` (requested from the integrator if `analysis-core` has not provided them; shared by app, CLI and server) | kiro via integrator |
| `src/features/liveSnapshot/index.ts`, `openLiveSnapshot.ts`, `LiveSnapshotControl.tsx`, `messages.ts`, `fetchLive.ts` | registration, the orchestration function, the button, the exact strings, the fetch and classification | kiro |
| `samples/manor/**` | committed working copy of `public/demo/manor/before` (included extensions only) | kiro (copied; content owned by the fixtures agent) |
| `scripts/demo-reset.ts`, `scripts/sampleTree.ts` | `pnpm demo:reset`; the shared walker (`listIncluded(root)`, `treesEqual(a, b)`) used by `demo-reset.ts`, `demo-live.ts` and `tests/kiro/sample-copy.test.ts` | kiro |
| `scripts/demo-live.ts` | `pnpm demo:live`: the idempotent wrapper the `analyze-live` hook runs (skip when the sample equals the fixture or `dist/cli.js` is absent, else run the CLI) | kiro |
| `public/demo/live.json` | the committed live snapshot (pre-edit from task 7, the session's post-edit file from task 12) | kiro (written by the CLI, never by hand) |
| `.kiro/settings/mcp.json`, `.kiro/hooks/verify-on-stop.json`, `.kiro/hooks/analyze-live.json`, `.kiro/hooks/README.md`, `.kiro/steering/refactoring.md` | registration, hooks, the hooks' *verify* ledger and observation procedure, steering | kiro |
| `.kiro/<crew path, verify>/*` | Crew agent definitions (only if the pilot passes) | kiro (Crew lead) |
| `tests/kiro/**`, `tests/mcp-agreement.test.ts`, `tests/e2e/live-snapshot.spec.ts` | this spec's tests and fixtures (`tests/kiro/fixtures/`) | kiro |
| `docs/demo/h9-session-script.md`, `docs/acceptance/2026-11-24-h9/**`, `docs/crew.md`, `docs/write-up.md` (section `How Kiro was used`), `docs/kiro-log.md` rows | the session, the Crew evidence, the write-up input | kiro / builder |

Process model: the MCP server is one Node process per Kiro session, started by Kiro from the workspace root with `node packages/hauntmap-mcp/dist/index.js` (*verify* that the installed Kiro starts MCP servers with the workspace as the current directory; if it does not, the relative path in `args` fails to start and the fix is an absolute path or a `cwd` field, *verify*, recorded in the log). Every tool call loads and analyzes its root from scratch; nothing is cached between calls, so an edit is always visible to the next call. The CLI is one process per hook run. The app side runs on the main thread except the analysis of `manor/before` in 8.8, which goes through the analysis worker like any sample.

## Components and Interfaces

### Consumed contracts (verbatim from the plan; defined in `src/contracts/`, never redefined here)

```ts
type SyntaxKind = "import" | "re-export" | "dynamic-literal";
type DependencyKind = "value" | "type" | "mixed";
type Preset = "static-value" | "type-inclusive" | "dynamic-inclusive";
interface SourceFile { path: string; text: string; bytes: number }
interface SourceSet { rootLabel: string; files: SourceFile[]; skipped: { path: string; reason: "excluded-dir" | "extension" | "oversized" | "secret-pattern" | "binary" }[] }
interface AnalysisOptions {
  preset: Preset;
  includeExtensions: string[]; excludeDirectories: string[]; excludeFilePatterns: string[];
  maxFiles: number; maxFileBytes: number; maxTotalBytes: number;
  jsToTsFallback: true;
}
interface ModuleRecord { id: string; sourceHash: string; language: "js" | "jsx" | "ts" | "tsx"; parseStatus: "ok" | "partial" | "failed" }
interface ImportRecord {
  occurrenceId: string; relationId: string;
  from: string; to: string | null; specifier: string;
  syntaxKind: SyntaxKind; dependencyKind: DependencyKind;
  resolution: "local" | "external" | "unresolved" | "unsupported";
  line: number; column: number;
  reason?: "absent-file" | "alias-not-configured" | "nonliteral-dynamic" | "unsupported-construct" | "ambiguous-candidate";
}
interface Diagnostic { code: "parse-failed" | "unresolved" | "unsupported" | "case-collision" | "duplicate-path" | "oversized" | "cap-reached"; module?: string; line?: number; column?: number; specifier?: string; message: string }
interface Investigation { schemaVersion: 1; resolverMode: "documented-source-subset"; sourceLabel: string; modules: ModuleRecord[]; imports: ImportRecord[]; diagnostics: Diagnostic[]; options: AnalysisOptions }
interface TraceResult { origin: string; direction: "imports" | "imported-by"; preset: Preset; visited: string[]; direct: string[]; indirect: string[]; predecessor: Record<string, string>; distance: Record<string, number> }
interface CyclicComponent { members: string[]; witness: { modules: string[]; relationIds: string[] } }
interface CycleReport { preset: Preset; components: CyclicComponent[] }
interface RelationRef { relationId: string; from: string; to: string | null; specifier: string; syntaxKind: SyntaxKind; dependencyKind: DependencyKind; resolution: ImportRecord["resolution"] }
interface ComparisonResult {
  schemaVersion: 1; preset: "static-value";
  before: { label: string; moduleCount: number; relationCount: number }; after: { label: string; moduleCount: number; relationCount: number };
  addedModules: string[]; removedModules: string[]; changedModules: string[];
  addedRelations: RelationRef[]; removedRelations: RelationRef[];
  cyclicComponentsBefore: number; cyclicComponentsAfter: number;
}
```

Analysis entry points consumed (names *verify* when `analysis-core` lands; recorded in `packages/hauntmap-mcp/README.md` by task 1a): `analyze(sourceSet: SourceSet, options: AnalysisOptions): Investigation` from `src/analysis`; `cycles(investigation, preset): CycleReport` and `trace(investigation, origin, direction, preset): TraceResult` from `src/analysis/graph`; `compare(before: Investigation, after: Investigation): ComparisonResult` from `src/analysis/graph/compare.ts`; `DEFAULT_ANALYSIS_OPTIONS: Omit<AnalysisOptions, "preset">` from `src/contracts`. `analyze` is synchronous and CPU-bound (Babel); the server awaits nothing during it, which is acceptable for the 40-module sample and the 1,000-file cap.

### Loader (`packages/hauntmap-mcp/src/loader.ts`)

```ts
export type RootError =
  | { code: "root-outside-workspace"; message: string }
  | { code: "root-not-found"; message: string }
  | { code: "cap-reached"; message: string };

export interface ResolvedRoot { given: string; absolute: string; label: string }   // label = sourceLabelFor(given)

export function sourceLabelFor(root: string): string;
// "live:" + root with "\\" → "/", one leading "./" removed, trailing "/" removed; "samples/manor" → "live:samples/manor"

export async function resolveRoot(workspaceRoot: string, root: string, fs?: FsLike): Promise<{ ok: true; root: ResolvedRoot } | { ok: false; error: RootError }>;
// path.resolve(workspaceRoot, root) → fs.realpath; ok only if realpath === workspaceRoot or realpath.startsWith(workspaceRoot + path.sep);
// ENOENT / not a directory → root-not-found; outside → root-outside-workspace (checked before existence so nothing outside is stat-ed beyond realpath)

export async function loadSourceSet(root: ResolvedRoot, options: AnalysisOptions, fs?: FsLike): Promise<{ ok: true; sourceSet: SourceSet } | { ok: false; error: RootError }>;
// walk(root.absolute): readdir with withFileTypes, entries sorted by name with (a < b ? -1 : a > b ? 1 : 0) (code-point order), directories and files interleaved in that order, depth-first;
// directory whose name is in options.excludeDirectories → skipped { path: rel + "/", reason: "excluded-dir" }, not entered;
// file: basename matches an excludeFilePatterns glob (".env" exact, ".env.*", "*.pem", "*.key", "id_rsa*"; matching on the basename only, case-sensitive) → "secret-pattern";
//       extension not in includeExtensions (last "." of the basename; a basename starting with "." and without another "." has no extension) → "extension";
//       stat.size > options.maxFileBytes → "oversized" (not read);
//       first min(size, 8192) bytes contain 0x00 → "binary";
//       else included: text = new TextDecoder("utf-8").decode(bytes) (BOM removed; no newline normalization), bytes = stat.size;
// counts: included files > options.maxFiles → cap-reached (files message, first excluded = the 1001st included path);
//         running sum of included bytes > options.maxTotalBytes → cap-reached (bytes message, first excluded = the file that crossed the limit);
// symlinks: readdir entries that are symlinks are resolved with realpath; one that resolves outside the workspace is skipped silently and recorded in a stderr log line (never followed);
// result: files sorted by path (code-point order), rootLabel = root.label

export function sha256Hex(text: string): string;   // node:crypto createHash("sha256").update(text, "utf8").digest("hex")
```

Whether the hash is computed by the loader or by `src/analysis` is `analysis-core`'s decision (*verify*): if `analyze` hashes `SourceFile.text` itself, `sha256Hex` is used only by the agreement test to cross-check; if `analyze` expects a precomputed hash, the loader supplies it through the field `analysis-core` names. Either way the input to the hash is the decoded text re-encoded as UTF-8, on both paths.

`FsLike` is the subset of `node:fs/promises` used (`readdir`, `stat`, `lstat`, `realpath`, `open`/`read` for the 8 KiB probe, `readFile`), injected so `tests/kiro/loader.test.ts` and the property tests run on temp directories and on an in-memory fake with symlink entries.

### Tools (`packages/hauntmap-mcp/src/tools.ts`)

```ts
export interface ToolContext {
  workspaceRoot: string;                 // process.cwd() at startup, realpath-ed
  fs?: FsLike;
  analysis: {                            // injected so tests can stub; production wires src/analysis
    analyze(sourceSet: SourceSet, options: AnalysisOptions): Investigation;
    cycles(investigation: Investigation, preset: Preset): CycleReport;
    trace(investigation: Investigation, origin: string, direction: "imports" | "imported-by", preset: Preset): TraceResult;
    compare?: (before: Investigation, after: Investigation) => ComparisonResult;   // absent until snapshot-comparison lands
  };
  validate: { investigation(value: unknown): ValidationResult; comparison(value: unknown): ValidationResult };
  defaults: Omit<AnalysisOptions, "preset">;
  log(line: string): void;              // stderr
}

export type ToolErrorCode = "invalid-arguments" | "invalid-preset" | "root-outside-workspace" | "root-not-found" | "cap-reached" | "module-not-found" | "analysis-failed";
export interface ToolError { error: { code: ToolErrorCode; message: string } }
export type ToolResult<T> = { ok: true; value: T } | { ok: false; error: ToolError["error"] };

export const PRESETS: readonly Preset[] = ["static-value", "type-inclusive", "dynamic-inclusive"];

export async function analyzeTool(ctx: ToolContext, args: unknown): Promise<ToolResult<Investigation>>;
export async function cyclesTool(ctx: ToolContext, args: unknown): Promise<ToolResult<CycleReport>>;
export async function whoImportsTool(ctx: ToolContext, args: unknown): Promise<ToolResult<TraceResult>>;
export async function compareTool(ctx: ToolContext, args: unknown): Promise<ToolResult<ComparisonResult>>;

// shared steps, in this order:
// 1. parseArgs: args must be an object; each required field a non-empty string → else invalid-arguments `Argument "<name>" must be a string.`;
//    preset absent → "static-value"; present but not in PRESETS → invalid-preset;
// 2. resolveRoot (root-outside-workspace / root-not-found);
// 3. loadSourceSet (cap-reached);
// 4. ctx.analysis.analyze inside try/catch → a throw becomes analysis-failed `Analysis of "<root>" failed: <error message>.` (never a stack, never a path outside the root);
// 5. the tool-specific step: cycles → ctx.analysis.cycles(inv, preset); who_imports → module must be in inv.modules (module-not-found) then ctx.analysis.trace(inv, module, "imported-by", preset);
//    compare → both roots through steps 2–4 with messages prefixed "rootBefore: " / "rootAfter: ", then ctx.analysis.compare (absent → analysis-failed `compare is not available until snapshot-comparison lands`);
// 6. validation of the produced value with ctx.validate (a failure is analysis-failed `internal error, output failed validation: <first error>` and is logged to stderr).
```

Tool input schemas, as registered with the SDK (JSON Schema draft the SDK expects, *verify*):

| Tool | Input schema | Description string |
| --- | --- | --- |
| `analyze` | `{ type: "object", required: ["root"], properties: { root: { type: "string", description: "Directory relative to the workspace root, e.g. samples/manor" }, preset: { type: "string", enum: ["static-value", "type-inclusive", "dynamic-inclusive"], default: "static-value" } }, additionalProperties: false }` | `Analyze the JavaScript/TypeScript import graph of a directory inside this workspace and return HauntMap's versioned investigation JSON (source text omitted).` |
| `cycles` | same as `analyze` | `Return the dependency cycles (strongly connected components with one witness each) of a directory under a preset.` |
| `who_imports` | `analyze`'s schema plus `module: { type: "string", description: "Module ID relative to the root, e.g. src/orders/checkout.ts" }`, `required: ["root", "module"]` | `Return the direct and indirect importers of a module, with a shortest path for each.` |
| `compare` | `{ type: "object", required: ["rootBefore", "rootAfter"], properties: { rootBefore: { type: "string" }, rootAfter: { type: "string" } }, additionalProperties: false }` | `Compare two directories' import graphs by structural relation ID and return the removed and added relations, changed modules and cycle counts.` |

Output: `{ content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value }` on success (`structuredContent` only if the pinned SDK supports it, *verify*; otherwise the text item alone); `{ content: [{ type: "text", text: JSON.stringify(toolError) }], isError: true }` on failure (*verify* the flag's name on the pinned SDK). The text is not indented (one line), so a transcript shows it compactly; the CLI writes indented files.

### Server (`packages/hauntmap-mcp/src/index.ts`)

```ts
// startup: workspaceRoot = await fs.realpath(process.cwd()); ctx = createContext(workspaceRoot);
// server = new McpServer({ name: "hauntmap", version: <package version> })  (constructor and registration method names verify on the pinned SDK)
// register the four tools with the schemas above; each handler: const r = await <tool>(ctx, args); return r.ok ? success(r.value) : failure(r.error);
// transport: stdio; process.stdout is reserved for the transport; all diagnostics go through ctx.log → process.stderr with the prefix "hauntmap-mcp: ";
// on SIGINT/SIGTERM: close the transport and exit 0; an unhandled rejection logs one line to stderr and exits 1 (never prints to stdout)
```

### CLI (`packages/hauntmap-mcp/src/cli.ts`, launched by `bin/hauntmap.js`)

```ts
export const USAGE = [
  "Usage: hauntmap analyze <root> --out <file> [--preset static-value|type-inclusive|dynamic-inclusive]",
  "       hauntmap compare <before> <after> --out <file>",
].join("\n");

export type ExitCode = 0 | 2 | 3 | 4 | 5 | 6;
export async function main(argv: string[], io: { cwd: string; stdout(s: string): void; stderr(s: string): void; fs?: FsLike }): Promise<ExitCode>;
// 1. cwd must contain package.json with name "hauntmap" (verify the root package name) → else stderr `hauntmap: run from the HauntMap repository root (no package.json named hauntmap in <cwd>).`, exit 4
// 2. parse: subcommand analyze|compare; positional roots; --out <file> required; --preset optional (analyze only); anything else → USAGE, exit 2; invalid preset → `hauntmap: Preset "<p>" is not one of static-value, type-inclusive, dynamic-inclusive.`, exit 2
// 3. run the tool with ctx.workspaceRoot = realpath(cwd); error codes map: root-outside-workspace | root-not-found | cap-reached → exit 4; analysis-failed from validation → exit 5; other analysis-failed → exit 4; message printed as `hauntmap: <message>`
// 4. write: JSON.stringify(value, null, 2) + "\n" to path.resolve(cwd, out) + ".tmp" then fs.rename over out; any fs error → `hauntmap: cannot write <file> (<err.code>).`, exit 6, and the .tmp is removed if it exists
// 5. stdout: `analyze: <modules> modules, <relations> relations, <diagnostics> diagnostics → <out>` (relations = distinct relationId count) or `compare: <removed> removed, <added> added, <changed> changed modules → <out>`; exit 0
```

`bin/hauntmap.js`: resolves `../dist/cli.js` relative to its own location; if absent, prints `hauntmap: the CLI is not built. Run pnpm build:mcp first.` to stderr and exits 3; otherwise `import()`s it and calls `main(process.argv.slice(2), { cwd: process.cwd(), … })`, exiting with the returned code.

Root `package.json` scripts added by the integrator: `"build:mcp": "pnpm --filter hauntmap-mcp build"` (*verify* the filter syntax and that the package name in `packages/hauntmap-mcp/package.json` is `hauntmap-mcp`), `"hauntmap": "node packages/hauntmap-mcp/bin/hauntmap.js"`, `"demo:reset": "node --import tsx scripts/demo-reset.ts"` (runner *verify*: the same TypeScript runner `scripts/pack-samples.ts` uses). `pnpm verify` gains `tests/kiro/**` and `tests/mcp-agreement.test.ts` (node environment; `tests/kiro/live-snapshot.test.tsx` in jsdom) and `pnpm verify:e2e` gains `tests/e2e/live-snapshot.spec.ts`.

### Validators (`src/contracts/validate.ts`)

```ts
export interface ValidationResult { ok: true } | { ok: false; errors: string[] }   // errors in document order; the first is shown to users
export function validateInvestigation(value: unknown): ValidationResult;
export function validateComparison(value: unknown): ValidationResult;
```

Checks and their exact error strings (the first failing check wins for the user-visible message; all are collected for tests):

| Check | Error string |
| --- | --- |
| value is a plain object | `document must be a JSON object` |
| `schemaVersion === 1` | `schemaVersion must be 1 (found <JSON of value or "missing">)` |
| `resolverMode === "documented-source-subset"` | `resolverMode must be "documented-source-subset" (found <…>)` |
| `sourceLabel` is a string | `sourceLabel must be a string` |
| `modules`, `imports`, `diagnostics` are arrays | `<field> must be an array` |
| each module: `id` string, `sourceHash` 64 lowercase hex, `language` in the four values, `parseStatus` in the three values | `modules[<i>].<field> must be <expectation>` |
| module IDs unique | `modules[<i>].id duplicates modules[<j>].id` |
| each import: `occurrenceId` and `relationId` strings that parse as JSON arrays of 4 elements whose first element equals `from`; `from` is a module ID; `to` is null or a module ID; `specifier` string; `syntaxKind`, `dependencyKind`, `resolution` in their enums; `line` and `column` integers ≥ 1; `reason` absent or in its enum; `resolution: "local"` ⇔ `to !== null` | `imports[<i>].<field> must be <expectation>` |
| `options` object with `preset` in the enum and the six numeric/array fields present | `options.<field> must be <expectation>` |
| no element anywhere has a `text` property | `imports[<i>] must not carry source text` / `modules[<i>] must not carry source text` |
| comparison: `schemaVersion === 1`, `preset === "static-value"`, `before`/`after` with string label and non-negative integer counts, the five arrays, relation refs with the enum fields, `cyclicComponentsBefore/After` non-negative integers, the three module lists sorted, the two relation lists sorted by `relationId` | `<field> must be <expectation>` |

JSON parse failures are reported by the caller as `file is not JSON (<SyntaxError message>)`; the validator receives parsed values only. The validator uses no schema library (plain TypeScript; no new dependency), so the app bundle and the Node bundles share one 200-line file.

### Live snapshot feature (`src/features/liveSnapshot/`)

```ts
// messages.ts
export const LIVE_PATH = "demo/live.json";
export const MSG_MISSING = "No live snapshot yet. Run `pnpm hauntmap analyze samples/manor --out public/demo/live.json`, or let the Kiro hook write it.";
export const msgMalformed = (firstError: string) => `The live snapshot at demo/live.json is not valid: ${firstError}. The current view is unchanged.`;
export const msgFetchFailed = (reason: string) => `The live snapshot could not be fetched (${reason}). The current view is unchanged.`;
export const MSG_NO_COMPARE = "Comparison is not available in this build.";
export const msgLoaded = (afterLabel: string, modules: number, beforeLabel: string) =>
  `Live snapshot loaded: ${afterLabel} (${modules} modules) is the newer snapshot; ${beforeLabel} is the older one.`;

// fetchLive.ts
export type LiveFetch =
  | { kind: "missing" }                                   // 404; or 200 with non-JSON body and a content-type without "json"
  | { kind: "fetch-failed"; reason: string }              // rejection → error.name; other status → String(status)
  | { kind: "malformed"; firstError: string }             // JSON parse failure with a json content-type or a body starting with "{" → "file is not JSON (<message>)"; or validator errors[0]
  | { kind: "valid"; investigation: Investigation };
export async function fetchLive(base: string, fetchImpl: typeof fetch, now: () => number, validate: (v: unknown) => ValidationResult): Promise<LiveFetch>;
// GET `${base}${LIVE_PATH}?t=${now()}` with { cache: "no-store" }; no headers, no credentials ("same-origin" default is fine; credentials: "omit" set explicitly)

// openLiveSnapshot.ts
export interface LiveDeps {
  store: InvestigationStore;                              // investigation-ui's store
  registry: Registry;                                     // investigation-ui's registry
  base: string;                                           // import.meta.env.BASE_URL (verify on the pinned Vite)
  fetchImpl?: typeof fetch; now?: () => number;
  loadSample: typeof loadSample;                          // src/features/samples/loadSample.ts
  analysisClient: { analyze(sourceSet: SourceSet, options: AnalysisOptions): Promise<Investigation> };   // the analysis client of src/workers/client.ts, the shape investigation-ui task 1a settles (its single *verify*); the source map is built here from sourceSet.files
  defaults: Omit<AnalysisOptions, "preset">;              // DEFAULT_ANALYSIS_OPTIONS from src/contracts
  validate: typeof validateInvestigation;
}
export const msgSampleAnalyzeFailed = (message: string) => `The manor sample could not be analyzed (${message}). Reload the page or analyze a local folder.`;
export type LiveOutcome = "missing" | "fetch-failed" | "malformed" | "no-compare" | "sample-failed" | "compare-failed" | "loaded";
export async function openLiveSnapshot(deps: LiveDeps): Promise<LiveOutcome>;
// 1. if a run is pending → return the pending promise (no second fetch);
// 2. result = await fetchLive(...); on missing / fetch-failed / malformed → setStatus(message); return;
// 3. if store.getState().investigation === null → s = await loadSample("manor/before", base); !s.ok → setStatus(s.message), return "sample-failed";
//    try { investigation = await analysisClient.analyze(s.sourceSet, { ...defaults, preset: "static-value" }) } catch (e) { setStatus(msgSampleAnalyzeFailed(e.message)); return "sample-failed" }
//    sourceText = new Map(s.sourceSet.files.map(f => [f.path, f.text])); store.actions.openInvestigation(investigation, sourceText, { demo: false });
// 4. handoff = registry.getHandoff("compare"); null → setStatus(MSG_NO_COMPARE), return "no-compare";
// 5. try { await handoff({ before: store.getState().investigation, after: result.investigation, layoutKey: store.getState().layout?.layoutKey ?? null }) }
//    catch { return "compare-failed" }   // the handoff wrote its own message (snapshot-comparison 1.4, 10.6); no second status write; the view stays as the handoff left it
//    setStatus(msgLoaded(after.sourceLabel, after.modules.length, before.sourceLabel)); return "loaded"
// the function never touches selection, camera, routeFilter, expandedWings or panel; the handoff owns the comparison state; nothing escapes as an unhandled rejection

// LiveSnapshotControl.tsx
export function LiveSnapshotControl(props: { store: InvestigationStore }): JSX.Element;
// <button type="button" aria-disabled={pending} onClick={run}>Open live snapshot</button>; Enter and Space are the button's native activation;
// run() ignores activation while pending; deps are taken from a module-level `configure(deps)` called by index.ts at app start (tests call configure with fakes)

// index.ts
export function registerLiveSnapshot(deps: LiveDeps): void;   // configure(deps); registry.registerControl("live-snapshot", LiveSnapshotControl)
```

The live investigation enters the app only through the compare handoff: `snapshot-comparison` computes the `ComparisonResult`, requests the union layout with the given `layoutKey` so common rooms keep their coordinates, applies the comparison styling and opens its panel. This spec reads nothing from that result; the loaded message uses the two `sourceLabel`s and the module count, which it has before the handoff.

### Hooks (`.kiro/hooks/`)

`verify-on-stop.json`:

```json
{
  "version": "v1",
  "hooks": [
    {
      "name": "verify-on-stop",
      "trigger": "Stop",
      "action": { "type": "command", "command": "pnpm verify" },
      "timeout": 600
    }
  ]
}
```

`analyze-live.json` at scaffold (two entries; the unobserved one is deleted by task 7):

```json
{
  "version": "v1",
  "hooks": [
    {
      "name": "analyze-live",
      "trigger": "Stop",
      "action": { "type": "command", "command": "pnpm demo:live" },
      "timeout": 120
    },
    {
      "name": "analyze-live-on-save",
      "trigger": "PostFileSave",
      "matcher": "^samples/manor/.*\\.(js|jsx|ts|tsx|mjs|mts)$",
      "action": { "type": "command", "command": "pnpm demo:live" },
      "timeout": 120
    }
  ]
}
```

`scripts/demo-live.ts` (`pnpm demo:live`, root script `"demo:live": "node --import tsx scripts/demo-live.ts"`, the same runner as `demo:reset`, *verify*):

```ts
// 1. if packages/hauntmap-mcp/dist/cli.js is absent → stdout "demo:live: skipped (dist/cli.js absent; run pnpm build:mcp)", exit 0
// 2. if treesEqual("samples/manor", "public/demo/manor/before") (scripts/sampleTree.ts: every file with an included extension present in both trees with byte-equal content, the comparison of 1.4)
//    → stdout "demo:live: skipped (samples/manor is identical to public/demo/manor/before)", exit 0, nothing written
// 3. else spawn node packages/hauntmap-mcp/bin/hauntmap.js analyze samples/manor --out public/demo/live.json with inherited stdio and exit with its code
// the runner (step 3) is injected so tests/kiro/demo-live.test.ts covers the three branches without building the CLI
```

The wrapper exists so that the hook is idempotent: after task 12 commits the post-edit `live.json` and resets the sample, every later Kiro turn in any checkout skips, the committed file stays byte-identical to the session copy (9.5) and a worktree without `dist/` never fails on stop (6.8).

*verify* on the installed CLI 3.x and IDE on November 4, recorded in `.kiro/hooks/README.md` and the log: the trigger values `Stop` and `PostFileSave` (the IDE lists "on agent stop" and "on file save"; the CLI 3.x names are PascalCase per `research/rules-and-credits-check-2026-11-03.md`); `version: "v1"`; whether `matcher` is a regular expression or a glob (glob form `samples/manor/**/*.{js,jsx,ts,tsx,mjs,mts}`); the `timeout` field and its unit (seconds assumed); that `action.command` runs from the workspace root; whether the IDE reads standalone `.kiro/hooks/*.json` files or needs the hook created in its panel. `.kiro/hooks/README.md` follows the CardForge hooks README's structure (table of files, the *verify* ledger, the observation procedure, the rules) with this repository's commands.

Observation procedure (tasks 2 and 7): `pnpm verify` passes from a terminal first; in the session surface, ask for a one-line answer and let the turn end (stop trigger) or save `samples/manor/src/notifications/receipt.ts` with a whitespace-only change (save trigger); record whether each hook fired, the first and last output lines, the duration, a screenshot under `docs/acceptance/img/2026-11-<dd>-hook-<name>.png`, and the log row; revert the whitespace change and `git checkout public/demo/live.json`. A hook that did not fire on IDE 1.4.62 is retried once after updating the IDE; the CLI is already 3.x on November 4.

### MCP registration (`.kiro/settings/mcp.json`)

```json
{
  "mcpServers": {
    "hauntmap": {
      "command": "node",
      "args": ["packages/hauntmap-mcp/dist/index.js"],
      "env": {},
      "disabled": false,
      "autoApprove": ["cycles", "who_imports"]
    }
  }
}
```

`analyze` and `compare` are not auto-approved: they read two roots or write nothing, but a per-call approval keeps the recorded session showing Kiro's intent for the `compare` call. *verify* on November 9: that the installed Kiro reads `.kiro/settings/mcp.json` from the workspace (not only the user-level file), the `autoApprove` key, and that the server starts with the workspace as the current directory (see Process model). `pnpm build:mcp` must have run; `README.md` and `docs/demo/h9-session-script.md` say so.

### Steering (`.kiro/steering/refactoring.md`, under 60 lines)

```markdown
---
inclusion: always
---
# Refactoring with HauntMap

HauntMap's own analysis is available to you as the MCP server `hauntmap` (tools `analyze`, `cycles`, `who_imports`, `compare`). Roots are directories relative to the repository root, such as `samples/manor`.

## Before changing imports
- Before you add, remove, change or move any import, re-export or module file in an analyzed root, call `cycles(root, "static-value")` and keep the component list in your notes.
- If you need to know who depends on a module you are about to change, call `who_imports(root, module, "static-value")` and read `direct` and `indirect`.

## After changing imports
- Call `compare(rootBefore, rootAfter)` with the untouched copy as `rootBefore`. For `samples/manor`, `rootBefore` is `public/demo/manor/before`. For any other root, copy it to `.hauntmap/before/<name>` before your first edit (the folder is git-ignored) and use that copy.
- End your final message with: every `relationId` in `removedRelations` under the heading `Removed relations`, every `relationId` in `addedRelations` under `Added relations`, the two labels, and `cyclicComponentsBefore → cyclicComponentsAfter`, copied from the tool result. If you did not run `compare`, write `compare was not run`.

## What you may edit
- `public/demo/manor/before`, `public/demo/manor/after` and `public/demo/annex` are fixtures owned by `analysis-core`. Never edit them.
- Live edits for a demonstration go to `samples/manor`; `pnpm demo:reset` restores it from `public/demo/manor/before`.
- Do not run `hauntmap` tools on directories outside this repository.

## What the result means
- A removed or added relation is a structural fact about static imports under the named preset. It is not a correctness, safety or performance claim; say so if you summarize it.
- Report only what the tools returned. The claims policy applies.
```

### Sample working copy and reset (`samples/manor`, `scripts/demo-reset.ts`)

`samples/manor/` holds every file of `public/demo/manor/before/` whose extension is one of the six included ones, at the same relative path; `expected.json`, `sources.json` and any other file are not copied. `scripts/demo-reset.ts`: `rm -rf samples/manor`, walk `public/demo/manor/before` with the same extension filter (`listIncluded` of `scripts/sampleTree.ts`), copy, print `demo:reset: samples/manor restored from public/demo/manor/before (<n> files)`, exit 0; any fs error prints `demo:reset: <message>` and exits 1. `scripts/demo-live.ts` (above) reuses `treesEqual` from the same helper, so the hook's notion of "unchanged" is the test's (1.4). The fixtures agent is asked (task 1a log row) to author `src/notifications/receipt.ts` so that it imports exactly one binding from the module resolving to `src/orders/checkout.ts` (specifier *verify* from the sample; expected `../orders/checkout`), used in exactly one statement that can be deleted without adding an import; that keeps the recorded edit to two deleted lines.

### Crew agent definitions

Path and format *verify* on the installed Crew version (open decision of November 4; the pilot's definitions are written by the Crew lead under `analysis-core` and this spec commits them to `main` on November 6–7 after a pass, task 13a, and documents them, task 13b). `docs/decisions.md` carries two machine-read lines, written by the Crew lead on November 4 and 6:

```
crew-definitions-path: .kiro/<path>
crew-pilot-verdict: pass|fail
```

Whatever the format, each definition carries: the agent name (`parser`, `graph`, `fixtures`, `renderer`); the spec it serves; a block introduced by a line reading `Folders` (a Markdown heading or a comment line, whichever the format allows) followed by one line per folder with the path in backticks, exactly the backticked paths of that agent's `.kiro/steering/ownership.md` row outside parentheses, ending at the first blank line; the verify command `pnpm verify`; the instruction to append its `docs/kiro-log.md` row the same day; and the credit cap per task (100 during the pilot). `tests/kiro/crew-config.test.ts` parses the two lines (regular expressions `^crew-definitions-path: (\.kiro\/\S+)$` and `^crew-pilot-verdict: (pass|fail)$`), skips with `pilot verdict: fail` on a fail, and otherwise compares, per agent, the set of backticked paths under `Folders` with the set of backticked paths in the ownership row's Folder cell after removing every parenthesized span; `tests/kiro/fixtures/decisions-sample.md` is a sample `docs/decisions.md` (`crew-definitions-path: .kiro/crew-sample`, `crew-pilot-verdict: pass`, with the parse the test expects: `{ path: ".kiro/crew-sample", verdict: "pass" }`; the real path comes from the installed version). `docs/crew.md` lists the path, the agents, the pilot criteria and measured values with their log rows, and the dates each agent ran.

## Data Models

| Record | Where | Identity and version | Content and invariants |
| --- | --- | --- | --- |
| `Investigation` (live) | `public/demo/live.json`; MCP `analyze` result | `schemaVersion: 1`, `resolverMode: "documented-source-subset"`, `sourceLabel: "live:<root>"` | modules, imports, diagnostics, options; no `text` property anywhere; `options.preset` is the requested preset; module IDs unique; produced by `src/analysis` from the loader's `SourceSet`; byte-identical for byte-identical roots (P1) |
| `SourceSet` (Node) | loader output, in memory | `rootLabel` = `live:<root>` | `files` sorted by path; every file has an included extension, no excluded segment, size ≤ 1,048,576, no NUL in its first 8 KiB; `skipped` carries one entry per excluded directory and per skipped file; `files.length ≤ 1000`; `Σ bytes ≤ 26,214,400` |
| `CycleReport`, `TraceResult` | MCP results | by request (`root`, `preset`, `module`) | as produced by `src/analysis/graph`; never altered by the tool layer |
| `ComparisonResult` | MCP `compare` result; `hauntmap compare --out`; `docs/acceptance/2026-11-24-h9/mcp-compare.json` | `schemaVersion: 1`, `preset: "static-value"`, `before.label` / `after.label` = the two source labels | as produced by `compare.ts`; relation lists sorted by `relationId`; module lists sorted; for the H9 pair: `removedRelations = [demo relation]`, `addedRelations = []`, `changedModules = ["src/notifications/receipt.ts"]`, cycle counts `1 → 0` |
| `ToolError` | MCP error results; CLI stderr | `code` ∈ the seven codes | `{ error: { code, message } }`; message never contains a path outside the workspace, a stack or source text |
| `ToolContext` | server and CLI process memory | one per process | `workspaceRoot` is a realpath; `analysis` and `validate` are the injected modules; nothing cached across calls |
| Hook file | `.kiro/hooks/*.json` | `version: "v1"` (*verify*), `hooks[].name` unique per file | `trigger` is an observed name or the file is not cited; `action.type` is always `command`; commands `pnpm verify` (or `HAUNTMAP_FAST=1 pnpm verify`) and `pnpm demo:live`; `timeout` 600 (`verify-on-stop`) or 120 (`analyze-live`) |
| `demo:live` outcome | stdout of `scripts/demo-live.ts` | — | `demo:live: skipped (dist/cli.js absent; run pnpm build:mcp)`, `demo:live: skipped (samples/manor is identical to public/demo/manor/before)`, or the CLI's own `analyze:` line; exit 0 in the first two cases, the CLI's code in the third |
| MCP registration | `.kiro/settings/mcp.json` | server key `hauntmap` | `command: "node"`, `args: ["packages/hauntmap-mcp/dist/index.js"]`, `autoApprove: ["cycles", "who_imports"]`, `disabled: false` |
| `LiveFetch` | `fetchLive` result, in memory | by `kind` | `missing`, `fetch-failed(reason)`, `malformed(firstError)`, `valid(investigation)`; exactly one per activation |
| Live-snapshot pending flag | `src/features/liveSnapshot` module state | one per app | `pending: Promise<LiveOutcome> \| null`; a second activation while pending returns the same promise; cleared in `finally` |
| Session artifacts | `docs/acceptance/2026-11-24-h9/` | folder name = gate date | `transcript.md`, `mcp-cycles.json`, `mcp-compare.json`, `live.json`, `app-comparison-export.json`, `recording.md`, `credits.md`; `live.json` equals the committed `public/demo/live.json` byte for byte; `mcp-compare.json` and `app-comparison-export.json` have deep-equal `removedRelations` and `addedRelations` |
| Kiro log row | `docs/kiro-log.md` | date + task | seven cells per the `kiro/FORMAT.md` template; task cell `kiro-integration, task <n>` or `kiro-integration, task <n> (<label>)` with the label `Setup: hook observation verify-on-stop` (2), `Setup: MCP registration` (6), `Setup: hook observation analyze-live` (7) or `H9 session` (12); one row per task part; no `EXAMPLE` date, no `0000000` commit; credits of every row starting with `kiro-integration` sum ≤ 600 |
| Crew agent definition | `.kiro/<crew path, verify>/<agent>.*` | agent name | `Folders` block equal to the backticked paths of the agent's `ownership.md` row outside parentheses; spec; `pnpm verify`; log instruction; credit cap |
| `docs/decisions.md` lines | `docs/decisions.md` | — | `crew-definitions-path: .kiro/<path>` (November 4), `crew-pilot-verdict: pass|fail` (November 6), `layout-engine: dagre|elk` (November 6, investigation-ui task 0) |
| `samples/manor` | repository | mirror of `public/demo/manor/before` (included extensions) | byte-identical to the fixture in the committed state; the only root a demo session edits; restored by `pnpm demo:reset` |

Invariants checked by the named tests:

- I1 Path agreement (2.4): for the same directory, the loader's sorted file paths equal the sorted paths of the `SourceSet` that `scripts/pack-samples.ts` produces, and every included path is relative, forward-slashed and without `./`.
- I2 Hash agreement (2.3): for every included file, `sha256Hex(text)` equals the Web Crypto digest of `new TextEncoder().encode(await new Blob([bytes]).text())`.
- I3 Error totality (3.6): every tool call returns either a validated value or a `ToolError` with a listed code; it never throws, writes or returns both.
- I4 Containment (2.6): no tool reads a path whose realpath is outside `workspaceRoot`; the injected `FsLike` records every path touched and the test asserts the prefix.
- I5 Atomic output (5.2, 5.4): after any CLI run, `<out>` is either untouched or a complete, validated JSON document, and `<out>.tmp` does not exist.
- I6 View preservation (8.3–8.5): on any outcome other than `loaded`, `store.getState()` is deep-equal before and after `openLiveSnapshot`, except `status`.
- I7 Camera and selection preservation (8.6): on `loaded`, `camera`, `selection`, `routeFilter` and `expandedWings` are deep-equal before and after (the handoff may change `layout`, `panel` and comparison state).
- I8 Live file provenance (6.7, 9.5): the committed `public/demo/live.json` has `sourceLabel: "live:samples/manor"` and equals the session copy once the session folder exists.
- I9 Observation before citation (6.5): no citation of a hook name outside `.kiro/hooks/` and the log without an observation row.
- I10 Credits (10.4): the sum of credits of every row whose task cell starts with `kiro-integration` ≤ 600.
- I11 Hook idempotence (6.8, 9.5): running `pnpm demo:live` on a `samples/manor` that equals the fixture changes no file; running it twice on an edited sample yields byte-identical `live.json` files.

## Error Handling

Every failure is a typed value (`ToolResult`, `LiveFetch`, `LiveOutcome`, an exit code) and never an uncaught exception at a process or UI boundary. Messages name the root, file or field involved and nothing else: no stack traces, no absolute paths outside the workspace, no source text. On every failure the previous state is preserved: the CLI leaves `<out>` untouched, the server returns no partial value, the app leaves the investigation and view unchanged.

| Situation | Where | Exact user-visible text | Code / exit | Preserved |
| --- | --- | --- | --- | --- |
| Tool argument missing or not a string (3.5) | MCP error result | `Argument "<name>" must be a string.` | `invalid-arguments` | — |
| Unknown preset (3.5, 5.4) | MCP error; CLI stderr `hauntmap: ` prefix | `Preset "<value>" is not one of static-value, type-inclusive, dynamic-inclusive.` | `invalid-preset` / exit 2 | `<out>` |
| Root outside the workspace, including a symlink escape (2.6) | MCP error; CLI | `Root "<root>" resolves outside the working directory "<workspaceRoot>".` | `root-outside-workspace` / exit 4 | nothing read |
| Root missing or not a directory (2.7) | MCP error; CLI | `Root "<root>" does not exist or is not a directory.` | `root-not-found` / exit 4 | — |
| More than 1000 included files (2.5) | MCP error; CLI | `Root "<root>" has more than 1000 included files; first excluded: <path>.` | `cap-reached` / exit 4 | no `Investigation` |
| Included text over 25 MiB (2.5) | MCP error; CLI | `Root "<root>" exceeds 25 MiB of included text; first excluded: <path>.` | `cap-reached` / exit 4 | no `Investigation` |
| `who_imports` with an unknown module (3.5) | MCP error | `Module "<module>" is not in the analysis of "<root>"; module IDs are paths relative to the root, such as src/orders/checkout.ts.` | `module-not-found` | — |
| `compare` root failure (4.5) | MCP error; CLI | `rootBefore: <message>` or `rootAfter: <message>` | the root's code / exit 4 | no comparison |
| `compare.ts` not yet on `main` (precondition) | MCP error | `compare is not available until snapshot-comparison lands` | `analysis-failed` | — |
| `src/analysis` throws (3.6) | MCP error; CLI | `Analysis of "<root>" failed: <error message>.` | `analysis-failed` / exit 4 | — |
| Produced value fails the validator (3.2, 4.6, 5.4) | MCP error; CLI | `internal error, output failed validation: <first error>` (CLI prefix `hauntmap: `) | `analysis-failed` / exit 5 | `<out>`; stderr log line |
| CLI usage error (5.1) | stderr | the two `USAGE` lines | exit 2 | — |
| CLI run outside the repository root (5.5) | stderr | `hauntmap: run from the HauntMap repository root (no package.json named hauntmap in <cwd>).` | exit 4 | — |
| CLI cannot write (5.4) | stderr | `hauntmap: cannot write <file> (<error code>).` | exit 6 | `<out>` untouched; `.tmp` removed |
| CLI not built (1.3) | launcher stderr | `hauntmap: the CLI is not built. Run pnpm build:mcp first.` | exit 3 | — |
| `demo:reset` fs error (1.5) | stderr | `demo:reset: <message>` | exit 1 | `samples/manor` may be partially restored; rerun |
| MCP server unhandled rejection | stderr `hauntmap-mcp: ` line | the error name and message | process exit 1 | stdout untouched |
| Live snapshot missing or hosting fallback (8.3) | status region | `No live snapshot yet. Run \`pnpm hauntmap analyze samples/manor --out public/demo/live.json\`, or let the Kiro hook write it.` | `missing` | whole view |
| Live snapshot not JSON or invalid (8.4) | status region | `The live snapshot at demo/live.json is not valid: <first error>. The current view is unchanged.` | `malformed` | whole view |
| Live snapshot fetch rejected or other status (8.5) | status region | `The live snapshot could not be fetched (<error name or status>). The current view is unchanged.` | `fetch-failed` | whole view |
| No `compare` handoff (8.5) | status region | `Comparison is not available in this build.` | `no-compare` | whole view |
| Sample load fails in the no-investigation path (8.8) | status region | `investigation-ui` 1.6 text | `sample-failed` | landing screen |
| Analysis of `manor/before` rejects in the no-investigation path (8.11) | status region | `The manor sample could not be analyzed (<message>). Reload the page or analyze a local folder.` | `sample-failed` | landing screen |
| Compare handoff rejects (8.11) | nothing from this spec (the handoff wrote its message) | — | `compare-failed` | whatever the handoff preserved (snapshot-comparison 10.1–10.4: the earlier investigation) |
| `demo:live` finds `dist/cli.js` absent or the sample unchanged (6.8) | hook output | `demo:live: skipped (<reason>)` | exit 0 | `public/demo/live.json` untouched |
| Activation while pending (8.2) | — | nothing; button `aria-disabled="true"` | — | — |
| Hook run fails or times out (6.6) | hook output; `docs/kiro-log.md` defect row | the command's own output | — | the hook stays enabled; the defect is fixed |
| Session result differs from 9.2 (9.2) | `docs/acceptance/2026-11-24-h9/` not written | — | — | re-run after the fix, two repair passes, then the builder decides |

What a user sees on the paths that matter: Kiro that names a root outside the repository gets one sentence and no data; a judge who presses **Open live snapshot** on a host that serves a fallback page for missing files gets the "No live snapshot yet" sentence with the exact command, not a JSON error; a hook that fails leaves the previous `live.json` intact because the write is atomic.

## Testing Strategy

Commands. `pnpm verify` runs `tests/kiro/**` (Vitest, node environment, except `live-snapshot.test.tsx` in jsdom with React Testing Library, both pinned by `investigation-ui`), `tests/mcp-agreement.test.ts` and the rest of the repository's unit suite; it must stay under 90 seconds, so the tests that spawn the built server (`server.test.ts`, `dist-standalone.test.ts`, `cli.test.ts`) run `pnpm build:mcp` once in a global setup when `dist/` is older than `src/` and otherwise reuse it. `pnpm verify:e2e -- tests/e2e/live-snapshot.spec.ts` runs the browser journey in the `dev` Playwright project that `investigation-ui` task 1c defines (a production build made with `VITE_HAUNTMAP_DEVHOOK=1`, served by `pnpm preview`, where `window.__hauntmap` exists; Chromium, 1,280 × 720, one fresh context per test); every case of the spec file, including 8.10, runs there, since the devhook build serves the same committed `public/demo/live.json`. `pnpm build:mcp && pnpm hauntmap analyze samples/manor --out /tmp/live.json` is the manual smoke check. Property-based tests use fast-check (MIT, *verify*; pinned by `investigation-ui`), 200 runs per property, fixed seed printed on failure.

Fixtures (`tests/kiro/fixtures/`):

| Fixture | Content | Expected |
| --- | --- | --- |
| `loader-root.json` | a manifest `{ files: Record<path, string \| { base64: string } \| { bytes: number, fill: string }> }` materialized into a temp directory by `tests/kiro/materialize.ts`: `src/a.ts` (`import { b } from "./b";\nexport const a = b;\n`), `src/b.ts` (`export const b = 1;\n`), `src/util/index.ts`, `src/Util.ts`, `legacy.mjs`, `types.mts`, `bom.ts` (`﻿export const x = 1;\n` as bytes `EF BB BF …`), `crlf.ts` (`export const y = 2;\r\n`), `bin.ts` (`00 01 02` then text), `big.ts` (1,048,577 bytes of `/`), `Readme.md`, `.env`, `.env.local`, `secret.pem`, `server.key`, `id_rsa`, `id_rsa.pub`, `node_modules/pkg/index.js`, `dist/out.js`, `build/x.js`, `out/y.js`, `.next/z.js`, `coverage/c.js`, `.git/HEAD`, `postinstall.js` (writes `MARKER` to the temp dir if executed) | `files` paths exactly `["bom.ts", "crlf.ts", "legacy.mjs", "postinstall.js", "src/Util.ts", "src/a.ts", "src/b.ts", "src/util/index.ts", "types.mts"]` in that order; `bom.ts` text starts with `e` (BOM removed) and its hash equals the Web Crypto hash of the same bytes through `Blob.text()`; `crlf.ts` text contains `\r\n`; `skipped` has `.git/`, `node_modules/`, `dist/`, `build/`, `out/`, `.next/`, `coverage/` as `excluded-dir`, `.env`, `.env.local`, `secret.pem`, `server.key`, `id_rsa`, `id_rsa.pub` as `secret-pattern`, `Readme.md` as `extension`, `big.ts` as `oversized`, `bin.ts` as `binary`; the `MARKER` file is absent after analysis |
| `cap-files` (generated) | 1,001 files `m<i>.ts` (`i` = 0…1000) of one line each | `cap-reached` with `first excluded: <the last name in code-point order>` (`m999.ts` for this generator: `m1000.ts` sorts fifth, after `m100.ts` and before `m101.ts`); the test derives the name from the sorted list rather than hardcoding it |
| `cap-bytes` (generated) | 26 files of 1,048,576 bytes | `cap-reached` with the bytes message and `first excluded` equal to the 26th sorted name |
| `escape-link` (generated) | temp workspace `w/` with `w/link → ../outside/` (symlink) and `w/outside-abs` as an absolute path argument | both `root-outside-workspace`; the fake fs records no read under `../outside` |
| `samples/manor` (repository) | the 40-module copy | `analyze` → 40 modules, `sourceLabel: "live:samples/manor"`; `cycles` under `static-value` → one component with the three members of `expected.json`; `who_imports` of `src/orders/checkout.ts` → `direct` includes `src/notifications/receipt.ts` |
| `manor-after-removal` (generated) | temp copy of `samples/manor` with the import declaration in `src/notifications/receipt.ts` whose specifier resolves to `src/orders/checkout.ts` deleted, plus the one statement using its binding (lines identified by the fixtures agent's note in `expected.json`, *verify* the field) | `compare(public/demo/manor/before, <copy>)` → `removedRelations` `[demo relation]`, `addedRelations` `[]`, `changedModules` `["src/notifications/receipt.ts"]`, `cyclicComponentsBefore` 1, `cyclicComponentsAfter` 0 |
| `live/valid-live.json` | the CLI's `analyze` output of `manor-after-removal` (an input fixture; the facts asserted about it are hand-authored: 40 modules, the demo relation absent, `sourceLabel` `live:samples/manor`) | `Open live snapshot` → `loaded`; comparison panel shows one removed relation; 40 room rectangles unchanged |
| `live/malformed-live.json` | `{ "schemaVersion": 2, "resolverMode": "documented-source-subset", "sourceLabel": "live:samples/manor", "modules": [], "imports": [], "diagnostics": [], "options": {} }` | `The live snapshot at demo/live.json is not valid: schemaVersion must be 1 (found 2). The current view is unchanged.` |
| `live/not-json-live.txt` | `{"schemaVersion": 1,` served with `content-type: application/json` | `… is not valid: file is not JSON (<SyntaxError message>). …` (the test matches the prefix `file is not JSON (`) |
| `live/fallback.html` | `<!doctype html><title>HauntMap</title>` served with status 200 and `content-type: text/html` | the `No live snapshot yet.` message |
| `docs/acceptance/2026-11-24-h9/*` (from task 12) | the session artifacts | `mcp-compare.json.removedRelations` equals `app-comparison-export.json.comparison.result.removedRelations` (same for `addedRelations`); `live.json` equals `public/demo/live.json` |
| `tests/kiro/fixtures/decisions-sample.md` | `crew-definitions-path: .kiro/crew-sample` and `crew-pilot-verdict: pass` among other prose lines | parsed as `{ path: ".kiro/crew-sample", verdict: "pass" }`; a copy without the verdict line parses as `{ verdict: null }` and the test reports `docs/decisions.md has no crew-pilot-verdict line` |
| `tests/kiro/fixtures/demo-live/` (generated) | a temp workspace with `public/demo/manor/before` (three `.ts` files and an `expected.json`), `samples/manor` as its copy, and an optional `packages/hauntmap-mcp/dist/cli.js` marker | `demo:live` skips with the `dist/cli.js absent` line, skips with the `identical` line, and invokes the injected runner with `analyze samples/manor --out public/demo/live.json` after one byte of `samples/manor/src/a.ts` changes |

Unit and integration test files (`pnpm verify`):

| File | Cases |
| --- | --- |
| `tests/kiro/loader.test.ts` | 2.1 options deep-equal the imported defaults; 2.2 the `loader-root.json` expectations (order, reasons, not entering excluded dirs: the fake fs records no `readdir` under `node_modules`); 2.3 BOM and CRLF hashes against Web Crypto; 2.5 `cap-files` and `cap-bytes`; 2.6 `escape-link` and an absolute path outside; 2.7 missing root and a file given as root; 2.8 `sourceLabelFor` table (`samples/manor`, `./samples/manor/`, `samples\\manor`, `.`) |
| `tests/kiro/tools.test.ts` | 3.2–3.5 on `samples/manor` with the real `src/analysis`: `analyze` validates and has no `text`; `cycles` members from `expected.json`; `who_imports` direct importer; `module-not-found`, `invalid-preset`, `invalid-arguments` messages; 3.6 a throwing stub `analyze` → `analysis-failed` without a stack; `validate` failure → `internal error` message |
| `tests/kiro/compare-tool.test.ts` | 4.1 labels; 4.2 the `manor-after-removal` expectations; 4.5 prefixed root errors; 4.6 deep-equal to a direct `compare.ts` call; absence of `compare.ts` → the precondition message |
| `tests/kiro/server.test.ts` | 3.1 spawn `dist/index.js`, `tools/list` names and schemas (deep-equal to the table), descriptions non-empty; a `cycles` call round-trips JSON; an error result carries the error flag and the JSON error; nothing but protocol frames on stdout (the test captures stdout and parses every line); 3.8 response time of `analyze` on `samples/manor` recorded to the test output (target 2,000 ms) |
| `tests/kiro/dist-standalone.test.ts` | 1.2 copy `dist/` to a temp dir with no `node_modules`, spawn `node index.js`, `tools/list` succeeds |
| `tests/kiro/cli.test.ts` | 5.1 usage lines and exit 2 for six bad invocations; 5.2 `analyze` output file (indent 2, trailing newline), stdout line, no `.tmp`; 5.3 `compare` line; 5.4 every exit code with `<out>` untouched (pre-create `<out>` with `old` and assert it still reads `old`); 5.5 run from a temp dir without the root `package.json`; 5.6 `samples/manor` → 40 modules, label, no `text`, no `\nimport ` substring; 1.3 the launcher without `dist/cli.js` |
| `tests/kiro/package-boundary.test.ts` | 1.1 no import from `src/scene`, `src/features`, `src/components`, no `window`/`document`/`fetch`; 3.7 no `child_process`, `vm`, `eval(`, `new Function(` in `packages/hauntmap-mcp/src/**` |
| `tests/kiro/no-execution.test.ts` | 3.7 `postinstall.js` marker absent after `analyze` through the server boundary |
| `tests/kiro/sample-copy.test.ts` | 1.4 every included file of `public/demo/manor/before` exists byte-identical in `samples/manor` and vice versa (through `treesEqual`); 1.5 `demo:reset` on a modified copy restores it and prints the line with the count; a second run leaves `git status --porcelain samples/` empty |
| `tests/kiro/demo-live.test.ts` | 6.8 the three branches on the generated `demo-live` workspace with an injected runner: skip lines and exit 0 with nothing written; the runner called once with exactly `analyze samples/manor --out public/demo/live.json` when one byte differs; the script names no other root or output (source grep) |
| `tests/kiro/hooks.test.ts` | 6.1 both files parse, names, commands verbatim (`pnpm verify` or `HAUNTMAP_FAST=1 pnpm verify`; `pnpm demo:live`), timeouts, every `action.type` is `command`; 6.2 at most the two scaffold entries in `analyze-live.json`; 6.5 citation guard against `README.md` and `docs/write-up.md` versus rows whose task cell contains `hook observation <name>`; 6.7 `scripts/demo-live.ts` contains `analyze samples/manor --out public/demo/live.json` once and no other `--out` |
| `tests/kiro/live-json.test.ts` | 6.7 committed `public/demo/live.json` validates, `sourceLabel: "live:samples/manor"`, module IDs within the manor's wings; 9.5 byte equality with the session copy when the folder exists; 9.5b (after task 12) `compare.ts` of the analysis of `public/demo/manor/before` (through the loader) against the committed file yields `removedRelations` of length 1 with the demo relation ID and `addedRelations` empty |
| `tests/kiro/validate.test.ts` | every row of the validator table produces its exact string; a valid `analyze` output passes; a `ComparisonResult` from `compare.ts` passes; unsorted relation lists fail |
| `tests/kiro/live-snapshot.test.tsx` | 8.1 the control's name and `aria-disabled` while pending; 8.2 URL `demo/live.json?t=<now>` with `cache: "no-store"` and `credentials: "omit"`, one fetch per activation, a second activation while pending makes no second fetch; 8.3–8.5 each `LiveFetch` kind → the exact message and I6; 8.6 the handoff receives `{ before, after, layoutKey }` and the loaded message follows; 8.8 the no-investigation path with a stub `loadSample` and a stub `analysisClient.analyze`: `openInvestigation` receives the investigation, the map built from the sample's files and `{ demo: false }`; the load-failure message; 8.9 the handoff's `after` is the live investigation and `openInvestigation` is never called for it; 8.11 a rejecting `analysisClient.analyze` → `msgSampleAnalyzeFailed` and `sample-failed`; a rejecting handoff → `compare-failed`, no `setStatus` call after the handoff, no unhandled rejection |
| `tests/kiro/steering.test.ts` | 7.1 front matter, line count < 60, the names present; 7.4 none of `receipt.ts`, `checkout.ts`, `charge.ts`, `exactly one removed`, `1 → 0` in the file |
| `tests/kiro/crew-config.test.ts` | 10.1 the two `docs/decisions.md` lines parse (sample fixture and the real file); each definition's `Folders` block equals the backticked paths of its ownership row outside parentheses; skipped with the message `pilot verdict: fail` when the verdict line says `fail` (10.2); fails with `docs/decisions.md has no crew-pilot-verdict line` when it is missing after November 6 |
| `tests/kiro/kiro-log.test.ts` | 10.4 table parses, seven cells per row, no `EXAMPLE` date cell, no `0000000` commit cell, the task-cell format and labels of 10.4, credits of every row starting with `kiro-integration` ≤ 600, one row per task part (1a, 1b, 1c, 2, 3, 4a, 4b, 4c, 5–12, 13a, 13b, 14, 15) after task 15 |
| `tests/kiro/repo-hygiene.test.ts` | 10.6 `.gitignore` does not match `.kiro` or `public/demo/live.json`; `.hauntmap/` is ignored |
| `tests/kiro/properties.test.ts` | fast-check runs of P1–P8 |
| `tests/mcp-agreement.test.ts` | 2.4 `row 26`: CLI `analyze` of `samples/manor` versus the app path on the `pack-samples` `SourceSet` of the same folder: sorted module IDs, per-module hashes, sorted relation IDs; 4.3 `row 27 programmatic`: MCP `compare` through the server boundary versus the app path on `manor-after-removal`, deep-equal relation arrays with order; 4.4 `row 27 recorded`: `mcp-compare.json.removedRelations` versus `app-comparison-export.json.comparison.result.removedRelations` and the same for `addedRelations` (added by task 12) |

Browser spec (`pnpm verify:e2e`):

| File | Cases |
| --- | --- |
| `tests/e2e/live-snapshot.spec.ts` | 8.1 Tab reaches `Open live snapshot` after the `compare` slot; 8.3 with `page.route("**/demo/live.json*")` answering 404, and answering `fallback.html` with 200 `text/html`, the status region shows the missing message and `store.getState()` (through the development hook) is deep-equal except `status`; 8.4 `malformed-live.json` and `not-json-live.txt` → their messages, view unchanged; 8.5 the route aborting → the fetch-failed message with the error name; 8.6–8.7 `valid-live.json` with `manor/before` open: the loaded message, the comparison panel's `Removed relations (1)` list holds one item whose label begins with `src/notifications/receipt.ts imports src/orders/checkout.ts`, `Added relations (0)` shows `None.`, 40 modules in the Evidence view, and in two cases (every wing expanded through the hook first; only `src/orders` expanded) every drawn room's and every wing's `screenRectOf` rectangle deep-equal before and after with `null` failing the test, the camera deep-equal, the demo relation's door in the `comparison-removed` state; 8.10 the committed `public/demo/live.json` served by `pnpm preview` of the devhook build without routing loads and shows the removed relation (after task 12) |

Human and reviewer checks (recorded, never assumed): hook observations on November 4 and by November 10 (tasks 2 and 7); the MCP first use on November 9–10 (task 6); the recorded session November 22–23 (task 12) with the builder present; the reviewer agent's `docs/acceptance/2026-11-24-gate.md` rows for Requirements 8 and 9 from a fresh browser profile; the clean-machine build of task 14.

## Correctness Properties

Generators (`tests/kiro/generators.ts`): `arbTree` builds a directory manifest with 1–60 entries, names from `[A-Za-z0-9._-]` plus the literal names `node_modules`, `.git`, `dist`, `.env`, `x.pem`, depths 0–4, extensions drawn from the six included ones plus `.md`, `.json`, `.png`, contents as random strings (including `﻿`, `\r\n`, non-ASCII, and a 1 % chance of a NUL byte) and a 2 % chance of a size over 1,048,576; `arbArgs` builds arbitrary JSON values for tool arguments; `arbInvestigation` builds valid investigations with 1–50 modules; `arbMutation` deletes, retypes or duplicates one required field of an investigation; `arbPath` builds root strings with `..`, absolute prefixes, backslashes and symlink names.

- P1 Loader determinism and order independence (2.2, Investigation invariants): for any `arbTree`, materializing its entries in two different creation orders and loading both gives deep-equal `SourceSet`s, and `analyze` on them gives deep-equal `Investigation`s.
- P2 Loader classification totality (2.2, 2.5): for any `arbTree`, every file is either in `files` or covered by exactly one `skipped` entry (its own or its nearest excluded ancestor directory), every included file satisfies the five inclusion conditions, and `files.length ≤ 1000` and `Σ bytes ≤ 26,214,400` or the result is `cap-reached`.
- P3 Hash agreement (2.3): for any byte sequence that is valid UTF-8, `sha256Hex(new TextDecoder("utf-8").decode(bytes))` equals the hex of `crypto.subtle.digest("SHA-256", new TextEncoder().encode(await new Blob([bytes]).text()))`.
- P4 Root containment (2.6, 2.7): for any `arbPath` and any temp workspace with one symlink pointing outside, `resolveRoot` returns `ok` only when the realpath is the workspace or below it, and the fake fs records no read outside the workspace for any rejected path.
- P5 Tool error totality (3.6, 4.5): for any `arbArgs` and any of the four tools, the result is either `ok` with a value that passes the validator or an error with one of the seven codes and a non-empty message; the handler never throws and the fake fs records no write.
- P6 JSON round trip (3.2, 4.3): for any `arbInvestigation` or any `ComparisonResult` produced from two of them, `JSON.parse(JSON.stringify(value))` is deep-equal to `value` and still passes the validator (so the text item and the file carry the whole result).
- P7 Validator soundness (8.4, validator table): for any `arbInvestigation`, `validateInvestigation` returns `ok`; for any `arbMutation` of it, it returns an error whose first string starts with the mutated field's path (`modules[<i>].`, `imports[<i>].`, `options.` or the top-level field name).
- P8 View preservation (8.3–8.6, 8.11): for any `LiveFetch` kind other than `valid`, and for `valid` with no handoff registered, `openLiveSnapshot` leaves `store.getState()` deep-equal except `status`; for `valid` with a handoff, `camera`, `selection`, `routeFilter` and `expandedWings` are deep-equal before and after, and the handoff was called exactly once with the current investigation as `before`; for a rejecting `analysisClient.analyze` on the no-investigation path the store stays on the landing with only `status` changed and the outcome is `sample-failed`; for a rejecting handoff the outcome is `compare-failed`, no `setStatus` call follows the handoff, and the returned promise resolves (never rejects).

## Decisions and Alternatives

- **One package, two bundles, one analysis module.** The server and the CLI share `tools.ts` and `loader.ts` and import `src/analysis` and `src/contracts` directly; the bundler inlines them so `node dist/index.js` needs no workspace resolution (1.2). Rejected: a second analysis implementation for Node (would diverge; matrix row 26 exists to prevent this); publishing the analysis as a separate workspace package (adds a package boundary the plan does not ask for).
- **`compare` without a preset argument.** Relation sets are compared over all relations because the relation ID carries the kinds, and `ComparisonResult.preset` is fixed to `static-value` for the cycle counts; a preset argument would change only the counts and complicate the steering file. The plan's open-decisions table (revision 3) records this. Rejected: an optional `preset` defaulting to `static-value`.
- **Errors as JSON in the error result, one code list for server and CLI.** Kiro reads a structured code; the CLI prints the same message with a prefix and maps codes to exit codes, so a hook log and a transcript say the same thing. Rejected: free-text errors; throwing across the transport (the SDK would wrap it and the message would carry a stack).
- **Containment by realpath prefix, checked before anything is read.** A symlink inside the workspace that points outside is the obvious escape; `realpath` catches it. Rejected: string-prefix checks on the unresolved path.
- **Caps are errors, not partial results.** The plan's rule for roots outside the workspace ("an error, not a partial result") and for the GitHub cap ("stop with the count and the first excluded path") are applied to the CLI and the server alike, so `live.json` can never be a silently truncated graph. Rejected: a partial investigation with a `cap-reached` diagnostic (left to the app's intake spec for its own flows).
- **Atomic `--out` writes.** A hook interrupted mid-write would otherwise leave a truncated `live.json` that the app reports as malformed. Rejected: direct writes.
- **`live.json` carries `sourceLabel: "live:<root>"`.** The label tells the comparison panel and the status message where the newer snapshot came from and lets `tests/kiro/live-json.test.ts` reject a file produced from any root but `samples/manor`. Rejected: reusing `manor/before`-style labels.
- **A committed working copy (`samples/manor`) instead of editing the fixture.** The fixtures agent's `public/demo/manor/{before,after}` and `expected.json` are evidence for `analysis-core`; a demo must never change them. `pnpm demo:reset` makes the copy disposable. Rejected: a temp copy created by the session script (judges reading the repository would not find the root Kiro analyzed).
- **The session's `live.json` is committed; the sample is reset; the hook is idempotent.** The hosted build must show the removed relation without any tool, so the "after" file ships while the repository's `samples/manor` stays in the "before" state that `cycles` reports a loop for, so the session can be re-recorded from a clean checkout; the equality test with the session copy keeps the two from drifting. Because the hook fires on every Kiro turn in every checkout, it runs through `scripts/demo-live.ts`, which regenerates the file only when the sample differs from the fixture and skips when `dist/cli.js` is absent (6.8): a later Kiro session (tasks 13b–15, Crew agents in their worktrees) leaves the committed snapshot untouched and never fails on stop. Rejected: committing the edited sample (1.4's byte identity and the re-recordable session would be lost, and `samples/manor` would no longer be the root the steering file describes); removing the `Stop` entry from `analyze-live.json` after the recording (the hook would be cited in the write-up while absent from the repository); an unconditional hook command (every later turn rewrites `live.json` to the pre-edit state, the byte-equality test fails and a commit of that file would blank the judge's demonstration).
- **Two hook entries at scaffold, one surface chosen by observation.** The plan leaves the surface open until November 4; shipping both and deleting the unobserved entry keeps the rule "no hook is cited until observed" mechanical (6.2, 6.5). Rejected: choosing the CLI in this document (unverified).
- **Command hooks only.** Agent hooks cost credits and inject prompts; verification and snapshot generation need neither. Rejected: an agent hook that asks Kiro to run `compare` on stop.
- **`autoApprove` only for `cycles` and `who_imports`.** Read-only single-root tools run unprompted; `compare` stays visible in the recording as an approved call. Rejected: auto-approving everything (less legible transcript); nothing (two extra prompts per session).
- **Steering under 60 lines, imperative, with the `.hauntmap/before/` rule.** `compare` takes roots, so a general refactor needs an untouched copy; one ignored folder is the smallest honest answer. Rejected: a `snapshot` tool that stores investigations server-side (state between calls, nothing in the plan).
- **The live control only fetches, validates and hands off.** Comparison semantics, union layout and styling stay in `snapshot-comparison`; the control cannot disagree with the panel because it computes nothing. Rejected: computing the comparison in the control to show counts in the status message.
- **Hosting fallback detection (200 + non-JSON + no json content-type ⇒ missing).** Static hosts often answer a missing file with the SPA's `index.html` and 200; reporting that as "malformed" would send a judge chasing a JSON error. Rejected: trusting the status code alone.
- **Agreement tested at three levels.** Row 26 (same folder, two loaders), row 27 programmatic (two paths through the server boundary) and row 27 recorded (the artifacts the judge sees). Rejected: a single in-process comparison (would not exercise the transport or the hook-written file).
- **Crew definitions documented by content, not format.** The installed Crew's file format is unverified; the test checks the one fact that matters for honesty (the `Folders` block equals the ownership row's backticked paths) and reads the path and verdict from two fixed lines of `docs/decisions.md`. Rejected: inventing a schema; a free-text string match on the ownership row (parentheticals and exceptions made it ambiguous).
- **The pilot's definitions reach `main` on November 6–7 (task 13a), not in December.** Crew agents work in worktrees branched from `main` that share the repository's `.kiro`; definitions that lived only on `kiro/crew-pilot` would be absent from every later branch and `docs/decisions.md` would name a path `main` does not contain. Rejected: committing them with `docs/crew.md` at the end (task 13b keeps only the documentation and the `renderer` definition).
- **The steering file carries no expected result.** `refactoring.md` instructs the calls and the final-message shape; the members, the relation and the counts of the H9 session live only in `docs/demo/h9-session-script.md`, which Kiro does not read, so the transcript shows tool results rather than a restatement of a script (7.4). Rejected: a steering bullet listing the expected sequence (invites the model to report the expected result instead of the tool result, which `tests/mcp-agreement.test.ts` cannot detect).
- **The app in the recording is served by the Vite dev server.** `pnpm preview` serves the output directory, into which `public/` was copied at build time, so a `live.json` written after the build is invisible to it; the dev server reads `public/` from disk. Rejected: preview with an off-camera rebuild (a cut would hide a step); faking the click.
- **`tests/kiro/` as this spec's test folder.** `tests/fixtures/` belongs to the Crew fixtures agent, `tests/ui/` to the fleet, `tests/e2e/` to Playwright; the plan names only `tests/mcp-agreement.test.ts`, which stays at that path.

## Out of Scope

- Any change to analysis semantics (parser, resolver, presets, IDs, cycles, trace) or to comparison semantics; those go through `analysis-core` and `snapshot-comparison`. This spec calls them.
- The comparison panel, the union layout, the comparison styling and the closing-corridor transition (`snapshot-comparison`); the toolbar, the status region and the registry (`investigation-ui`); the export dialog and the comparison export's file format (`snapshot-comparison`, Requirements 8–9; this spec saves one export as a session artifact).
- The GitHub-by-URL and local folder intake flows and their loaders (the `intake` spec); the agreement test uses `scripts/pack-samples.ts` as the app-side loader.
- A `preset` argument for `compare`; a `snapshot` or `diff` tool over stored investigations; caching between tool calls; watching the file system; an HTTP or SSE transport; authentication; running the server outside the repository.
- MCP resources or prompts (tools only); progress notifications; cancellation of a running tool call.
- Analyzing `node_modules`, `tsconfig` paths, CommonJS `require` or anything the plan defers for the parser.
- Hook forms other than command hooks; manual hooks; spec lifecycle triggers; the CardForge, RelayKit and Rehearsal hooks.
- The Crew pilot itself, its agent prompts and the `analysis-core` tasks it runs (this spec commits and documents the resulting definitions).
- The video edit, the voiceover and the blog post text (assembled from the log by the builder and the docs agent); the Devpost form.
- Any claim that a removed relation implies runtime correctness, and any performance figure not recorded in `docs/performance.md` or the log.
