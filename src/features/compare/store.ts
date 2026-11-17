import { DEFAULT_ANALYSIS_OPTIONS } from "../../contracts/options";
import type { ComparisonResult, Investigation } from "../../contracts/types";
import { compareInvestigations, type ComparisonDetail } from "../../analysis/graph/compare";
import type { LayoutResult } from "../../scene/layout/types";
import type { AnalysisClient } from "../../workers/client";
import type { HostState, HostStore } from "./host";
import { UNCHANGED, acquireSnapshot, type AfterSource, type SampleLoader, type Snapshot } from "./sources";
import {
  buildUnionGraph,
  buildUnionRequest,
  extendLayout,
  unionLayoutKey,
  unionRequestBuilder,
  type DoorPlacement,
  type PresetQuery,
  type UnionGraph,
} from "./unionLayout";

export type { AfterSource, Snapshot };

// The comparison state machine. Both snapshots live here, in memory only. The fleet store is driven
// through its own actions: `replaceInvestigation` for the shown side, `applyLayout` or the union request
// builder for the layout, `select` for a change chosen in the panel, `setStatus` for every message.

export type Side = "before" | "after";
export type CompareStatus = "idle" | "acquiring" | "comparing" | "laying-out" | "active";

export interface CompareState {
  compareStateVersion: 1;
  status: CompareStatus;
  panelOpen: boolean;
  before: Snapshot | null;
  after: Snapshot | null;
  result: ComparisonResult | null;
  detail: ComparisonDetail | null;
  shown: Side;
  union: UnionGraph | null;
  layoutPath: "extended" | "fresh" | "pending" | null;
  unionLayoutKey: string | null;
  /** Removed relation IDs that the dropped witness held, computed at activation and at each `show`. */
  closingRelationIds: string[];
  /** The last item chosen in the panel's lists. */
  selected: { kind: "relation" | "module"; id: string } | null;
  /** The last failure message, also written to the status region. */
  error: string | null;
}

export interface CompareStore {
  getState(): CompareState;
  subscribe(listener: () => void): () => void;
  actions: {
    openPanel(): void;
    closePanel(): void;
    compareWithSample(): Promise<void>;
    compareWithPair(): Promise<void>;
    /** Rejects with the shown message when the comparison cannot be made. `before` defaults to the open investigation. */
    compareWith(after: AfterSource, layoutKey: string | null, before?: Investigation): Promise<void>;
    show(side: Side): void;
    selectChange(item: { kind: "relation" | "module"; id: string }): void;
    end(): void;
    reset(): void;
  };
}

export interface CompareDeps {
  store: HostStore;
  analysisApi: PresetQuery;
  analysisClient: Pick<AnalysisClient, "analyze">;
  loadSample: SampleLoader;
  base: string;
  place: DoorPlacement;
  sha256Hex?: (text: string) => Promise<string>;
}

const ARROW = "\u2192";
const FRESH_NOTE = "The map was laid out again for the comparison; rooms may have moved.";
const NO_DIFFERENCES = "No differences: the snapshots have the same modules, relations and source hashes.";

async function webSha256(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function initialState(panelOpen = false): CompareState {
  return {
    compareStateVersion: 1,
    status: "idle",
    panelOpen,
    before: null,
    after: null,
    result: null,
    detail: null,
    shown: "after",
    union: null,
    layoutPath: null,
    unionLayoutKey: null,
    closingRelationIds: [],
    selected: null,
    error: null,
  };
}

/** The name and the stack frames of an error; the first stack line carries the message, which may hold a path. */
function logFailure(error: unknown): void {
  const name = error instanceof Error ? error.name : "Error";
  const frames = error instanceof Error && typeof error.stack === "string" ? error.stack.split("\n").filter((line) => /^\s+at\s/.test(line)) : [];
  console.error(`hauntmap: comparison failed (${name})${frames.length > 0 ? `\n${frames.join("\n")}` : ""}`);
}

class CompareFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompareFailure";
  }
}

