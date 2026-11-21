import { useLayoutEffect, useMemo, useRef, type ReactElement } from "react";
import type { ImportRecord, Investigation } from "../contracts/types";
import { analysisApi, type AnalysisApi } from "../features/investigation/analysisApi";
import { compareText, languageLabel, occurrencesOf, presetLine, relationHeading, relationSentence, targetText } from "../features/investigation/facts";
import type { InvestigationStore, ViewState } from "../features/investigation/store";
import { boundaryRelations, drawnRelations, wingOf, wingsOf } from "../features/investigation/wings";
import { EvidenceTrail } from "./EvidenceTrail";
import { NamedList } from "./NamedList";
import { relationTip, selectRelation } from "./selecting";
import { SourceExcerpt } from "./SourceExcerpt";
import { usePhone } from "./useMediaQuery";
import { useViewState } from "./useStore";

export const INSPECTOR_HEADING_ID = "inspector-heading";
export const INSPECTOR_HINT = "Select a room, a door or a wing on the map, or an item in the Evidence view, to see its evidence here.";

interface Props {
  store: InvestigationStore;
  /** The analysis seam; tests may pass a stub. */
  api?: AnalysisApi;
}

function byRelationId(a: ImportRecord, b: ImportRecord): number {
  return compareText(a.relationId, b.relationId);
}

function ModuleCard({ store, state, api }: { store: InvestigationStore; state: ViewState; api: AnalysisApi }): ReactElement {
  const inv = state.investigation as Investigation;
  const selection = state.selection;
  const id = selection.kind === "module" ? selection.id : "";
  const record = inv.modules.find((m) => m.id === id);
  const relations = useMemo(
    () => ({ drawn: drawnRelations(inv, state.preset, api), boundary: boundaryRelations(inv, state.preset, api) }),
    [inv, state.preset, api],
  );
  if (record === undefined) return <p>{`${id} is not a module of this investigation.`}</p>;
  const wing = wingOf(id);
  const imports = [...relations.drawn, ...relations.boundary].filter((r) => r.from === id).sort(byRelationId);
  const importedBy = relations.drawn.filter((r) => r.to === id).sort(byRelationId);
  const diagnostics = inv.diagnostics.filter((d) => d.module === id);
  const expanded = state.expandedWings.includes(wing);
  return (
    <>
      <p>{`Wing: ${wing}`}</p>
      <p>{`Language: ${languageLabel(record.language)}`}</p>
      <p>{`Parse status: ${record.parseStatus}`}</p>
      <div className="inspector-actions">
        <button type="button" onClick={() => store.actions.focusModule(id)}>
          Focus
        </button>
        <button type="button" onClick={() => store.actions.openWhoImports(id)}>
          Who imports this?
        </button>
        {expanded ? (
          <button type="button" onClick={() => store.actions.collapseWing(wing)}>
            Collapse wing
          </button>
        ) : (
          <button type="button" onClick={() => store.actions.expandWing(wing, id)}>
            Expand wing
          </button>
        )}
      </div>
      <NamedList title={`Imports (${imports.length})`}>
        {imports.map((r) => (
          <li key={r.relationId}>
            <button type="button" {...relationTip(r)} onClick={() => selectRelation(store, r)}>
              {`${targetText(r)} \u00B7 ${r.syntaxKind} \u00B7 ${r.dependencyKind}`}
            </button>
          </li>
        ))}
      </NamedList>
      <NamedList title={`Imported by (${importedBy.length})`}>
        {importedBy.map((r) => (
          <li key={r.relationId}>
            <button type="button" {...relationTip(r)} onClick={() => selectRelation(store, r)}>
              {`${r.from} \u00B7 ${r.syntaxKind} \u00B7 ${r.dependencyKind}`}
            </button>
          </li>
        ))}
      </NamedList>
      {diagnostics.length > 0 ? (
        <NamedList title={`Diagnostics (${diagnostics.length})`}>
          {diagnostics.map((d, i) => (
            <li key={i}>{`${d.code}: ${d.message}`}</li>
          ))}
        </NamedList>
      ) : null}
    </>
  );
}

