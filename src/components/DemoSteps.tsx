import { Fragment, useEffect, useId, useState, useSyncExternalStore, type ReactElement } from "react";
import { CHECKOUT_ID, checkoutLoopIndex, firstCheckoutDoor, STEP_COPY, statusLabel, stepsSummary, syncStepCompletion, visibleSteps, withCompareStep } from "../features/demo/steps";
import { analysisApi } from "../features/investigation/analysisApi";
import type { DemoStepId } from "../features/demo/types";
import { callCompareHandoff, type HandoffLookup } from "../features/investigation/handoffs";
import type { Registry } from "../features/investigation/registry";
import type { InvestigationStore } from "../features/investigation/store";
import { watchRegistry } from "./registryBridge";
import { selectModule, selectRelation } from "./selecting";
import { useViewState } from "./useStore";

export const SHOW_STEPS_ID = "show-steps";

type FocusRequest = "next" | "toggle";

/**
 * After `Do it`, focus goes to the `Do it` of the next step still to do, or to `Close` when every step is done, so that the
 * step list stays on the screen and the next key press goes on with the tour (blind test fixes of 20 November 2026).
 */
function focusNextStep(): void {
  const panel = document.querySelector<HTMLElement>("section[aria-label='Investigation steps']");
  if (panel === null) return;
  const next = panel.querySelector<HTMLElement>("li[data-status='todo'] .step-actions button") ?? panel.querySelector<HTMLElement>(".steps-close");
  next?.focus();
}

/** The instruction with the module path in a span that may break only after a slash, never inside a file name. */
function Instruction({ text }: { text: string }): ReactElement {
  const at = text.indexOf(CHECKOUT_ID);
  if (at < 0) return <p>{text}</p>;
  const parts = CHECKOUT_ID.split("/");
  return (
    <p>
      {text.slice(0, at)}
      <span className="step-path">
        {parts.map((part, i) => (
          <Fragment key={i}>
            {i < parts.length - 1 ? `${part}/` : part}
            {i < parts.length - 1 ? <wbr /> : null}
          </Fragment>
        ))}
      </span>
      {text.slice(at + CHECKOUT_ID.length)}
    </p>
  );
}

interface Props {
  store: InvestigationStore;
  registry: Registry & HandoffLookup;
}

/** The `Investigate the manor` panel (8.1 to 8.7). It is not modal and traps no focus. */
export function DemoSteps({ store, registry }: Props): ReactElement | null {
  const state = useViewState(store);
  const headingId = useId();
  const watcher = watchRegistry(registry);
  useSyncExternalStore(watcher.subscribe, watcher.getVersion, watcher.getVersion);
  const [request, setRequest] = useState<{ kind: FocusRequest; n: number } | null>(null);
  const compareAvailable = registry.getHandoff("compare") !== null;
  const steps = state.steps === null ? null : compareAvailable ? withCompareStep(state.steps) : state.steps;

  // The completion rules follow the view state however the selection or the route filter changed.
  useEffect(() => {
    syncStepCompletion(store);
  }, [store, state.selection, state.routeFilter, state.steps === null]);

  useEffect(() => {
    if (request === null) return;
    // One frame later, so that the panel shows the new state of the steps when focus moves.
    const frame = requestAnimationFrame(() => {
      if (request.kind === "next") focusNextStep();
      else document.getElementById(SHOW_STEPS_ID)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [request]);

  if (steps === null || steps.dismissed) return null;
  const ask = (kind: FocusRequest): void => setRequest((r) => ({ kind, n: (r?.n ?? 0) + 1 }));

  const doIt = (id: DemoStepId): void => {
    // Every `Do it` does the whole step, so that the step becomes Done by the same rule as when the reader does it by hand.
    if (id === "follow") {
      selectModule(store, CHECKOUT_ID);
      const s = store.getState();
      const door = s.investigation === null ? null : firstCheckoutDoor(s.investigation, s.preset, analysisApi);
      if (door !== null) selectRelation(store, door);
      syncStepCompletion(store);
      ask("next");
    } else if (id === "loop") {
      store.actions.openLoops({ focus: false });
      const panel = store.getState().panel;
      const index = panel.kind === "loops" && panel.report !== null ? checkoutLoopIndex(panel.report.components) : null;
      if (index !== null) store.actions.chooseLoop(index);
      syncStepCompletion(store);
      ask("next");
    } else {
      void callCompareHandoff(store, registry, { sample: "manor/after" }).then((result) => {
        if (result === "done") store.actions.stepAction("compare", "done");
      });
    }
  };

  const shown = visibleSteps(steps, compareAvailable);
  // The step the reader is on: the first one still to do. A phone shows only that one.
  const current = shown.find((s) => s.status === "todo")?.id ?? null;

  return (
    <section className="result-panel steps-panel" aria-label="Investigation steps">
      <div className="panel-head">
        <h2 id={headingId}>Investigate the manor</h2>
        <p className="panel-count">{stepsSummary(steps, compareAvailable)}</p>
      </div>
      <ol className="steps-list" aria-labelledby={headingId} data-has-current={current === null ? undefined : ""}>
        {shown.map((step) => (
          <li key={step.id} data-step={step.id} data-status={step.status} data-current={step.id === current ? "" : undefined}>
            <div className="step-text">
              <h3>
                {STEP_COPY[step.id].title}
                <span className="step-status">{`: ${statusLabel(step.status)}`}</span>
              </h3>
              <Instruction text={STEP_COPY[step.id].instruction} />
            </div>
            <div className="step-actions">
              <button type="button" onClick={() => doIt(step.id)}>
                Do it
              </button>
              <button type="button" onClick={() => store.actions.stepAction(step.id, "skip")}>
                Skip
              </button>
            </div>
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="steps-close"
        onClick={() => {
          store.actions.closeSteps();
          ask("toggle");
        }}
      >
        Close
      </button>
    </section>
  );
}
