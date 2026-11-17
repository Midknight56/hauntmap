import type { CycleReport, ImportRecord, Investigation, Preset, TraceResult } from "../../contracts/types";
import type { Camera, LayoutRequest, LayoutResult } from "../../scene/layout/types";
import type { DemoStepId, DemoStepState } from "../demo/types";
import type { AnalysisApi } from "./analysisApi";
import type { LayoutClient } from "./layoutClient";
import { DEFAULT_PREFS, type Prefs, type PrefsStore } from "./prefs";
import { routeProse, traceLabel, witnessLabel, type Panel, type RouteFilter, type Selection } from "./selection";
import { WING_CAP, buildLayoutRequest, shownIdsFor } from "./layoutRequest";
import { drawnRelations, wingsOf } from "./wings";

export interface RendererStatus {
  status: "starting" | "ready" | "unavailable" | "context-lost";
  reason?: "init-failed" | "no-webgl" | "forced" | "context-lost";
  message?: string;
}

export interface ViewState {
  viewStateVersion: 1;
  screen: "landing" | "investigation";
  investigation: Investigation | null;
  /** Path to text; null for a live snapshot. Never part of an Investigation or an export. */
  sourceText: ReadonlyMap<string, string> | null;
  demo: boolean;
  preset: Preset;
  selection: Selection;
  /** Where the last selecting action came from; the scene keeps focus on the wrapper for `scene`. */
  selectionOrigin: "scene" | "dom" | null;
  routeFilter: RouteFilter | null;
  expandedWings: string[];
  searchQuery: string;
  activeView: "map" | "evidence";
  evidenceWingFilter: string | null;
  panel: Panel;
  steps: DemoStepState | null;
  layout: LayoutResult | null;
  layoutStatus: "idle" | "pending" | "failed";
  layoutRevision: number;
  layoutError: string | null;
  camera: Camera;
  renderer: RendererStatus;
  status: string;
  legendOpen: boolean;
  motion: Prefs["motion"];
}

export interface InvestigationStore {
  getState(): ViewState;
  subscribe(listener: () => void): () => void;
  actions: {
    openInvestigation(
      inv: Investigation,
      source: ReadonlyMap<string, string> | null,
      opts: { expandWing?: string; demo: boolean },
    ): void;
    restart(): void;
    select(sel: Selection, opts: { from: "scene" | "dom" }): void;
    clearSelection(): void;
    setPreset(preset: Preset): void;
    expandWing(wing: string, bring?: string): void;
    collapseWing(wing: string): void;
    setSearch(query: string): void;
    setView(view: "map" | "evidence", wingFilter?: string | null): void;
    openLoops(): void;
    chooseLoop(index: number): void;
    openWhoImports(origin: string): void;
    chooseImporter(id: string): void;
    focusModule(id: string): void;
    setCamera(camera: Camera): void;
    setStatus(message: string): void;
    /** An externally produced layout (the comparison's union layout). */
    applyLayout(result: LayoutResult): void;
    replaceInvestigation(
      inv: Investigation,
      sourceText: ReadonlyMap<string, string> | null,
      opts: { keepLayout: true },
    ): void;
    setLayoutRequestBuilder(builder: ((state: ViewState) => LayoutRequest | null) | null): void;
    layoutResult(result: LayoutResult, revision: number): void;
    layoutFailed(reason: string, revision: number): void;
    retryLayout(): void;
    rendererStatus(status: RendererStatus): void;
    closePanel(): void;
    stepAction(id: DemoStepId, action: "do" | "skip" | "done"): void;
    closeSteps(): void;
    openSteps(): void;
    setLegendOpen(open: boolean): void;
    setMotion(motion: ViewState["motion"]): void;
  };
}

export interface StoreDeps {
  analysisApi: AnalysisApi;
  layoutClient: LayoutClient;
  prefs: PrefsStore;
  now?: () => number;
  /** True when a `compare` handoff is registered; the steps panel then has its third step. */
  compareAvailable?: () => boolean;
}

