import { useEffect, useId, useRef, type ReactElement } from "react";
import type { Preset } from "../contracts/types";
import type { InvestigationStore } from "../features/investigation/store";
import { useViewState } from "./useStore";

export const TYPE_INCLUSIVE_SENTENCE =
  "This preset includes type-only relations, which the static-value preset leaves out; a loop that exists only here is not a runtime import cycle.";
export const DYNAMIC_INCLUSIVE_SENTENCE = "This preset also includes literal dynamic imports.";

/** The sentence that states what a preset adds, or null for the default preset (7.3). */
export function presetSentence(preset: Preset): string | null {
  return preset === "type-inclusive" ? TYPE_INCLUSIVE_SENTENCE : preset === "dynamic-inclusive" ? DYNAMIC_INCLUSIVE_SENTENCE : null;
}

/** `1 loop`, `0 loops`, `2 loops`: the plural is for zero and for two or more. */
export function countWords(count: number): string {
  return `${count} ${count === 1 ? "loop" : "loops"}`;
}

/** The label of one component button (7.1). */
export function componentLabel(members: readonly string[]): string {
  return members.length === 1 ? `Self-import: ${members[0]}` : `${members.length} modules: ${members.join(", ")}`;
}

/** The `Dependency loops (<preset>)` panel (7.1 to 7.3, 7.8). */
export function LoopsPanel({ store }: { store: InvestigationStore }): ReactElement | null {
  const state = useViewState(store);
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const panel = state.panel;
  const open = panel.kind === "loops";
  // The panel takes focus when a button asks for it (`Dependency loops`), so that the next Tab reaches the first
  // component. A panel that is open from the start (the first screen) never asks.
  useEffect(() => {
    if (open && state.panelFocus > 0) heading.current?.focus();
  }, [open, state.panelFocus]);
  if (panel.kind !== "loops") return null;
  const sentence = presetSentence(state.preset);
  const components = panel.report?.components ?? [];
  return (
    <section className="result-panel loops-panel" aria-labelledby={headingId}>
      <div className="panel-head">
        <h2 id={headingId} ref={heading} tabIndex={-1}>{`Dependency loops (${state.preset})`}</h2>
        {panel.report === null ? null : <p className="panel-count">{countWords(components.length)}</p>}
      </div>
      {panel.error !== null ? <p>{panel.error}</p> : null}
      {sentence === null ? null : <p>{sentence}</p>}
      {panel.report === null ? null : (
        <>
          <ul aria-label="Loops" className="loop-list">
            {components.map((component, index) => (
              <li key={component.members.join("\u0000")}>
                <button type="button" aria-current={panel.chosen === index ? "true" : undefined} onClick={() => store.actions.chooseLoop(index)}>
                  {componentLabel(component.members)}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <button type="button" onClick={() => store.actions.closePanel()}>
        Close panel
      </button>
    </section>
  );
}