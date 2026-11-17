import type { Investigation, Preset } from "../../contracts/types";
import type { Camera, LayoutRequest, LayoutResult } from "../../scene/layout/types";

// The parts of the investigation store and registry this feature uses, written as structural types.
// `tests/ui/feature-boundary.test.ts` (10.6) forbids any import from `src/features/investigation/**` or
// `src/components/**` here, types included; the real store and registry satisfy these shapes.

export type HostSelection =
  | { kind: "none" }
  | { kind: "module"; id: string }
  | { kind: "relation"; relationId: string; occurrenceId?: string }
  | { kind: "wing"; wing: string };

export interface HostRouteFilter {
  kind: "witness" | "trace" | "focus";
  modules: string[];
  relationIds: string[];
  label: string;
}

export interface HostState {
  screen: "landing" | "investigation";
  investigation: Investigation | null;
  sourceText: ReadonlyMap<string, string> | null;
  preset: Preset;
  selection: HostSelection;
  routeFilter: HostRouteFilter | null;
  expandedWings: string[];
  layout: LayoutResult | null;
  layoutStatus: "idle" | "pending" | "failed";
  layoutError: string | null;
  camera: Camera;
  status: string;
}

export interface HostStore {
  getState(): HostState;
  subscribe(listener: () => void): () => void;
  actions: {
    openInvestigation(inv: Investigation, source: ReadonlyMap<string, string> | null, opts: { expandWing?: string; demo: boolean }): void;
    select(sel: HostSelection, opts: { from: "scene" | "dom" }): void;
    setStatus(message: string): void;
    applyLayout(result: LayoutResult): void;
    replaceInvestigation(inv: Investigation, sourceText: ReadonlyMap<string, string> | null, opts: { keepLayout: true }): void;
    setLayoutRequestBuilder(builder: ((state: HostState) => LayoutRequest | null) | null): void;
    retryLayout(): void;
  };
}

export interface HostLegendEntry {
  concept: string;
  costume: string;
}

export interface HostCompareArgs {
  before: Investigation;
  after: Investigation | { sample: "manor/after" };
  layoutKey: string | null;
}

export interface HostRegistry {
  registerControl(slot: "compare", component: unknown): void;
  registerHandoff(name: "compare", fn: (args: HostCompareArgs) => Promise<void>): void;
  registerLegendEntries(provider: () => HostLegendEntry[]): void;
}
