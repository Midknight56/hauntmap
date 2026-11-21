import type { Investigation } from "../../contracts/types";

// How an investigation that intake brought in opens (blind test fixes of 20 November 2026): a small project opens with every
// folder open, so that its files show as rooms at once instead of one closed box; a project of one folder opens that folder.

/** A project of at most this many modules opens with all of its wings open. */
export const OPEN_ALL_WINGS_UP_TO = 24;

function wingOf(id: string): string {
  const slash = id.lastIndexOf("/");
  return slash < 0 ? "(root)" : id.slice(0, slash);
}

export function openOptions(investigation: Investigation): { demo: false; expandWings?: string[] } {
  const wings = [...new Set(investigation.modules.map((m) => wingOf(m.id)))].sort();
  if (wings.length === 1 || (wings.length > 0 && investigation.modules.length <= OPEN_ALL_WINGS_UP_TO)) return { demo: false, expandWings: wings };
  return { demo: false };
}