import process from "node:process";
import { analyze, DEFAULT_ANALYSIS_OPTIONS, findCycles, selectSources, trace } from "../../../src/analysis/index";
import type { HashFn } from "../../../src/analysis/index";
import type { AnalysisOptions, ComparisonResult, CycleReport, Diagnostic, Investigation, Preset, SourceSet, TraceResult } from "../../../src/contracts/types";
import { validateComparison, validateInvestigation } from "../../../src/contracts/validate";
import type { ValidationResult } from "../../../src/contracts/validate";
import { failure, messageOf } from "./errors";
import type { ToolErrorCode, ToolResult } from "./errors";
import { loadSourceSet, resolveRoot, sha256Hex } from "./loader";
import type { FsLike, ResolvedRoot } from "./loader";

export type { ToolError, ToolErrorCode, ToolResult } from "./errors";

/**
 * Everything a tool needs. Production passes the functions of src/analysis/index.ts by reference;
 * tests replace single members. This package parses, resolves and traverses nothing itself.
 */
export interface ToolContext {
  /** fs.realpath(process.cwd()) at startup. */
  workspaceRoot: string;
  fs?: FsLike;
  analysis: {
    selectSources: typeof selectSources;
    analyze: typeof analyze;
    findCycles: typeof findCycles;
    trace: typeof trace;
  };
  hash: HashFn;
  validate: { investigation(value: unknown): ValidationResult; comparison(value: unknown): ValidationResult };
  defaults: AnalysisOptions;
  /** One line to stderr, without the prefix. */
  log(line: string): void;
}

export const PRESETS: readonly Preset[] = ["static-value", "type-inclusive", "dynamic-inclusive"];

export function createContext(workspaceRoot: string, overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    workspaceRoot,
    analysis: { selectSources, analyze, findCycles, trace },
    hash: sha256Hex,
    validate: { investigation: validateInvestigation, comparison: validateComparison },
    defaults: DEFAULT_ANALYSIS_OPTIONS,
    log: (line) => {
      process.stderr.write(`hauntmap-mcp: ${line}\n`);
    },
    ...overrides,
  };
}

type Fail = { ok: false; error: { code: ToolErrorCode; message: string } };

/** Step 1: the arguments. Required fields are non-empty strings; `preset` is optional. */
export function parseArgs<K extends string>(args: unknown, required: readonly K[]): { ok: true; values: Record<K, string>; preset: Preset } | Fail {
  const object = typeof args === "object" && args !== null && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
  const values = {} as Record<K, string>;
  for (const name of required) {
    const value = object[name];
    if (typeof value !== "string" || value === "") return failure("invalid-arguments", `Argument "${name}" must be a string.`);
    values[name] = value;
  }
  const preset = object.preset;
  if (preset === undefined) return { ok: true, values, preset: "static-value" };
  if (typeof preset !== "string" || !PRESETS.includes(preset as Preset)) {
    const shown = typeof preset === "string" ? preset : (JSON.stringify(preset) ?? String(preset));
    return failure("invalid-preset", `Preset "${shown}" is not one of ${PRESETS.join(", ")}.`);
  }
  return { ok: true, values, preset: preset as Preset };
}

/** Steps 2 to 4: resolve the root, load its sources, analyze them. `prefix` is put before a root error message. */
export async function analyzeRoot(ctx: ToolContext, root: string, preset: Preset, prefix = ""): Promise<ToolResult<Investigation>> {
  const resolved = await resolveRoot(ctx.workspaceRoot, root, ctx.fs);
  if (!resolved.ok) return failure(resolved.error.code, prefix + resolved.error.message);
  const options: AnalysisOptions = { ...ctx.defaults, preset };
  const loaded = await loadSourceSet(resolved.root, options, ctx.fs);
  if (!loaded.ok) return failure(loaded.error.code, prefix + loaded.error.message);
  return runAnalysis(ctx, resolved.root, loaded.sourceSet, loaded.diagnostics, options, prefix);
}

async function runAnalysis(ctx: ToolContext, root: ResolvedRoot, sourceSet: SourceSet, diagnostics: Diagnostic[], options: AnalysisOptions, prefix: string): Promise<ToolResult<Investigation>> {
  try {
    return { ok: true, value: await ctx.analysis.analyze(sourceSet, options, ctx.hash, undefined, diagnostics) };
  } catch (thrown) {
    return failure("analysis-failed", `${prefix}Analysis of "${root.given}" failed: ${messageOf(thrown)}.`);
  }
}

/** Step 6: a produced value must pass its validator; a failure is logged and returned as analysis-failed. */
export function validated<T>(ctx: ToolContext, value: T, check: (value: unknown) => ValidationResult): ToolResult<T> {
  const outcome = check(value);
  if (outcome.ok) return { ok: true, value };
  const first = outcome.errors[0] ?? "unknown error";
  ctx.log(`output failed validation: ${first}`);
  return failure("analysis-failed", `internal error, output failed validation: ${first}`);
}

export async function analyzeTool(ctx: ToolContext, args: unknown): Promise<ToolResult<Investigation>> {
  const parsed = parseArgs(args, ["root"] as const);
  if (!parsed.ok) return parsed;
  const analyzed = await analyzeRoot(ctx, parsed.values.root, parsed.preset);
  if (!analyzed.ok) return analyzed;
  return validated(ctx, analyzed.value, ctx.validate.investigation);
}

export async function cyclesTool(ctx: ToolContext, args: unknown): Promise<ToolResult<CycleReport>> {
  const parsed = parseArgs(args, ["root"] as const);
  if (!parsed.ok) return parsed;
  const analyzed = await analyzeRoot(ctx, parsed.values.root, parsed.preset);
  if (!analyzed.ok) return analyzed;
  try {
    return { ok: true, value: ctx.analysis.findCycles(analyzed.value, parsed.preset) };
  } catch (thrown) {
    return failure("analysis-failed", `Analysis of "${parsed.values.root}" failed: ${messageOf(thrown)}.`);
  }
}

export async function whoImportsTool(ctx: ToolContext, args: unknown): Promise<ToolResult<TraceResult>> {
  const parsed = parseArgs(args, ["root", "module"] as const);
  if (!parsed.ok) return parsed;
  const { root, module } = parsed.values;
  const analyzed = await analyzeRoot(ctx, root, parsed.preset);
  if (!analyzed.ok) return analyzed;
  // trace throws on an origin that is not a module, so the check comes first.
  if (!analyzed.value.modules.some((candidate) => candidate.id === module)) {
    return failure("module-not-found", `Module "${module}" is not in the analysis of "${root}"; module IDs are paths relative to the root, such as src/orders/checkout.ts.`);
  }
  try {
    return { ok: true, value: ctx.analysis.trace(analyzed.value, module, "imported-by", parsed.preset) };
  } catch (thrown) {
    return failure("analysis-failed", `Analysis of "${root}" failed: ${messageOf(thrown)}.`);
  }
}

/** Placeholder until snapshot-comparison provides compareInvestigations (task 9 of this spec replaces it). */
export async function compareTool(_ctx: ToolContext, args: unknown): Promise<ToolResult<ComparisonResult>> {
  const parsed = parseArgs(args, ["rootBefore", "rootAfter"] as const);
  if (!parsed.ok) return parsed;
  return failure("analysis-failed", "compare is not available until snapshot-comparison lands");
}
