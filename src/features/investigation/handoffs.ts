import type { Investigation } from "../../contracts/types";
import type { InvestigationStore } from "./store";

export type CompareArgs = {
  before: Investigation;
  after: Investigation | { sample: "manor/after" };
  layoutKey: string | null;
};

/** The part of the registry this helper needs, so that it imports no registry file. */
export interface HandoffLookup {
  getHandoff(name: "compare" | "export"): ((...args: never[]) => unknown) | null;
}

/**
 * Call the `compare` handoff with the current investigation and layout key. It never touches the
 * camera, the selection or the expanded wings. With no handoff registered it writes the status
 * text and returns `no-compare`; a rejection returns `failed` and writes no second message,
 * because the handoff wrote its own.
 */
export async function callCompareHandoff(
  store: InvestigationStore,
  registry: HandoffLookup,
  after: CompareArgs["after"],
): Promise<"done" | "no-compare" | "failed"> {
  const handoff = registry.getHandoff("compare") as ((args: CompareArgs) => Promise<void>) | null;
  if (handoff === null) {
    store.actions.setStatus("Comparison is not available in this build.");
    return "no-compare";
  }
  const state = store.getState();
  if (state.investigation === null) return "failed";
  try {
    await handoff({ before: state.investigation, after, layoutKey: state.layout?.layoutKey ?? null });
    return "done";
  } catch {
    return "failed";
  }
}
