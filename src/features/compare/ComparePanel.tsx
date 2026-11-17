import { useEffect, useId, useRef, type KeyboardEvent, type ReactElement } from "react";
import type { RelationRef } from "../../contracts/types";
import type { HostState } from "./host";
import { itemLabel } from "./labels";
import { Notes } from "./Notes";
import { SelectedChange } from "./SelectedChange";
import type { CompareState, CompareStore, Side } from "./store";

export const NO_DIFFERENCES = "No differences: the snapshots have the same modules, relations and source hashes.";
export const PAIR_NOTE = "Replaces the current investigation with manor/before and compares it with manor/after.";

interface Props {
  cs: CompareStore;
  compare: CompareState;
  host: HostState;
  /** Escape inside the panel: close it and give focus back to the control. */
  onClose(): void;
  /** After End comparison, focus goes back to the control. */
  onEnded(): void;
}

const BUSY = new Set(["acquiring", "comparing", "laying-out"]);

function ChangeList({ title, items, onChoose }: { title: string; items: { id: string; kind: "relation" | "module"; label: string }[]; onChoose(item: { kind: "relation" | "module"; id: string }): void }): ReactElement {
  const heading = `${title} (${items.length})`;
  return (
    <>
      <h3>{heading}</h3>
      {items.length === 0 ? (
        <p>None.</p>
      ) : (
        <ul aria-label={heading}>
          {items.map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => onChoose({ kind: item.kind, id: item.id })}>
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function ShowGroup({ cs, compare }: { cs: CompareStore; compare: CompareState }): ReactElement {
  const labelId = useId();
  const name = useId();
  const refs = useRef<Record<Side, HTMLInputElement | null>>({ before: null, after: null });
  const options: { side: Side; text: string }[] = [
    { side: "before", text: `Earlier (${compare.before?.label ?? ""})` },
    { side: "after", text: `Newer (${compare.after?.label ?? ""})` },
  ];
  const choose = (side: Side): void => {
    if (side !== compare.shown) cs.actions.show(side);
  };
  const onKey = (event: KeyboardEvent<HTMLInputElement>, side: Side): void => {
    const next: Side | null =
      event.key === "ArrowLeft" || event.key === "ArrowUp" ? (side === "after" ? "before" : "after") : event.key === "ArrowRight" || event.key === "ArrowDown" ? (side === "before" ? "after" : "before") : null;
    if (next === null) return;
    event.preventDefault();
    choose(next);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-labelledby={labelId} className="compare-show">
      <span id={labelId}>Show</span>
      {options.map((o) => (
        <label key={o.side}>
          <input
            ref={(el) => {
              refs.current[o.side] = el;
            }}
            type="radio"
            name={name}
            checked={compare.shown === o.side}
            onChange={() => choose(o.side)}
            onKeyDown={(event) => onKey(event, o.side)}
          />
          {o.text}
        </label>
      ))}
    </div>
  );
}

const relationItems = (refs: RelationRef[]) => refs.map((r) => ({ id: r.relationId, kind: "relation" as const, label: itemLabel(r, null) }));

/** The `Compare revisions` panel: idle (1.1) or active (7.1 to 7.5). Every string is a text node (7.7). */
export function ComparePanel({ cs, compare, host, onClose, onEnded }: Props): ReactElement {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const busy = BUSY.has(compare.status);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };
  const result = compare.result;
  const detail = compare.detail;
  const active = compare.status !== "idle" && result !== null && detail !== null && compare.before !== null && compare.after !== null;
  // The activated button leaves the panel when the comparison starts or ends; focus then goes to the panel
  // heading instead of the page body, so that the next Tab continues inside the panel.
  useEffect(() => {
    if (document.activeElement === null || document.activeElement === document.body) headingRef.current?.focus();
  }, [active]);

  let body: ReactElement;
  if (active) {
    const before = compare.before as NonNullable<CompareState["before"]>;
    const after = compare.after as NonNullable<CompareState["after"]>;
    const choose = (item: { kind: "relation" | "module"; id: string }): void => cs.actions.selectChange(item);
    body = (
      <>
        <p>{`Earlier: ${before.label} \u00b7 ${result.before.moduleCount} modules \u00b7 ${result.before.relationCount} relations`}</p>
        <p>{`Newer: ${after.label} \u00b7 ${result.after.moduleCount} modules \u00b7 ${result.after.relationCount} relations`}</p>
        <p>{`Loops under static-value: ${result.cyclicComponentsBefore} \u2192 ${result.cyclicComponentsAfter}`}</p>
        {detail.identical ? <p>{NO_DIFFERENCES}</p> : null}
        <ShowGroup cs={cs} compare={compare} />
        <ChangeList title="Removed relations" items={relationItems(result.removedRelations)} onChoose={choose} />
        <ChangeList title="Added relations" items={relationItems(result.addedRelations)} onChoose={choose} />
        <ChangeList title="Changed modules" items={result.changedModules.map((id) => ({ id, kind: "module" as const, label: itemLabel(id, detail) }))} onChoose={choose} />
        <ChangeList title="Removed modules" items={result.removedModules.map((id) => ({ id, kind: "module" as const, label: id }))} onChoose={choose} />
        <ChangeList title="Added modules" items={result.addedModules.map((id) => ({ id, kind: "module" as const, label: id }))} onChoose={choose} />
        <SelectedChange compare={compare} host={host} />
        <Notes result={result} detail={detail} />
        <button
          type="button"
          onClick={() => {
            cs.actions.end();
            onEnded();
          }}
        >
          End comparison
        </button>
      </>
    );
  } else {
    const label = host.investigation?.sourceLabel ?? "";
    const isManor = label === "manor/before";
    const start = (): void => {
      if (busy) return;
      void (isManor ? cs.actions.compareWithSample() : cs.actions.compareWithPair());
    };
    body = (
      <>
        <p>{`Compare ${label} with a newer snapshot.`}</p>
        <button type="button" aria-disabled={busy} onClick={start}>
          {isManor ? "Revised manor" : "Bundled manor pair"}
        </button>
        {isManor ? null : <p>{PAIR_NOTE}</p>}
      </>
    );
  }

  return (
    <section role="region" aria-labelledby={headingId} className="compare-panel" onKeyDown={onKeyDown}>
      <h2 id={headingId} ref={headingRef} tabIndex={-1}>
        Compare revisions
      </h2>
      {body}
    </section>
  );
}
