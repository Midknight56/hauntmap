import { analysisApi } from "../../src/features/investigation/analysisApi";
import { createPrefsStore } from "../../src/features/investigation/prefs";
import { createInvestigationStore } from "../../src/features/investigation/store";
import type { Investigation } from "../../src/contracts/types";
import { createFakeLayoutClient } from "./fakeLayoutClient";
import { fixture, type FixtureName } from "./fixtureFiles";

/** A store over the real analysis seam and a layout client that never answers. */
export function newStore() {
  const layoutClient = createFakeLayoutClient();
  const store = createInvestigationStore({ analysisApi, layoutClient, prefs: createPrefsStore(null) });
  return { store, layoutClient };
}

/** A store with a fixture open. `source` is a path to text map, or null for a snapshot without source. */
export function openedStore(name: FixtureName | Investigation, source: Record<string, string> | null = null) {
  const ctx = newStore();
  const inv = typeof name === "string" ? fixture(name) : name;
  ctx.store.actions.openInvestigation(inv, source === null ? null : new Map(Object.entries(source)), { demo: false });
  return { ...ctx, inv };
}
