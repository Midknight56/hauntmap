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

function focusFirstLoop(): void {
  const first = document.querySelector<HTMLElement>("ul[aria-label='Loops'] button");
  if (first !== null) first.focus();
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
      store.actions.openLoops();
      ask("loops");
    } else {
      void callCompareHandoff(store, registry, { sample: "manor/after" }).then((result) => {
        if (result === "done") store.actions.stepAction("compare", "done");
      });
    }
  };

  return (
    <section className="result-panel steps-panel" aria-label="Investigation steps">
      <h2 id={headingId}>Investigate the manor</h2>
      <p>{stepsSummary(steps, compareAvailable)}</p>
      <ol className="steps-list" aria-labelledby={headingId}>
        {visibleSteps(steps, compareAvailable).map((step) => (
          <li key={step.id} data-step={step.id}>
            <h3>
              {STEP_COPY[step.id].title}
              {": "}
              <span>{statusLabel(step.status)}</span>
            </h3>
            <p>{STEP_COPY[step.id].instruction}</p>
            <button type="button" onClick={() => doIt(step.id)}>
              Do it
            </button>{" "}
            <button type="button" onClick={() => store.actions.stepAction(step.id, "skip")}>
              Skip
            </button>
          </li>
        ))}
      </ol>
      <button
        type="button"
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
