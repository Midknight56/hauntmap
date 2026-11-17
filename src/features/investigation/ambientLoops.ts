import type { Investigation, Preset } from "../../contracts/types";
import type { AmbientLoop } from "../../scene/types";
import { analysisApi, type AnalysisApi } from "./analysisApi";

/**
 * The witness of every dependency loop of the investigation under the preset: what the map shows from the start
 * (ecto borders, a glowing corridor, a ghost). It reads the same analysis as the `Dependency loops` panel. A failure
 * shows no loop; the panel reports the failure when it is opened.
 */
export function ambientLoops(inv: Investigation | null, preset: Preset, api: Pick<AnalysisApi, "cycles"> = analysisApi): AmbientLoop[] {
  if (inv === null) return [];
  try {
    return api.cycles(inv, preset).components.map((c) => ({ modules: [...c.witness.modules], relationIds: [...c.witness.relationIds] }));
  } catch {
    return [];
  }
}