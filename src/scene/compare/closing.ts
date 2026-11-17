import type { ComparisonStyle } from "./index";

/** The canonical form of a closing set, so that two equal sets compare equal whatever their order. */
export function closingKey(ids: readonly string[]): string {
  return JSON.stringify([...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** The corridor closes when a style carries a non-empty closing set that differs from the last one applied. */
export function shouldClose(style: ComparisonStyle | null, lastKey: string): boolean {
  return style !== null && style.closingRelationIds.length > 0 && closingKey(style.closingRelationIds) !== lastKey;
}
