import { findCycles, trace } from "../../analysis";
import { includesRelation } from "../../analysis/graph/presets";
import type { CycleReport, ImportRecord, Investigation, Preset, TraceResult } from "../../contracts/types";

// The one seam between the interface and the analysis. Nothing here has a rule of its own: every
// function forwards to src/analysis, so the interface never computes a cycle, a trace or a preset.

export interface AnalysisApi {
  /** `findCycles` of src/analysis. */
  cycles(investigation: Investigation, preset: Preset): CycleReport;
  /** `trace` of src/analysis; throws an Error naming the origin when it is not a module. */
  trace(
    investigation: Investigation,
    origin: string,
    direction: "imports" | "imported-by",
    preset: Preset,
  ): TraceResult;
  /**
   * The shared preset rule judged on the record's syntax and dependency kind, so that external and
   * unresolved records get an answer too (`resolution` is treated as local for this question).
   */
  inPreset(record: ImportRecord, preset: Preset): boolean;
  /** The first of static-value, type-inclusive, dynamic-inclusive that admits the record. */
  presetMembership(record: ImportRecord): Preset;
}

const ORDER: Preset[] = ["static-value", "type-inclusive", "dynamic-inclusive"];

function inPreset(record: ImportRecord, preset: Preset): boolean {
  return includesRelation(preset, { ...record, resolution: "local" });
}

export const analysisApi: AnalysisApi = {
  cycles: findCycles,
  trace,
  inPreset,
  presetMembership(record) {
    for (const preset of ORDER) if (inPreset(record, preset)) return preset;
    return "static-value";
  },
};

/**
 * The same seam with a gate in front of its two computing functions. The development hook uses it to
 * make the next `cycles` or `trace` call throw (requirement 7.8); nothing here computes anything itself.
 */
export function gateAnalysisApi(api: AnalysisApi, gate: (name: "cycles" | "trace") => void): AnalysisApi {
  return {
    ...api,
    cycles: (investigation, preset) => {
      gate("cycles");
      return api.cycles(investigation, preset);
    },
    trace: (investigation, origin, direction, preset) => {
      gate("trace");
      return api.trace(investigation, origin, direction, preset);
    },
  };
}