export function createCompareStore(deps: CompareDeps): CompareStore {
  const host = deps.store;
  const sha = deps.sha256Hex ?? webSha256;
  let state: CompareState = initialState();
  const listeners = new Set<() => void>();
  let running: Promise<void> | null = null;
  /** Bumped by `reset`, so that a comparison still running when the fleet store restarts does nothing more. */
  let generation = 0;
  /** The union the store's request builder reads; set while a comparison is laid out or active. */
  let builderUnion: UnionGraph | null = null;
  const builder = unionRequestBuilder(() => (builderUnion === null ? null : { union: builderUnion, engine: host.getState().layout?.engine.name ?? "dagre" }));

  function set(patch: Partial<CompareState>): void {
    state = { ...state, ...patch };
    for (const listener of [...listeners]) listener();
  }

  function layoutSettled(): Promise<HostState["layoutStatus"]> {
    const now = host.getState().layoutStatus;
    if (now !== "pending") return Promise.resolve(now);
    return new Promise((resolve) => {
      const off = host.subscribe(() => {
        const status = host.getState().layoutStatus;
        if (status !== "pending") {
          off();
          resolve(status);
        }
      });
    });
  }

  function closingFor(side: Side, removed: readonly string[]): string[] {
    if (side !== "after") return [];
    const filter = host.getState().routeFilter;
    if (filter === null || filter.kind !== "witness") return [];
    const gone = new Set(removed);
    return filter.relationIds.filter((id) => gone.has(id));
  }

  function readyMessage(result: ComparisonResult, identical: boolean): string {
    if (identical) return NO_DIFFERENCES;
    return `Comparison ready: ${result.removedRelations.length} removed, ${result.addedRelations.length} added, ${result.changedModules.length} changed modules; loops ${result.cyclicComponentsBefore} ${ARROW} ${result.cyclicComponentsAfter}. Showing the newer snapshot.`;
  }

  function fail(message: string, previous: CompareStatus, error?: unknown): never {
    set({ status: previous === "active" ? "active" : "idle", error: message });
    host.actions.setStatus(message);
    logFailure(error ?? new CompareFailure("comparison failed"));
    throw new CompareFailure(message);
  }

  /** The comparison proper, from acquisition to activation. Throws `CompareFailure` after the message is shown. */
  async function run(after: AfterSource, layoutKey: string | null, explicitBefore: Investigation | undefined, tail: string): Promise<void> {
    const mine = generation;
    const stale = (): boolean => mine !== generation;
    const previous: CompareStatus = state.status === "active" ? "active" : "idle";
    const hostState = host.getState();
    let before: Snapshot;
    if (previous === "active" && state.before !== null) before = state.before;
    else {
      const inv = explicitBefore ?? hostState.investigation;
      if (inv === null) fail(`The snapshots cannot be compared: there is no open investigation. ${tail}`, previous);
      before = { label: inv.sourceLabel, investigation: inv, sourceText: inv === hostState.investigation ? hostState.sourceText : null };
    }
    const newerLabel = after.kind === "sample" ? after.id : after.snapshot.label;
    set({ status: "acquiring", error: null });
    host.actions.setStatus(`Comparing ${before.label} with ${newerLabel === "" ? "the newer snapshot" : newerLabel}\u2026`);

    const acquired = await acquireSnapshot(after, deps, before.investigation.options, tail);
    if (stale()) return;
    if (!acquired.ok) fail(acquired.message, previous, acquired.error);
    const newer = acquired.snapshot;

    set({ status: "comparing" });
    const outcome = compareInvestigations(before.investigation, newer.investigation);
    if (!outcome.ok) fail(`The snapshots cannot be compared: ${outcome.error.message}. ${tail}`, previous);
    const { result, detail } = outcome;

    set({ status: "laying-out", layoutPath: "pending" });
    const now = host.getState();
    const union = buildUnionGraph(before.investigation, newer.investigation, now.preset, deps.analysisApi);
    const current: LayoutResult | null = now.layout;
    const extended = current !== null && now.layoutStatus === "idle" && current.layoutKey === layoutKey;
    const extras: string[] = [];

    if (extended && current !== null) {
      const keep = new Map(current.wings.filter((w) => w.expanded).map((w) => [w.wing, w.shownIds] as const));
      const request = buildUnionRequest(union, now.expandedWings, keep, now.preset, current.engine.name);
      const key = await unionLayoutKey(current.layoutKey, request, current.engine, sha);
      if (stale()) return;
      const out = extendLayout(current, union, request, deps.place, key);
      if (out.movedRoomIds.length > 0) extras.push(`${out.movedRoomIds.length} rooms moved to make room for ${out.addedRoomIds.length} added modules.`);
      const closing = closingFor("after", result.removedRelations.map((r) => r.relationId));
      builderUnion = union;
      set({
        status: "active",
        before,
        after: newer,
        result,
        detail,
        shown: "after",
        union,
        layoutPath: "extended",
        unionLayoutKey: key,
        closingRelationIds: closing,
        selected: null,
        error: null,
      });
      host.actions.setLayoutRequestBuilder(builder);
      host.actions.applyLayout(out.layout);
      host.actions.replaceInvestigation(newer.investigation, newer.sourceText, { keepLayout: true });
    } else {
      builderUnion = union;
      host.actions.setLayoutRequestBuilder(builder);
      host.actions.retryLayout();
      const settled = await layoutSettled();
      if (stale()) return;
      extras.push(FRESH_NOTE);
      const after2 = host.getState();
      if (settled === "failed") extras.push(`The map layout did not finish (${after2.layoutError ?? "unknown error"}). The Evidence view has the full investigation.`);
      const closing = closingFor("after", result.removedRelations.map((r) => r.relationId));
      set({
        status: "active",
        before,
        after: newer,
        result,
        detail,
        shown: "after",
        union,
        layoutPath: "fresh",
        unionLayoutKey: after2.layout?.layoutKey ?? null,
        closingRelationIds: closing,
        selected: null,
        error: null,
      });
      host.actions.replaceInvestigation(newer.investigation, newer.sourceText, { keepLayout: true });
    }
    host.actions.setStatus([readyMessage(result, detail.identical), ...extras].join(" "));
  }

  function guarded(task: () => Promise<void>): Promise<void> {
    if (running !== null) return running;
    if (state.status !== "idle" && state.status !== "active") return Promise.resolve();
    const promise = task().finally(() => {
      if (running === promise) running = null;
    });
    running = promise;
    return promise;
  }

  const swallow = (promise: Promise<void>): Promise<void> => promise.catch((error: unknown) => {
    if (!(error instanceof CompareFailure)) throw error;
  });

  async function pair(): Promise<void> {
    const mine = generation;
    const previous = state.status;
    set({ status: "acquiring", error: null });
    host.actions.setStatus(`Comparing manor/before with manor/after\u2026`);
    const restore = (message: string, error?: unknown): void => {
      set({ status: previous === "active" ? "active" : "idle", error: message });
      host.actions.setStatus(message);
      logFailure(error ?? new CompareFailure("comparison failed"));
    };
    const loaded = await deps.loadSample("manor/before", deps.base);
    if (mine !== generation) return;
    if (!loaded.ok) {
      restore(loaded.message);
      return;
    }
    let investigation: Investigation;
    try {
      investigation = await deps.analysisClient.analyze({ files: loaded.sourceSet.files, rootLabel: loaded.sourceSet.rootLabel, options: DEFAULT_ANALYSIS_OPTIONS });
    } catch (error) {
      if (mine !== generation) return;
      restore(`The manor sample could not be analyzed (${error instanceof Error ? error.message : String(error)}). Reload the page.`, error);
      return;
    }
    if (mine !== generation) return;
    if (previous === "active") leave();
    set({ status: "idle" });
    const sourceText = new Map(loaded.sourceSet.files.map((f) => [f.path, f.text] as const));
    host.actions.openInvestigation(investigation, sourceText, { expandWing: "src/orders", demo: false });
    const settled = await layoutSettled();
    if (mine !== generation || settled === "failed") return;
    await run({ kind: "sample", id: "manor/after" }, host.getState().layout?.layoutKey ?? null, undefined, "manor/before stays open.");
  }

  /** Drop the comparison without touching the shown investigation. */
  function leave(): void {
    builderUnion = null;
    host.actions.setLayoutRequestBuilder(null);
    set({ ...initialState(state.panelOpen) });
  }

  const actions: CompareStore["actions"] = {
    openPanel() {
      set({ panelOpen: true });
    },
    closePanel() {
      set({ panelOpen: false });
    },
    compareWithSample() {
      return swallow(guarded(() => run({ kind: "sample", id: "manor/after" }, host.getState().layout?.layoutKey ?? null, undefined, UNCHANGED)));
    },
    compareWithPair() {
      return swallow(guarded(pair));
    },
    compareWith(after, layoutKey, before) {
      return guarded(() => run(after, layoutKey, before, UNCHANGED));
    },
    show(side) {
      if (state.status !== "active" || state.before === null || state.after === null || state.result === null) return;
      const snapshot = side === "before" ? state.before : state.after;
      const closing = closingFor(side, state.result.removedRelations.map((r) => r.relationId));
      set({ shown: side, closingRelationIds: closing });
      host.actions.replaceInvestigation(snapshot.investigation, snapshot.sourceText, { keepLayout: true });
      host.actions.setStatus(`Showing the ${side === "before" ? "earlier" : "newer"} snapshot (${snapshot.label}).`);
    },
    selectChange(item) {
      set({ selected: item });
      host.actions.select(item.kind === "relation" ? { kind: "relation", relationId: item.id } : { kind: "module", id: item.id }, { from: "dom" });
    },
    end() {
      if (state.status !== "active" || state.before === null) return;
      const before = state.before;
      host.actions.replaceInvestigation(before.investigation, before.sourceText, { keepLayout: true });
      const selection = host.getState().selection;
      const ids = new Set(before.investigation.modules.map((m) => m.id));
      const relations = new Set(before.investigation.imports.map((r) => r.relationId));
      const keeps =
        selection.kind === "none" ||
        (selection.kind === "module" && ids.has(selection.id)) ||
        (selection.kind === "relation" && relations.has(selection.relationId)) ||
        (selection.kind === "wing" && before.investigation.modules.some((m) => m.id.startsWith(`${selection.wing}/`)));
      if (!keeps) host.actions.select({ kind: "none" }, { from: "dom" });
      builderUnion = null;
      set({ status: "idle", shown: "after", closingRelationIds: [], selected: null });
      host.actions.setLayoutRequestBuilder(null);
      host.actions.retryLayout();
      set({ ...initialState(state.panelOpen) });
      host.actions.setStatus(`Comparison ended. Showing ${before.label}.`);
    },
    reset() {
      generation++;
      running = null;
      builderUnion = null;
      set(initialState());
    },
  };

  // Restart demo (6.7): the fleet store returns to the landing screen; the comparison goes with it.
  // Only a change from an open investigation to the landing screen counts, so that a comparison started
  // from the landing screen (the bundled pair) is not reset by its own status messages.
  let wasOpen = host.getState().investigation !== null;
  host.subscribe(() => {
    const s = host.getState();
    const open = s.investigation !== null || s.screen !== "landing";
    if (wasOpen && !open) actions.reset();
    wasOpen = open;
  });

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    actions,
  };
}
