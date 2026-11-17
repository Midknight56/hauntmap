import { occurrenceId, relationId } from "../../src/analysis";
import type { DependencyKind, SyntaxKind } from "../../src/contracts/types";

export { occurrenceId, relationId };

/** The relation ID of a resolved local edge: the target key is `["local", to]`. */
export function relationIdFor(from: string, to: string, syntaxKind: SyntaxKind, dependencyKind: DependencyKind): string {
  return relationId(from, ["local", to], syntaxKind, dependencyKind);
}
