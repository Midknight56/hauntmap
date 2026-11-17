import type { Investigation, ModuleRecord } from "../../contracts/types";
import type { HitTarget } from "../../scene/types";
import type { AnalysisApi } from "./analysisApi";
import { languageLabel, occurrencesOf } from "./facts";
import { legendWording } from "./legend";
import type { RouteFilter } from "./selection";
import { wingsOf } from "./wings";

const PARSE: Record<ModuleRecord["parseStatus"], string> = { ok: "parsed", partial: "partially parsed", failed: "parse failed" };

/**
 * The two lines of a tooltip (5.2): the legend wording of the element, then the fact. A room outside
 * the active route filter is called `Not in this traversal` (2.5).
 */
export function tooltipLines(
  target: Pick<HitTarget, "kind" | "id"> & { rect?: HitTarget["rect"] },
  inv: Investigation,
  _api: AnalysisApi,
  routeFilter: RouteFilter | null = null,
): [string, string] {
  switch (target.kind) {
    case "room": {
      const record = inv.modules.find((m) => m.id === target.id);
      const fact = record === undefined ? target.id : `${record.id} \u00B7 ${languageLabel(record.language)} \u00B7 ${PARSE[record.parseStatus]}`;
      const subdued = routeFilter !== null && !routeFilter.modules.includes(target.id);
      return [legendWording(subdued ? "Not in this traversal" : "Module"), fact];
    }
    case "door": {
      const record = occurrencesOf(inv.imports, target.id)[0];
      const fact =
        record === undefined
          ? target.id
          : `${record.from} imports ${record.to ?? record.specifier} \u00B7 ${record.syntaxKind} \u00B7 ${record.dependencyKind} \u00B7 line ${record.line}`;
      const onRoute = routeFilter?.relationIds.includes(target.id) === true;
      const concept = onRoute && routeFilter?.kind === "witness" ? "Dependency cycle" : onRoute && routeFilter?.kind === "trace" ? "Dependency path" : "Import or re-export";
      return [legendWording(concept), fact];
    }
    case "sealed": {
      const record = occurrencesOf(inv.imports, target.id)[0];
      const fact =
        record === undefined
          ? target.id
          : `${record.from} \u2192 "${record.specifier}" \u00B7 ${record.resolution}${record.reason === undefined ? "" : ` \u00B7 ${record.reason}`}`;
      return [legendWording("Unresolved or external import"), fact];
    }
    case "wing": {
      const count = wingsOf(inv).find((w) => w.wing === target.id)?.moduleIds.length ?? 0;
      return [legendWording("Folder"), `${target.id} \u00B7 ${count} ${count === 1 ? "module" : "modules"}`];
    }
    case "grouped": {
      const count = wingsOf(inv).find((w) => w.wing === target.id)?.moduleIds.length ?? 0;
      return [legendWording("Folder"), `${target.id} \u00B7 ${count} modules, some not drawn`];
    }
  }
}