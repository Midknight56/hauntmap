import type { Investigation, Preset } from "../../contracts/types";
import type { AnalysisApi } from "../investigation/analysisApi";
import type { InvestigationStore, ViewState } from "../investigation/store";
import { drawnRelations } from "../investigation/wings";
import type { DemoStepId, DemoStepState } from "./types";

// The investigation steps of the manor demo (requirement 8): the wording, the completion rules and the
// summary. The rules read the view state only; the panel (`src/components/DemoSteps.tsx`) draws them.

export const CHECKOUT_ID = "src/orders/checkout.ts";

export const STEP_COPY: Record<DemoStepId, { title: string; instruction: string }> = {
  follow: { title: "Follow a dependency", instruction: "Select src/orders/checkout.ts and open one of its doors. A door is one import from that file to another file." },
  loop: { title: "Reveal a loop", instruction: "Open Dependency loops and choose the loop of 3 modules." },
  compare: { title: "Compare revisions", instruction: "Load the revised manor and watch which door disappears." },
};

export type StepStatus = DemoStepState["steps"][number]["status"];

export function statusLabel(status: StepStatus): string {
  return status === "done" ? "Done" : status === "skipped" ? "Skipped" : "To do";
}

/** The steps the panel shows: the `compare` step only while a `compare` handoff is registered. */
export function visibleSteps(state: DemoStepState, compareAvailable = true): DemoStepState["steps"] {
  return state.steps.filter((s) => s.id !== "compare" || compareAvailable);
}

/** The state with a To do `compare` step added when a handoff was registered after the manor opened. */
export function withCompareStep(state: DemoStepState): DemoStepState {
  return state.steps.some((s) => s.id === "compare") ? state : { ...state, steps: [...state.steps, { id: "compare", status: "todo" }] };
}

/** `<done> of <n> steps`, counting the visible steps only. */
export function stepsSummary(state: DemoStepState, compareAvailable = true): string {
  const steps = visibleSteps(state, compareAvailable);
  return `${steps.filter((s) => s.status === "done").length} of ${steps.length} steps`;
}

/**
 * The steps whose completion rule holds in this state: step 1 when a relation that leaves
 * `src/orders/checkout.ts` is selected, step 2 when a witness route filter is active. Step 3 is
 * completed by its handoff, never by the view state.
 */
export function completedStepIds(state: ViewState): DemoStepId[] {
  const ids: DemoStepId[] = [];
  const selection = state.selection;
  if (selection.kind === "relation" && state.investigation !== null) {
    const relationId = selection.relationId;
    if (state.investigation.imports.some((r) => r.relationId === relationId && r.from === CHECKOUT_ID)) ids.push("follow");
  }
  if (state.routeFilter?.kind === "witness") ids.push("loop");
  return ids;
}

/** Mark every step whose rule holds as Done (a skipped step may still become Done). */
export function syncStepCompletion(store: InvestigationStore): void {
  const state = store.getState();
  const steps = state.steps;
  if (steps === null) return;
  for (const id of completedStepIds(state)) {
    const step = steps.steps.find((s) => s.id === id);
    if (step !== undefined && step.status !== "done") store.actions.stepAction(id, "done");
  }
}

/**
 * The relation that `Do it` of step 1 opens: the first drawn import of `src/orders/checkout.ts` under the preset, by
 * relation ID (the first door of its Imports list that leads to another room); null when it has none.
 */
export function firstCheckoutDoor(inv: Investigation, preset: Preset, api: AnalysisApi): { relationId: string; occurrenceId: string } | null {
  const first = drawnRelations(inv, preset, api).find((r) => r.from === CHECKOUT_ID);
  return first === undefined ? null : { relationId: first.relationId, occurrenceId: first.occurrenceId };
}

/** The index of the loop that `Do it` of step 2 chooses: the loop through `src/orders/checkout.ts`, else the first; null without a loop. */
export function checkoutLoopIndex(components: readonly { members: readonly string[] }[]): number | null {
  if (components.length === 0) return null;
  const index = components.findIndex((c) => c.members.includes(CHECKOUT_ID));
  return index < 0 ? 0 : index;
}