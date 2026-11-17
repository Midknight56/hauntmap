import type { DependencyKind, SyntaxKind } from "../../contracts/types";

/** `["local", to]` for a resolved local import, `[resolution, specifier]` for every other target. */
export type TargetKey = [string, string];

/** The id of one import statement: `JSON.stringify([from, line, column, specifier])`. Line and column are one based. */
export function occurrenceId(from: string, line: number, column: number, specifier: string): string {
  return JSON.stringify([from, line, column, specifier]);
}

/** The id of one relation: `JSON.stringify([from, targetKey, syntaxKind, dependencyKind])`. */
export function relationId(from: string, targetKey: TargetKey, syntaxKind: SyntaxKind, dependencyKind: DependencyKind): string {
  return JSON.stringify([from, targetKey, syntaxKind, dependencyKind]);
}
