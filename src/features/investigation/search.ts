export const SEARCH_LIMIT = 20;

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Module IDs that contain the query, ignoring case, sorted by ID. `shown` holds at most 20 and
 * `total` counts every match. An empty query matches nothing.
 */
export function searchModules(ids: readonly string[], query: string): { shown: string[]; total: number } {
  if (query === "") return { shown: [], total: 0 };
  const needle = query.toLowerCase();
  const matches = ids.filter((id) => id.toLowerCase().includes(needle)).sort(compareText);
  return { shown: matches.slice(0, SEARCH_LIMIT), total: matches.length };
}
