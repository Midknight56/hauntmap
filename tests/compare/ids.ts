import { occurrenceId, relationId } from "../../src/analysis";
import type { DependencyKind, SyntaxKind } from "../../src/contracts/types";

export { occurrenceId, relationId };

/** The relation ID of a resolved local edge: the target key is `["local", to]`. */
export function relationIdFor(from: string, to: string, syntaxKind: SyntaxKind, dependencyKind: DependencyKind): string {
  return relationId(from, ["local", to], syntaxKind, dependencyKind);
}

/** The relation ID of a boundary relation: the target key is `[resolution, specifier]`. */
export function boundaryRelationIdFor(
  from: string,
  resolution: "external" | "unresolved" | "unsupported",
  specifier: string,
  syntaxKind: SyntaxKind,
  dependencyKind: DependencyKind,
): string {
  return relationId(from, [resolution, specifier], syntaxKind, dependencyKind);
}
