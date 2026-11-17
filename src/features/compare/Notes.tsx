import type { ReactElement } from "react";
import type { ComparisonDetail } from "../../analysis/graph/compare";
import type { ComparisonResult } from "../../contracts/types";

export const RENAME_NOTE = "Renames are shown as a removal and an addition; HauntMap does not infer renames.";
export const LIMITS_NOTE = "A removed or added door is a change in the import graph found in the source. It is not a claim about runtime behaviour.";

/** The sentences under `Notes`, in the order of 7.4. */
export function noteSentences(result: ComparisonResult, detail: ComparisonDetail): string[] {
  const out: string[] = [];
  if (result.removedModules.length > 0 && result.addedModules.length > 0) out.push(RENAME_NOTE);
  if (detail.optionsDiffer.length > 0) {
    out.push(`The snapshots were analyzed with different options (${detail.optionsDiffer.join(", ")}); some differences may come from the options.`);
  }
  for (const failed of [...detail.parseFailed].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const side = failed.side === "before" ? "earlier" : "newer";
    const appear = failed.side === "before" ? "added" : "removed";
    out.push(`${failed.id} could not be parsed in the ${side} snapshot; its relations there are unknown and appear as ${appear}.`);
  }
  out.push(LIMITS_NOTE);
  return out;
}

export function Notes({ result, detail }: { result: ComparisonResult; detail: ComparisonDetail }): ReactElement {
  return (
    <>
      <h3>Notes</h3>
      {noteSentences(result, detail).map((sentence) => (
        <p key={sentence}>{sentence}</p>
      ))}
    </>
  );
}
