import { useEffect, useId, useState, useSyncExternalStore, type ReactElement } from "react";
import { CHECKOUT_ID, STEP_COPY, statusLabel, stepsSummary, syncStepCompletion, visibleSteps, withCompareStep } from "../features/demo/steps";
import type { DemoStepId } from "../features/demo/types";
import { callCompareHandoff, type HandoffLookup } from "../features/investigation/handoffs";
import type { Registry } from "../features/investigation/registry";
import type { InvestigationStore } from "../features/investigation/store";
import { watchRegistry } from "./registryBridge";
import { selectModule } from "./selecting";
import { useViewState } from "./useStore";

export const SHOW_STEPS_ID = "show-steps";

type FocusRequest = "imports" | "loops" | "toggle";

/** The first `Imports` button of the inspector, or the inspector heading when the module imports nothing. */
function focusFirstImports(): void {
  const headings = document.querySelectorAll<HTMLElement>("aside[aria-label='Inspector'] h3");
  for (const h of headings) {
    if (!(h.textContent ?? "").startsWith("Imports (")) continue;
    const button = h.parentElement?.querySelector("button");
    if (button instanceof HTMLElement) {
      button.focus();
      return;
    }
  }
  document.getElementById("inspector-heading")?.focus();
}

function focusFirstLoop(): boolean {
  const first = document.querySelector<HTMLElement>("ul[aria-label='Loops'] button");
  if (first === null) return false;
  first.focus();
  return true;
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
    // The loops list is on the first screen already, so focus can move at once; the key the reader presses next reaches it.
    if (request.kind === "loops" && focusFirstLoop()) return;
    // One frame later, so that the inspector or the loops panel has rendered what is to receive focus.
    const frame = requestAnimationFrame(() => {
      if (request.kind === "imports") focusFirstImports();
      else if (request.kind === "loops") focusFirstLoop();
      else document.getElementById(SHOW_STEPS_ID)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [request]);

  if (steps === null || steps.dismissed) return null;
  const ask = (kind: FocusRequest): void => setRequest((r) => ({ kind, n: (r?.n ?? 0) + 1 }));

  const doIt = (id: DemoStepId): void => {
    if (id === "follow") {
      selectModule(store, CHECKOUT_ID);
      ask("imports");
    } else if (id === "loop") {
      store.actions.openLoops({ focus: false });
      ask("loops");
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
                {": "}
                <span>{statusLabel(step.status)}</span>
              </h3>
              <p>{STEP_COPY[step.id].instruction}</p>
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
