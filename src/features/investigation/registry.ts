import type { ComponentType } from "react";
import type { CompareArgs } from "./handoffs";
import type { InvestigationStore } from "./store";

// The place where other features hand the interface a control or a function. The interface renders
// a slot only when something is registered in it; it never imports a feature that fills one.

export type Slot = "export" | "compare" | "live-snapshot";

export type { CompareArgs };

/** Rendered as `${concept} — ${costume}`. */
export interface LegendEntry {
  concept: string;
  costume: string;
}

export type ControlComponent = ComponentType<{ store: InvestigationStore }>;

export interface Registry {
  registerControl(slot: Slot, component: ControlComponent): void;
  registerHandoff(name: "compare", fn: (args: CompareArgs) => Promise<void>): void;
  registerHandoff(name: "export", fn: () => void): void;
  /** Removes a handoff; the development hook uses it to show the interface without `compare`. */
  unregisterHandoff(name: "compare" | "export"): void;
  /** Called by the comparison feature; the provider returns an empty list when no comparison is active. */
  registerLegendEntries(provider: () => LegendEntry[]): void;
  getControl(slot: Slot): ControlComponent | null;
  getHandoff(name: "compare" | "export"): ((...args: never[]) => unknown) | null;
  legendEntries(): LegendEntry[];
}

export function createRegistry(): Registry {
  const controls = new Map<Slot, ControlComponent>();
  const handoffs = new Map<string, (...args: never[]) => unknown>();
  const providers: (() => LegendEntry[])[] = [];

  return {
    registerControl(slot, component) {
      controls.set(slot, component);
    },
    registerHandoff(name: "compare" | "export", fn: (...args: never[]) => unknown) {
      handoffs.set(name, fn);
    },
    unregisterHandoff(name) {
      handoffs.delete(name);
    },
    registerLegendEntries(provider) {
      providers.push(provider);
    },
    getControl(slot) {
      return controls.get(slot) ?? null;
    },
    getHandoff(name) {
      return handoffs.get(name) ?? null;
    },
    legendEntries() {
      return providers.flatMap((provider) => provider());
    },
  };
}

/** The one instance of the app. Tests create their own with `createRegistry()`. */
export const registry: Registry = createRegistry();
