import { CompareControl } from "./CompareControl";
import type { HostCompareArgs, HostRegistry } from "./host";
import { LEGEND_ENTRIES } from "./legend";
import type { AfterSource, CompareStore } from "./store";

// The one coupling with the interface: the registry. The control reads the compare store through the
// accessor below, because a registered control receives only `{ store }`.

let current: CompareStore | null = null;

/** The compare store registered last, for the toolbar control. */
export function getCompareStore(): CompareStore | null {
  return current;
}

function toSource(after: HostCompareArgs["after"]): AfterSource {
  if ("sample" in after) return { kind: "sample", id: after.sample };
  return { kind: "investigation", snapshot: { label: after.sourceLabel, investigation: after, sourceText: null } };
}

export function registerCompare(registry: HostRegistry, compareStore: CompareStore): void {
  current = compareStore;
  registry.registerControl("compare", CompareControl);
  registry.registerHandoff("compare", (args) => compareStore.actions.compareWith(toSource(args.after), args.layoutKey, args.before));
  registry.registerLegendEntries(() => (compareStore.getState().status === "active" ? LEGEND_ENTRIES : []));
}