function RelationCard({ store, state, api }: { store: InvestigationStore; state: ViewState; api: AnalysisApi }): ReactElement {
  const inv = state.investigation as Investigation;
  const selection = state.selection;
  if (selection.kind !== "relation") return <></>;
  const occurrences = occurrencesOf(inv.imports, selection.relationId);
  const record = occurrences[0];
  if (record === undefined) return <p>This relation is not in the investigation.</p>;
  const chosen = occurrences.find((o) => o.occurrenceId === selection.occurrenceId);
  return (
    <>
      <p className="relation-sentence">{relationSentence(record, occurrences.length)}</p>
      <div className="facts">
        <p>{`Syntax: ${record.syntaxKind}`}</p>
        <p>{`Dependency: ${record.dependencyKind}`}</p>
        <p>{`Resolution: ${record.resolution}`}</p>
        {record.reason === undefined ? null : <p>{`Reason: ${record.reason}`}</p>}
        <p>{presetLine(api.presetMembership(record))}</p>
      </div>
      <NamedList title={`Occurrences (${occurrences.length})`}>
        {occurrences.map((o) => (
          <li key={o.occurrenceId}>
            <button
              type="button"
              aria-current={chosen?.occurrenceId === o.occurrenceId ? "true" : undefined}
              onClick={() => store.actions.select({ kind: "relation", relationId: o.relationId, occurrenceId: o.occurrenceId }, { from: "dom" })}
            >
              {`line ${o.line}, column ${o.column}: ${o.specifier}`}
            </button>
          </li>
        ))}
      </NamedList>
      {chosen === undefined ? null : (
        <SourceExcerpt hasSource={state.sourceText !== null} text={state.sourceText?.get(chosen.from)} line={chosen.line} />
      )}
    </>
  );
}

function WingCard({ store, state }: { store: InvestigationStore; state: ViewState }): ReactElement {
  const inv = state.investigation as Investigation;
  const selection = state.selection;
  const wing = selection.kind === "wing" ? selection.wing : "";
  const entry = useMemo(() => wingsOf(inv).find((w) => w.wing === wing), [inv, wing]);
  if (entry === undefined) return <p>{`${wing} is not a wing of this investigation.`}</p>;
  const expanded = state.expandedWings.includes(wing);
  return (
    <>
      <p>{`Modules: ${entry.moduleIds.length}`}</p>
      <div className="inspector-actions">
        {expanded ? (
          <button type="button" onClick={() => store.actions.collapseWing(wing)}>
            Collapse wing
          </button>
        ) : (
          <button type="button" onClick={() => store.actions.expandWing(wing)}>
            Expand wing
          </button>
        )}
      </div>
    </>
  );
}

/** The inspector heading of the current selection. */
export function inspectorTitle(state: ViewState): string {
  const inv = state.investigation;
  const selection = state.selection;
  if (inv === null) return "Inspector";
  switch (selection.kind) {
    case "none":
      return "Inspector";
    case "module":
      return selection.id;
    case "wing":
      return selection.wing;
    case "relation": {
      const record = occurrencesOf(inv.imports, selection.relationId)[0];
      return record === undefined ? "Inspector" : relationHeading(record);
    }
  }
}

export function Inspector({ store, api = analysisApi }: Props): ReactElement {
  const state = useViewState(store);
  const selection = state.selection;
  const hasCard = state.investigation !== null && selection.kind !== "none";
  const phone = usePhone();
  const sheetRef = useRef<HTMLElement>(null);
  // A new selection fades the inspector in over 150 ms: the CSS animation restarts when its name alternates between a and b.
  const fade = useRef({ key: JSON.stringify(selection), n: 0 });
  const key = JSON.stringify(selection);
  if (fade.current.key !== key) fade.current = { key, n: fade.current.n + 1 };
  // On a phone the inspector is the evidence sheet, a card in the page under the map: a new selection brings the map and the
  // heading of the sheet back on the screen, even when the tap that made it (a trail step at the bottom of the sheet) scrolled
  // the page down to the button (design 4d, design pass 2 item 9). A step of the tour that has just taken focus keeps it on the
  // screen (blind test fixes of 20 November 2026).
  useLayoutEffect(() => {
    const sheet = sheetRef.current;
    if (!phone || sheet === null) return;
    const toTop = (): void => {
      if (document.activeElement?.closest(".steps-panel") != null) return;
      sheet.scrollTop = 0;
      const page = document.scrollingElement;
      if (page !== null) page.scrollTop = 0;
    };
    toTop();
    const frame = requestAnimationFrame(toTop);
    return () => cancelAnimationFrame(frame);
  }, [phone, selection]);
  return (
    <aside ref={sheetRef} aria-label="Inspector" className="inspector" data-kind={selection.kind} data-fade={fade.current.n % 2 === 0 ? "a" : "b"}>
      <h2 id={INSPECTOR_HEADING_ID} tabIndex={-1}>
        {inspectorTitle(state)}
      </h2>
      {!hasCard ? <p>{INSPECTOR_HINT}</p> : null}
      {hasCard && selection.kind === "module" ? <ModuleCard store={store} state={state} api={api} /> : null}
      {hasCard && selection.kind === "relation" ? <RelationCard store={store} state={state} api={api} /> : null}
      {hasCard && selection.kind === "wing" ? <WingCard store={store} state={state} /> : null}
      <EvidenceTrail store={store} />
    </aside>
  );
}
