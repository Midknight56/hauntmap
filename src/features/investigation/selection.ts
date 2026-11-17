import type { CycleReport, TraceResult } from "../../contracts/types";

// Selection, route filter and panel types, and the small pure helpers that derive text from them.

export type Selection =
  | { kind: "none" }
  | { kind: "module"; id: string }
  | { kind: "relation"; relationId: string; occurrenceId?: string }
  | { kind: "wing"; wing: string };

export interface RouteFilter {
  kind: "witness" | "trace" | "focus";
  /** witness and trace: in walk order; focus: the origin, its direct importers and its direct imports, sorted. */
  modules: string[];
  /** witness: n relations closing the walk; trace: d relations; focus: every direct relation, sorted. */
  relationIds: string[];
  label: string;
  origin?: string;
  direction?: "imports" | "imported-by";
  /** The sentence of requirement 7.5, for a trace filter. */
  prose?: string;
}

export type Panel =
  | { kind: "none" }
  | { kind: "loops"; report: CycleReport | null; chosen: number | null; error: string | null }
  | { kind: "whoImports"; origin: string; result: TraceResult | null; chosen: string | null; error: string | null };

const ARROW = " \u2192 ";

/** `Loop: a → b → a` for a witness walk (the walk closes on its first module). */
export function witnessLabel(modules: readonly string[]): string {
  const first = modules[0];
  return `Loop: ${[...modules, ...(first === undefined ? [] : [first])].join(ARROW)}`;
}

/** `Route: a → b → origin` for a trace walk. */
export function traceLabel(modules: readonly string[]): string {
  return `Route: ${modules.join(ARROW)}`;
}

/** `<chosen> reaches <origin> in <d> steps: <chosen> imports <m1>, <m1> imports <m2>, …, <mk> imports <origin>.` */
export function routeProse(modules: readonly string[]): string {
  const chosen = modules[0] ?? "";
  const origin = modules[modules.length - 1] ?? "";
  const steps = modules.length - 1;
  const parts: string[] = [];
  for (let i = 0; i < steps; i++) parts.push(`${modules[i]} imports ${modules[i + 1]}`);
  return `${chosen} reaches ${origin} in ${steps} ${steps === 1 ? "step" : "steps"}: ${parts.join(", ")}.`;
}

/** The zero-based index of the selected relation within a route filter, or null when it is not on it. */
export function currentStepOf(filter: RouteFilter | null, selection: Selection): number | null {
  if (filter === null || selection.kind !== "relation") return null;
  const index = filter.relationIds.indexOf(selection.relationId);
  return filter.kind === "focus" || index < 0 ? null : index;
}
