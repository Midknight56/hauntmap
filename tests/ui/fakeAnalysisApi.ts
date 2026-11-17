import type { AnalysisApi } from "../../src/features/investigation/analysisApi";
import { analysisApi } from "../../src/features/investigation/analysisApi";

/** An AnalysisApi whose `cycles` and `trace` always throw, for the 7.8 cases. `inPreset` stays real. */
export function createThrowingAnalysisApi(message = "forced"): AnalysisApi {
  return {
    ...analysisApi,
    cycles() {
      throw new Error(message);
    },
    trace() {
      throw new Error(message);
    },
  };
}

/** The real AnalysisApi with `cycles` and `trace` switchable to throwing at run time. */
export function createSwitchableAnalysisApi(): AnalysisApi & { failing: boolean } {
  const api = {
    failing: false,
    cycles(...args: Parameters<AnalysisApi["cycles"]>) {
      if (api.failing) throw new Error("forced");
      return analysisApi.cycles(...args);
    },
    trace(...args: Parameters<AnalysisApi["trace"]>) {
      if (api.failing) throw new Error("forced");
      return analysisApi.trace(...args);
    },
    inPreset: analysisApi.inPreset,
    presetMembership: analysisApi.presetMembership,
  };
  return api;
}
