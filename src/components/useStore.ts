import { useSyncExternalStore } from "react";
import type { InvestigationStore, ViewState } from "../features/investigation/store";

/** The whole view state; React re-renders on every store change. */
export function useViewState(store: InvestigationStore): ViewState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}