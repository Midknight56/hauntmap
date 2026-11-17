import type { ReactNode } from "react";
import type { InvestigationStore } from "../features/investigation/store";
import { useViewState } from "./useStore";

/** A message with a segment wrapped in backticks shows that segment in a `code` element; everything is a text node. */
export function renderStatus(message: string): ReactNode[] {
  return message.split("`").map((part, i) => (i % 2 === 1 ? <code key={i}>{part}</code> : part));
}

/** The one live region of the app, written only through `store.actions.setStatus`. */
export function StatusRegion({ store }: { store: InvestigationStore }) {
  const { status } = useViewState(store);
  return (
    <p role="status" className="status-region">
      {renderStatus(status)}
    </p>
  );
}