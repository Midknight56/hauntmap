import type { ReactNode } from "react";
import type { InvestigationStore } from "../features/investigation/store";
import { useViewState } from "./useStore";

/** A message with a segment wrapped in backticks shows that segment in a `code` element; everything is a text node. */
export function renderStatus(message: string): ReactNode[] {
  return message.split("`").map((part, i) => (i % 2 === 1 ? <code key={i}>{part}</code> : part));
}

/** The comparison sentence alone (no extra words after it): the dock shows the same sentence, so the bar does not repeat it on screen. */
const MIRRORED = /^Comparison ready: [^.]*\. Showing the (newer|earlier) snapshot\.$/;

/**
 * The one live region of the app, written only through `store.actions.setStatus`. On the investigation screen it floats over
 * the map and takes no room while it is empty; the comparison sentence stays in it for screen readers and is drawn in the dock.
 */
export function StatusRegion({ store }: { store: InvestigationStore }) {
  const { status, screen } = useViewState(store);
  return (
    <p role="status" className="status-region" data-screen={screen} data-empty={status === "" ? "" : undefined} data-mirrored={MIRRORED.test(status) ? "" : undefined}>
      {renderStatus(status)}
    </p>
  );
}