export const LAYOUT_TIMEOUT_MS = 10_000;
const DEFAULT_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function clampZoom(zoom: number): number {
  return Math.min(4, Math.max(0.25, zoom));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function logFailure(what: string, error: unknown): void {
  // The name only: a message or a stack can carry a path, and no telemetry exists.
  console.error(`hauntmap: could not compute ${what} (${error instanceof Error ? error.name : "error"})`);
}

function initialState(prefs: Prefs): ViewState {
  return {
    viewStateVersion: 1,
    screen: "landing",
    investigation: null,
    sourceText: null,
    demo: false,
    preset: prefs.preset,
    selection: { kind: "none" },
    selectionOrigin: null,
    routeFilter: null,
    expandedWings: [],
    searchQuery: "",
    activeView: "map",
    evidenceWingFilter: null,
    panel: { kind: "none" },
    steps: null,
    layout: null,
    layoutStatus: "idle",
    layoutRevision: 0,
    layoutError: null,
    camera: { ...DEFAULT_CAMERA },
    renderer: { status: "starting" },
    status: "",
    legendOpen: prefs.legendOpen,
    motion: prefs.motion,
  };
}

/** The first occurrence of a relation by line, then column. */
function occurrenceOf(inv: Investigation, relationId: string): string | undefined {
  let best: ImportRecord | undefined;
  for (const record of inv.imports) {
    if (record.relationId !== relationId) continue;
    if (best === undefined || record.line < best.line || (record.line === best.line && record.column < best.column)) best = record;
  }
  return best?.occurrenceId;
}

function relationSelection(inv: Investigation, relationId: string): Selection {
  const occurrenceId = occurrenceOf(inv, relationId);
  return occurrenceId === undefined ? { kind: "relation", relationId } : { kind: "relation", relationId, occurrenceId };
}

export function createInvestigationStore(deps: StoreDeps): InvestigationStore {
  const api = deps.analysisApi;
  const layoutClient = deps.layoutClient;
  const prefs = deps.prefs;

  let state: ViewState = initialState(prefs.read());
  const listeners = new Set<() => void>();
  let builder: ((state: ViewState) => LayoutRequest | null) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped by restart so that an answer to an older request is dropped even if a client forwards it. */
  let generation = 0;
  /** The module brought into view in each capped wing. */
  const brought = new Map<string, string>();
  let wingCache: { inv: Investigation; wings: Map<string, string[]> } | null = null;

  function wingMap(inv: Investigation): Map<string, string[]> {
    if (wingCache === null || wingCache.inv !== inv) {
      wingCache = { inv, wings: new Map(wingsOf(inv).map((w) => [w.wing, w.moduleIds])) };
    }
    return wingCache.wings;
  }

  function commit(next: ViewState): void {
    state = next;
    for (const listener of [...listeners]) listener();
  }

  function set(patch: Partial<ViewState>): void {
    commit({ ...state, ...patch });
  }

  function clearTimer(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function cappedStatus(wing: string, total: number): string {
    return `Showing ${WING_CAP} of ${total} modules in ${wing}. Search to bring another module into view, or use the Evidence view for the full list.`;
  }

  /** Apply a patch and, in the same notification, send exactly one layout request for the new state. */
  function commitWithLayoutRequest(patch: Partial<ViewState>): void {
    const base = { ...state, ...patch };
    if (base.investigation === null) {
      commit(base);
      return;
    }
    const revision = state.layoutRevision + 1;
    const next: ViewState = { ...base, layoutRevision: revision, layoutStatus: "pending", layoutError: null };
    commit(next);
    const request = (builder === null ? null : builder(next)) ?? buildLayoutRequest(next.investigation as Investigation, next.preset, next.expandedWings, brought, api);
    const owner = generation;
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      if (owner !== generation || state.layoutRevision !== revision || state.layoutStatus !== "pending") return;
      actions.layoutFailed(`no answer in ${LAYOUT_TIMEOUT_MS.toLocaleString("en-US")} ms`, revision);
      layoutClient.cancel();
    }, LAYOUT_TIMEOUT_MS);
    layoutClient.request(request, revision).then(
      (result) => {
        if (owner === generation) actions.layoutResult(result, revision);
      },
      (error: unknown) => {
        if (owner === generation) actions.layoutFailed(errorMessage(error), revision);
      },
    );
  }

  function demoSteps(): DemoStepState {
    const ids: DemoStepId[] = ["follow", "loop"];
    if (deps.compareAvailable?.() === true) ids.push("compare");
    return { version: 1, steps: ids.map((id) => ({ id, status: "todo" as const })), dismissed: false };
  }

  // ---- route filters and panels -------------------------------------------------------------

  function witnessFilter(report: CycleReport, index: number): RouteFilter | null {
    const component = report.components[index];
    if (component === undefined) return null;
    return {
      kind: "witness",
      modules: [...component.witness.modules],
      relationIds: [...component.witness.relationIds],
      label: witnessLabel(component.witness.modules),
    };
  }

  /** The shortest route from `chosen` to the origin, following `predecessor`; null when it cannot be built. */
  function traceFilter(inv: Investigation, preset: Preset, result: TraceResult, chosen: string): RouteFilter | null {
    const modules = [chosen];
    let current = chosen;
    for (let guard = 0; current !== result.origin && guard <= result.visited.length; guard++) {
      const next = result.predecessor[current];
      if (next === undefined) return null;
      modules.push(next);
      current = next;
    }
    if (current !== result.origin) return null;
    const drawn = drawnRelations(inv, preset, api);
    const relationIds: string[] = [];
    for (let i = 0; i + 1 < modules.length; i++) {
      const record = drawn.find((r) => r.from === modules[i] && r.to === modules[i + 1]);
      if (record === undefined) return null;
      relationIds.push(record.relationId);
    }
    return {
      kind: "trace",
      modules,
      relationIds,
      label: traceLabel(modules),
      origin: result.origin,
      direction: result.direction,
      prose: routeProse(modules),
    };
  }

  function computeLoops(inv: Investigation, preset: Preset, chosen: number | null): Panel {
    try {
      const report = api.cycles(inv, preset);
      return {
        kind: "loops",
        report,
        chosen: chosen !== null && chosen < report.components.length ? chosen : null,
        error: null,
      };
    } catch (error) {
      logFailure("loops", error);
      return { kind: "loops", report: null, chosen: null, error: `Could not compute loops for this preset: ${errorMessage(error)}.` };
    }
  }

  function computeWhoImports(inv: Investigation, preset: Preset, origin: string, chosen: string | null): Panel {
    try {
      const result = api.trace(inv, origin, "imported-by", preset);
      return {
        kind: "whoImports",
        origin,
        result,
        chosen: chosen !== null && result.predecessor[chosen] !== undefined ? chosen : null,
        error: null,
      };
    } catch (error) {
      logFailure("importers", error);
      return {
        kind: "whoImports",
        origin,
        result: null,
        chosen: null,
        error: `Could not compute importers for this preset: ${errorMessage(error)}.`,
      };
    }
  }

  function focusFilter(inv: Investigation, preset: Preset, id: string): RouteFilter {
    const importers = api.trace(inv, id, "imported-by", preset);
    const imports = api.trace(inv, id, "imports", preset);
    const modules = [...new Set([id, ...importers.direct, ...imports.direct])].sort(compareText);
    const relationIds = drawnRelations(inv, preset, api)
      .filter((r) => r.from === id || r.to === id)
      .map((r) => r.relationId);
    return {
      kind: "focus",
      modules,
      relationIds,
      label: `Focus: ${id}`,
      origin: id,
      prose: `Focused on ${id}: ${importers.direct.length} importers, ${imports.direct.length} imports.`,
    };
  }

  /** The panel and route filter that follow from a preset change. */
  function rebuild(inv: Investigation, preset: Preset): Pick<ViewState, "panel" | "routeFilter"> {
    const panel = state.panel;
    if (panel.kind === "loops") {
      const next = computeLoops(inv, preset, panel.chosen);
      const filter = next.kind === "loops" && next.report !== null && next.chosen !== null ? witnessFilter(next.report, next.chosen) : null;
      return { panel: next, routeFilter: filter };
    }
    if (panel.kind === "whoImports") {
      if (!inv.modules.some((m) => m.id === panel.origin)) return { panel: { kind: "none" }, routeFilter: null };
      const next = computeWhoImports(inv, preset, panel.origin, panel.chosen);
      const filter =
        next.kind === "whoImports" && next.result !== null && next.chosen !== null ? traceFilter(inv, preset, next.result, next.chosen) : null;
      return { panel: next, routeFilter: filter };
    }
    const current = state.routeFilter;
    if (current?.kind === "focus" && current.origin !== undefined) {
      try {
        return { panel, routeFilter: focusFilter(inv, preset, current.origin) };
      } catch (error) {
        logFailure("focus", error);
      }
    }
    return { panel, routeFilter: null };
  }

  const actions: InvestigationStore["actions"] = {
    openInvestigation(inv, source, opts) {
      brought.clear();
      const wings = wingMap(inv);
      const expanded = opts.expandWing !== undefined && wings.has(opts.expandWing) ? [opts.expandWing] : [];
      const members = expanded[0] === undefined ? [] : (wings.get(expanded[0]) ?? []);
      commitWithLayoutRequest({
        screen: "investigation",
        investigation: inv,
        sourceText: source,
        demo: opts.demo,
        selection: { kind: "none" },
        selectionOrigin: null,
        routeFilter: null,
        expandedWings: expanded,
        searchQuery: "",
        activeView: "map",
        evidenceWingFilter: null,
        panel: { kind: "none" },
        steps: opts.demo ? demoSteps() : null,
        layout: null,
        camera: { ...DEFAULT_CAMERA },
        status: members.length > WING_CAP && expanded[0] !== undefined ? cappedStatus(expanded[0], members.length) : "",
      });
    },

    restart() {
      clearTimer();
      generation++;
      if (state.layoutStatus === "pending") layoutClient.cancel();
      brought.clear();
      wingCache = null;
      if (prefs.read().preset !== DEFAULT_PREFS.preset) prefs.write({ ...prefs.read(), preset: DEFAULT_PREFS.preset });
      commit({ ...initialState({ ...DEFAULT_PREFS, legendOpen: state.legendOpen, motion: state.motion }) });
    },

    select(sel, opts) {
      set({ selection: sel, selectionOrigin: opts.from });
    },

    clearSelection() {
      set({ selection: { kind: "none" }, selectionOrigin: null, routeFilter: null });
    },

    setPreset(preset) {
      if (preset === state.preset) return;
      prefs.write({ ...prefs.read(), preset });
      const inv = state.investigation;
      const patch: Partial<ViewState> = { preset };
      if (inv !== null) Object.assign(patch, rebuild(inv, preset));
      commitWithLayoutRequest(patch);
    },

    expandWing(wing, bring) {
      const inv = state.investigation;
      if (inv === null) return;
      const members = wingMap(inv).get(wing);
      if (members === undefined) return;
      const wanted = bring !== undefined && members.includes(bring) ? bring : undefined;
      if (state.expandedWings.includes(wing) && (wanted === undefined || shownIdsFor(members, brought.get(wing)).shownIds.includes(wanted))) return;
      if (wanted !== undefined) brought.set(wing, wanted);
      const expanded = [...new Set([...state.expandedWings, wing])].sort(compareText);
      commitWithLayoutRequest({
        expandedWings: expanded,
        ...(members.length > WING_CAP ? { status: cappedStatus(wing, members.length) } : {}),
      });
    },

    collapseWing(wing) {
      if (!state.expandedWings.includes(wing)) return;
      brought.delete(wing);
      commitWithLayoutRequest({ expandedWings: state.expandedWings.filter((w) => w !== wing) });
    },

    setSearch(query) {
      set({ searchQuery: query });
    },

    setView(view, wingFilter) {
      set({ activeView: view, evidenceWingFilter: view === "evidence" ? (wingFilter ?? null) : null });
    },

    openLoops() {
      const inv = state.investigation;
      if (inv === null) return;
      set({ panel: computeLoops(inv, state.preset, null) });
    },

    chooseLoop(index) {
      const inv = state.investigation;
      const panel = state.panel;
      if (inv === null || panel.kind !== "loops" || panel.report === null) return;
      const filter = witnessFilter(panel.report, index);
      if (filter === null) return;
      const first = filter.relationIds[0];
      set({
        panel: { ...panel, chosen: index },
        routeFilter: filter,
        ...(first === undefined ? {} : { selection: relationSelection(inv, first), selectionOrigin: "dom" as const }),
      });
    },

    openWhoImports(origin) {
      const inv = state.investigation;
      if (inv === null) return;
      set({ panel: computeWhoImports(inv, state.preset, origin, null) });
    },

    chooseImporter(id) {
      const inv = state.investigation;
      const panel = state.panel;
      if (inv === null || panel.kind !== "whoImports" || panel.result === null) return;
      const filter = traceFilter(inv, state.preset, panel.result, id);
      if (filter === null) return;
      const first = filter.relationIds[0];
      set({
        panel: { ...panel, chosen: id },
        routeFilter: filter,
        ...(first === undefined ? {} : { selection: relationSelection(inv, first), selectionOrigin: "dom" as const }),
      });
    },

    focusModule(id) {
      const inv = state.investigation;
      if (inv === null) return;
      try {
        const filter = focusFilter(inv, state.preset, id);
        set({ routeFilter: filter, status: filter.prose ?? "" });
      } catch (error) {
        logFailure("focus", error);
        set({ status: `Could not focus this module for this preset: ${errorMessage(error)}.` });
      }
    },

    setCamera(camera) {
      set({ camera: { x: camera.x, y: camera.y, zoom: clampZoom(camera.zoom) } });
    },

    setStatus(message) {
      set({ status: message });
    },

    applyLayout(result) {
      clearTimer();
      set({ layout: result, layoutStatus: "idle", layoutError: null, layoutRevision: state.layoutRevision + 1 });
    },

    replaceInvestigation(inv, sourceText) {
      const ids = new Set(inv.modules.map((m) => m.id));
      const relations = new Set(inv.imports.map((r) => r.relationId));
      const filter = state.routeFilter;
      const filterValid = filter !== null && filter.modules.every((m) => ids.has(m)) && filter.relationIds.every((r) => relations.has(r));
      let panel = state.panel;
      if (panel.kind === "loops") {
        panel = computeLoops(inv, state.preset, panel.chosen);
      } else if (panel.kind === "whoImports") {
        panel = ids.has(panel.origin) ? computeWhoImports(inv, state.preset, panel.origin, panel.chosen) : { kind: "none" };
      }
      set({ investigation: inv, sourceText, routeFilter: filterValid ? filter : null, panel });
    },

    setLayoutRequestBuilder(next) {
      builder = next;
    },

    layoutResult(result, revision) {
      if (revision !== state.layoutRevision || state.layoutStatus === "failed") return;
      clearTimer();
      set({ layout: result, layoutStatus: "idle", layoutError: null });
    },

    layoutFailed(reason, revision) {
      if (revision !== state.layoutRevision || state.layoutStatus !== "pending") return;
      clearTimer();
      set({
        layoutStatus: "failed",
        layoutError: reason,
        status: `The map layout did not finish (${reason}). The Evidence view has the full investigation.`,
        activeView: "evidence",
      });
    },

    retryLayout() {
      if (state.investigation === null) return;
      commitWithLayoutRequest({});
    },

    rendererStatus(status) {
      set({ renderer: status });
    },

    closePanel() {
      set({ panel: { kind: "none" } });
    },

    stepAction(id, action) {
      const steps = state.steps;
      if (steps === null || action === "do") return;
      // A compare handoff registered after the manor opened adds its step on first use.
      const list = id === "compare" && !steps.steps.some((s) => s.id === "compare") ? [...steps.steps, { id, status: "todo" as const }] : steps.steps;
      set({
        steps: {
          ...steps,
          steps: list.map((s) => {
            if (s.id !== id) return s;
            if (action === "done") return { ...s, status: "done" as const };
            return s.status === "done" ? s : { ...s, status: "skipped" as const };
          }),
        },
      });
    },

    closeSteps() {
      if (state.steps !== null) set({ steps: { ...state.steps, dismissed: true } });
    },

    openSteps() {
      if (state.steps !== null) set({ steps: { ...state.steps, dismissed: false } });
    },

    setLegendOpen(open) {
      prefs.write({ ...prefs.read(), legendOpen: open });
      set({ legendOpen: open });
    },

    setMotion(motion) {
      prefs.write({ ...prefs.read(), motion });
      set({ motion });
    },
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    actions,
  };
}
