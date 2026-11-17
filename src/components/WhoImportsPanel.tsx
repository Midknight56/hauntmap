import { useEffect, useId, useRef, type ReactElement } from "react";
import type { InvestigationStore } from "../features/investigation/store";
import { NamedList } from "./NamedList";
import { useViewState } from "./useStore";

function stepsText(distance: number): string {
  return `${distance} ${distance === 1 ? "step" : "steps"}`;
}

/** The `Who imports <id> (<preset>)` panel (7.4, 7.5, 7.8). */
export function WhoImportsPanel({ store }: { store: InvestigationStore }): ReactElement | null {
  const state = useViewState(store);
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const panel = state.panel;
  const open = panel.kind === "whoImports";
  // The panel takes focus when a button asks for it, so that the next Tab reaches the first importer.
  useEffect(() => {
    if (open && state.panelFocus > 0) heading.current?.focus();
  }, [open, state.panelFocus]);
  if (panel.kind !== "whoImports") return null;
  const result = panel.result;
  const route = state.routeFilter?.kind === "trace" && panel.chosen !== null ? state.routeFilter : null;
  const item = (id: string): ReactElement => (
    <li key={id}>
      <button type="button" aria-current={panel.chosen === id ? "true" : undefined} onClick={() => store.actions.chooseImporter(id)}>
        {`${id} \u00B7 ${stepsText(result?.distance[id] ?? 0)}`}
      </button>
    </li>
  );
  return (
    <section className="result-panel who-panel" aria-labelledby={headingId}>
      <h2 id={headingId} ref={heading} tabIndex={-1}>{`Who imports ${panel.origin} (${state.preset})`}</h2>
      {panel.error !== null ? <p>{panel.error}</p> : null}
      {result === null ? null : (
        <>
          <p>{`These modules reach ${panel.origin} through imports under this preset. They are places to inspect, not modules that will fail.`}</p>
          <NamedList title={`Direct importers (${result.direct.length})`}>{result.direct.map(item)}</NamedList>
          <NamedList title={`Indirect (${result.indirect.length})`}>{result.indirect.map(item)}</NamedList>
          {route?.prose === undefined ? null : <p>{route.prose}</p>}
        </>
      )}
      <button type="button" onClick={() => store.actions.closePanel()}>
        Close panel
      </button>
    </section>
  );
}