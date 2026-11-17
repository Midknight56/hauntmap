import { useId, type ReactElement } from "react";
import { LEGEND_ENTRIES, LEGEND_FOOTER, legendText } from "../features/investigation/legend";
import type { Registry } from "../features/investigation/registry";
import type { InvestigationStore } from "../features/investigation/store";
import { useViewState } from "./useStore";

export { LEGEND_ENTRIES, LEGEND_FOOTER };

/** The legend panel (5.1, 5.5). The toolbar's `Legend` toggle opens and closes it; the state is a stored preference. */
export function Legend({ store, registry }: { store: InvestigationStore; registry: Registry }): ReactElement | null {
  const state = useViewState(store);
  const headingId = useId();
  if (!state.legendOpen) return null;
  const entries = [...LEGEND_ENTRIES, ...registry.legendEntries()];
  return (
    <section className="legend" aria-labelledby={headingId}>
      <h2 id={headingId}>Legend</h2>
      <ul aria-label="Legend entries">
        {entries.map((entry) => (
          <li key={`${entry.concept}:${entry.costume}`}>{legendText(entry)}</li>
        ))}
      </ul>
      <p>{LEGEND_FOOTER}</p>
    </section>
  );
}