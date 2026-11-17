import { useId, type ReactElement } from "react";
import { LEGEND_ENTRIES, LEGEND_FOOTER, legendText } from "../features/investigation/legend";
import type { Registry } from "../features/investigation/registry";
import type { InvestigationStore } from "../features/investigation/store";
import { usePhone } from "./useMediaQuery";
import { useViewState } from "./useStore";

export { LEGEND_ENTRIES, LEGEND_FOOTER };

/** The drawn shape beside each entry (a 26 by 16 glyph made of CSS; it holds no text). */
const GLYPHS: Record<string, string> = {
  Module: "room",
  Folder: "wing",
  "Import or re-export": "arrow",
  "Dependency cycle": "loop",
  "Unresolved or external import": "sealed",
  "Not in this traversal": "subdued",
  "Dependency path": "light",
  "Changed source": "lamp",
  "Removed in the newer snapshot": "ghost",
  "Added in the newer snapshot": "added",
};

/** The legend panel (5.1, 5.5). The toolbar's `Legend` toggle opens and closes it; the state is a stored preference. */
export function Legend({ store, registry }: { store: InvestigationStore; registry: Registry }): ReactElement | null {
  const state = useViewState(store);
  const headingId = useId();
  const phone = usePhone();
  if (!state.legendOpen) return null;
  const extra = registry.legendEntries();
  const entries = [...LEGEND_ENTRIES, ...extra];
  const own = LEGEND_ENTRIES.length;
  return (
    <section className="legend" aria-labelledby={headingId} data-extra={extra.length > 0 ? "" : undefined}>
      <h2 id={headingId}>Legend</h2>
      <div className="legend-scroll" {...(phone ? { tabIndex: 0, role: "group", "aria-labelledby": headingId } : {})}>
        <ul aria-label="Legend entries">
          {entries.map((entry, index) => (
            <li key={`${entry.concept}:${entry.costume}`} data-extra={index >= own ? "" : undefined}>
              <span className={`glyph glyph-${GLYPHS[entry.concept] ?? "room"}`} aria-hidden="true" />
              {legendText(entry)}
            </li>
          ))}
        </ul>
        <p>{LEGEND_FOOTER}</p>
      </div>
    </section>
  );
}