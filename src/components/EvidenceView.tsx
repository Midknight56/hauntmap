import { useMemo, type ReactElement } from "react";
import type { ImportRecord, Investigation } from "../contracts/types";
import { analysisApi, type AnalysisApi } from "../features/investigation/analysisApi";
import { compareText, targetText } from "../features/investigation/facts";
import type { InvestigationStore } from "../features/investigation/store";
import { wingOf, wingsOf } from "../features/investigation/wings";
import { NamedList } from "./NamedList";
import { relationTip, selectModule, selectRelation, selectWing, tipProps } from "./selecting";
import { useViewState } from "./useStore";

/** One record per relation ID: the first occurrence by line and column. */
function firstPerRelation(inv: Investigation): ImportRecord[] {
  const first = new Map<string, ImportRecord>();
  for (const record of inv.imports) {
    const known = first.get(record.relationId);
    if (known === undefined || record.line < known.line || (record.line === known.line && record.column < known.column)) first.set(record.relationId, record);
  }
  return [...first.values()].sort((a, b) => compareText(a.relationId, b.relationId));
}

function describeWing(wing: string, count: number): string {
  return `${wing} \u00B7 ${count} ${count === 1 ? "module" : "modules"}`;
}

/**
 * The Evidence view (6.5): every wing, module, relation and diagnostic of the investigation as
 * buttons. It is the complete alternative to the canvas, so it lists relations outside the preset too.
 */
export function EvidenceView({ store, api = analysisApi }: { store: InvestigationStore; api?: AnalysisApi }): ReactElement {
  const state = useViewState(store);
  const inv = state.investigation;
  const wingFilter = state.evidenceWingFilter;
  const selection = state.selection;
  const rows = useMemo(() => {
    if (inv === null) return null;
    const inWing = (id: string): boolean => wingFilter === null || wingOf(id) === wingFilter;
    return {
      wings: wingsOf(inv).filter((w) => wingFilter === null || w.wing === wingFilter),
      modules: [...inv.modules].filter((m) => inWing(m.id)).sort((a, b) => compareText(a.id, b.id)),
      relations: firstPerRelation(inv).filter((r) => inWing(r.from)),
      diagnostics: inv.diagnostics.filter((d) => d.module === undefined || inWing(d.module)),
    };
  }, [inv, wingFilter]);

  if (inv === null || rows === null) return <section className="evidence-view" aria-label="Evidence" />;

  return (
    <section className="evidence-view" aria-labelledby="evidence-heading">
      <h2 id="evidence-heading">{`Evidence (${state.preset})`}</h2>
      {wingFilter === null ? null : (
        <p className="evidence-filter">
          {`Showing the wing ${wingFilter} only.`}{" "}
          <button type="button" onClick={() => store.actions.setView("evidence", null)}>
            Show every wing
          </button>
        </p>
      )}
      <NamedList title={`Wings (${rows.wings.length})`}>
        {rows.wings.map((w) => (
          <li key={w.wing}>
            <button
              type="button"
              aria-current={selection.kind === "wing" && selection.wing === w.wing ? "true" : undefined}
              {...tipProps("wing", w.wing)}
              onClick={() => selectWing(store, w.wing)}
            >
              {describeWing(w.wing, w.moduleIds.length)}
            </button>
          </li>
        ))}
      </NamedList>
      <NamedList title={`Modules (${rows.modules.length})`}>
        {rows.modules.map((m) => (
          <li key={m.id}>
            <button
              type="button"
              data-module-id={m.id}
              aria-current={selection.kind === "module" && selection.id === m.id ? "true" : undefined}
              {...tipProps("room", m.id)}
              onClick={() => selectModule(store, m.id)}
            >
              {`${m.id} \u00B7 ${m.parseStatus}`}
            </button>
          </li>
        ))}
      </NamedList>
      <NamedList title={`Relations (${rows.relations.length})`}>
        {rows.relations.map((r) => (
          <li key={r.relationId}>
            <button
              type="button"
              data-relation-id={r.relationId}
              aria-current={selection.kind === "relation" && selection.relationId === r.relationId ? "true" : undefined}
              {...relationTip(r)}
              onClick={() => selectRelation(store, r)}
            >
              {`${r.from} imports ${targetText(r)} \u00B7 ${r.syntaxKind} \u00B7 ${r.dependencyKind} \u00B7 ${r.resolution} \u00B7 ${
                api.inPreset(r, state.preset) ? "in preset" : "not in preset"
              }`}
            </button>
          </li>
        ))}
      </NamedList>
      <NamedList title={`Diagnostics (${rows.diagnostics.length})`}>
        {rows.diagnostics.map((d, i) => {
          const text = `${d.code}: ${d.message}`;
          const module = d.module;
          return (
            <li key={i}>
              {module === undefined ? (
                text
              ) : (
                <button type="button" onClick={() => selectModule(store, module)}>
                  {text}
                </button>
              )}
            </li>
          );
        })}
      </NamedList>
    </section>
  );
}