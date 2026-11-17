import { useState, type ReactElement } from "react";
import type { ImportRecord, ModuleRecord, RelationRef } from "../../contracts/types";
import { excerptLines } from "./excerpt";
import type { HostState } from "./host";
import { relationHeading } from "./labels";
import type { CompareState, Snapshot } from "./store";

export const NO_SOURCE_NOTE = "Source not included in this snapshot; evidence is path, line and specifier.";

const LANGUAGES: Record<ModuleRecord["language"], string> = { ts: "TypeScript", js: "JavaScript", jsx: "JSX", tsx: "TSX" };
const PARSED: Record<ModuleRecord["parseStatus"], string> = { ok: "parsed", partial: "partially parsed", failed: "parse failed" };

function occurrencesIn(snapshot: Snapshot, relationId: string): ImportRecord[] {
  return snapshot.investigation.imports.filter((r) => r.relationId === relationId).sort((a, b) => a.line - b.line || a.column - b.column);
}

function Excerpt({ snapshot, record }: { snapshot: Snapshot; record: ImportRecord }): ReactElement {
  if (snapshot.sourceText === null) return <p>{NO_SOURCE_NOTE}</p>;
  const text = snapshot.sourceText.get(record.from);
  const lines = text === undefined ? [] : excerptLines(text, record.line);
  if (lines.length === 0) return <p>{`Line ${record.line} is not in the current source text.`}</p>;
  return (
    <ol className="compare-excerpt" aria-label="Source lines">
      {lines.map((l) => (
        <li key={l.line} aria-current={l.line === record.line ? "true" : undefined}>
          <pre>{`${l.line} ${l.text}`}</pre>
        </li>
      ))}
    </ol>
  );
}

function RelationCard({ kind, relation, compare, host }: { kind: "removed" | "added"; relation: RelationRef; compare: CompareState; host: HostState }): ReactElement {
  const snapshot = (kind === "removed" ? compare.before : compare.after) as Snapshot;
  const newer = compare.after as Snapshot;
  const occurrences = occurrencesIn(snapshot, relation.relationId);
  const reason = occurrences[0]?.reason;
  const drawn = host.layout?.doors.some((d) => d.relationId === relation.relationId) === true;
  const [open, setOpen] = useState<string | null>(null);
  const chosen = occurrences.find((o) => o.occurrenceId === open);
  return (
    <>
      <h3>{relationHeading(relation)}</h3>
      <p>{`${kind === "removed" ? "Removed in" : "Added in"} ${newer.label}`}</p>
      <p>{`Syntax: ${relation.syntaxKind}`}</p>
      <p>{`Dependency: ${relation.dependencyKind}`}</p>
      <p>{`Resolution: ${relation.resolution}`}</p>
      {reason === undefined ? null : <p>{`Reason: ${reason}`}</p>}
      {drawn ? null : <p>{`Not drawn under ${host.preset}`}</p>}
      <h4>{`Occurrences in ${snapshot.label} (${occurrences.length})`}</h4>
      <ul aria-label={`Occurrences in ${snapshot.label} (${occurrences.length})`}>
        {occurrences.map((o) => (
          <li key={o.occurrenceId}>
            <button type="button" aria-pressed={open === o.occurrenceId} onClick={() => setOpen(open === o.occurrenceId ? null : o.occurrenceId)}>
              {`line ${o.line}, column ${o.column}: ${o.specifier}`}
            </button>
          </li>
        ))}
      </ul>
      {chosen === undefined ? null : <Excerpt snapshot={snapshot} record={chosen} />}
    </>
  );
}

function ModuleCard({ id, compare }: { id: string; compare: CompareState }): ReactElement {
  const before = compare.before as Snapshot;
  const after = compare.after as Snapshot;
  const result = compare.result;
  const earlier = before.investigation.modules.find((m) => m.id === id);
  const newer = after.investigation.modules.find((m) => m.id === id);
  if (result !== null && result.changedModules.includes(id) && earlier !== undefined && newer !== undefined) {
    const counts = compare.detail?.occurrenceCounts[id] ?? { before: 0, after: 0 };
    return (
      <>
        <h3>{id}</h3>
        <p>{`Hash in ${before.label}: ${earlier.sourceHash}`}</p>
        <p>{`Hash in ${after.label}: ${newer.sourceHash}`}</p>
        <p>{`Import statements: ${counts.before} \u2192 ${counts.after}`}</p>
      </>
    );
  }
  const record = newer ?? earlier;
  const label = newer !== undefined && earlier === undefined ? after.label : before.label;
  return (
    <>
      <h3>{id}</h3>
      {record === undefined ? null : <p>{`Only in ${label} \u00b7 ${LANGUAGES[record.language]} \u00b7 ${PARSED[record.parseStatus]}`}</p>}
    </>
  );
}

/** The `Selected change` card of 7.3, for the item chosen last in the panel's lists. */
export function SelectedChange({ compare, host }: { compare: CompareState; host: HostState }): ReactElement | null {
  const item = compare.selected;
  const result = compare.result;
  if (item === null || result === null || compare.before === null || compare.after === null) return null;
  let body: ReactElement | null = null;
  if (item.kind === "relation") {
    const removed = result.removedRelations.find((r) => r.relationId === item.id);
    const added = result.addedRelations.find((r) => r.relationId === item.id);
    if (removed !== undefined) body = <RelationCard key={item.id} kind="removed" relation={removed} compare={compare} host={host} />;
    else if (added !== undefined) body = <RelationCard key={item.id} kind="added" relation={added} compare={compare} host={host} />;
  } else {
    body = <ModuleCard id={item.id} compare={compare} />;
  }
  if (body === null) return null;
  return (
    <section aria-label="Selected change" className="compare-selected">
      {body}
    </section>
  );
}
