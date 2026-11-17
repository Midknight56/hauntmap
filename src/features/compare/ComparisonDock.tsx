import type { ReactElement } from "react";
import { useCompareState } from "./CompareControl";
import { NO_DIFFERENCES } from "./ComparePanel";
import { getCompareStore } from "./register";

/**
 * The left block of the dock while a comparison is active (design 4e and 4f): the heading `Compare revisions` and the
 * comparison sentence in one element, with the counts in bold. The sentence has the words the status region carries; the
 * status region is the live region, this is the same sentence where the eye is.
 */
export function ComparisonDock(): ReactElement | null {
  const cs = getCompareStore();
  const compare = useCompareState(cs);
  if (compare === null || compare.status !== "active" || compare.result === null) return null;
  const { result, detail } = compare;
  const identical = detail?.identical === true;
  return (
    // Named `Comparison summary`, not by its heading: the popover panel is the region called `Compare revisions`, and two regions must not share a name.
    <section className="comparison-dock" aria-label="Comparison summary">
      <h2>Compare revisions</h2>
      {identical ? (
        <p className="comparison-sentence">{NO_DIFFERENCES}</p>
      ) : (
        <p className="comparison-sentence">
          {"Comparison ready: "}
          <strong className="count-removed">{`${result.removedRelations.length} removed`}</strong>
          {", "}
          <strong className="count-added">{`${result.addedRelations.length} added`}</strong>
          {", "}
          <strong className="count-changed">{`${result.changedModules.length} changed`}</strong>
          {" modules; loops "}
          <strong className="count-loops">{`${result.cyclicComponentsBefore} \u2192 ${result.cyclicComponentsAfter}`}</strong>
          {`. Showing the ${compare.shown === "before" ? "earlier" : "newer"} snapshot.`}
        </p>
      )}
    </section>
  );
}