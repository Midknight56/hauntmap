import type { Investigation, Preset } from "../../contracts/types";
import type { LayoutRequest } from "../../scene/layout/types";
import type { AnalysisApi } from "./analysisApi";
import { boundaryRelations, drawnRelations, wingOf, wingsOf } from "./wings";

/** A wing shows at most this many rooms; the rest sit behind a grouped room. */
export const WING_CAP = 80;

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The modules of a wing that are drawn: all of them when there are at most 80, otherwise the 80
 * lexically smallest IDs with `bring` swapped into the last slot when it is not among them.
 * `members` must be sorted.
 */
export function shownIdsFor(members: readonly string[], bring?: string): { shownIds: string[]; hiddenCount: number } {
  if (members.length <= WING_CAP) return { shownIds: [...members], hiddenCount: 0 };
  const shown = members.slice(0, WING_CAP);
  if (bring !== undefined && members.includes(bring) && !shown.includes(bring)) shown[WING_CAP - 1] = bring;
  return { shownIds: shown, hiddenCount: members.length - WING_CAP };
}

/**
 * The layout request for an investigation: every module with its wing, the drawn local relations
 * and the admitted boundary relations under the preset, and the shown modules of each expanded wing.
 */
export function buildLayoutRequest(
  investigation: Investigation,
  preset: Preset,
  expandedWings: readonly string[],
  brought: ReadonlyMap<string, string>,
  api: AnalysisApi,
): LayoutRequest {
  const members = new Map(wingsOf(investigation).map((w) => [w.wing, w.moduleIds]));
  return {
    layoutVersion: 1,
    engine: "dagre",
    modules: investigation.modules.map((m) => ({ id: m.id, wing: wingOf(m.id) })).sort((a, b) => compareText(a.id, b.id)),
    relations: drawnRelations(investigation, preset, api).map((r) => ({ relationId: r.relationId, from: r.from, to: r.to as string })),
    boundaries: boundaryRelations(investigation, preset, api).map((r) => ({ relationId: r.relationId, from: r.from })),
    expandedWings: expandedWings.map((wing) => {
      const list = members.get(wing) ?? [];
      return { wing, ...shownIdsFor(list, brought.get(wing)) };
    }),
    preset,
    room: { w: 96, h: 64 },
  };
}
