import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import { currentStepOf } from "../features/investigation/selection";
import type { InvestigationStore } from "../features/investigation/store";
import { occurrencesOf } from "../features/investigation/facts";
import { relationTip, selectRelation } from "./selecting";
import { useViewState } from "./useStore";

export const EMPTY_TRAIL_TEXT = "Select a loop or a module to build an evidence trail.";

/** The relations of the route filter as an ordered list of buttons with a roving tabindex (6.4, 11.2). */
export function EvidenceTrail({ store }: { store: InvestigationStore }): ReactElement {
  const state = useViewState(store);
  const headingId = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [rover, setRover] = useState<number | null>(null);
  const filter = state.routeFilter;
  const investigation = state.investigation;
  const items = useMemo(() => {
    if (filter === null || investigation === null) return [];
    return filter.relationIds.flatMap((relationId) => {
      const record = occurrencesOf(investigation.imports, relationId)[0];
      return record === undefined ? [] : [record];
    });
  }, [filter, investigation]);
  const current = currentStepOf(filter, state.selection);
  // A new current step takes the tab stop back from the arrow keys.
  useEffect(() => setRover(null), [current]);
  // The one tab stop is the roving item, else the current step, else the first.
  const stop = Math.min(rover ?? current ?? 0, Math.max(0, items.length - 1));

  const move = (index: number): void => {
    setRover(index);
    buttons.current[index]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const last = items.length - 1;
    const next =
      event.key === "ArrowDown" ? Math.min(last, index + 1) : event.key === "ArrowUp" ? Math.max(0, index - 1) : event.key === "Home" ? 0 : event.key === "End" ? last : null;
    if (next === null) return;
    event.preventDefault();
    move(next);
  };

  return (
    <section aria-labelledby={headingId} className="evidence-trail">
      <h3 id={headingId}>Evidence trail</h3>
      {items.length === 0 ? (
        <p>{EMPTY_TRAIL_TEXT}</p>
      ) : (
        <ol aria-labelledby={headingId}>
          {items.map((record, index) => (
            <li key={`${record.relationId}:${index}`}>
              <button
                type="button"
                ref={(el) => {
                  buttons.current[index] = el;
                }}
                tabIndex={index === stop ? 0 : -1}
                aria-current={current === index ? "step" : undefined}
                {...relationTip(record)}
                onFocus={() => setRover(index)}
                onKeyDown={(event) => onKeyDown(event, index)}
                onClick={() => selectRelation(store, record)}
              >
                {`Step ${index + 1}: ${record.from} imports ${record.to ?? `"${record.specifier}"`} (line ${record.line})`}
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}