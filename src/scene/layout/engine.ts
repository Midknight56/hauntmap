import { dagreEngine } from "./dagre";
import { layoutKey } from "./key";
import type { LayoutEngine, LayoutRequest, LayoutResult } from "./types";

export { layoutKey };

/**
 * Lay out a request with an engine and add the `layoutKey`. `stats.nodeCount` and `stats.edgeCount`
 * are the size of the request, not the number of boxes drawn. `now` is the clock for `stats.ms`.
 */
export async function layoutInvestigation(
  req: LayoutRequest,
  engine: LayoutEngine = dagreEngine,
  now: () => number = () => performance.now(),
): Promise<LayoutResult> {
  const partial = engine.layout(req, now);
  const key = await layoutKey(req, engine);
  return { ...partial, layoutKey: key };
}
