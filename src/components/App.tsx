import { useEffect, useMemo } from "react";
import { DEFAULT_ANALYSIS_OPTIONS } from "../contracts/options";
import type { Investigation } from "../contracts/types";
import { validateInvestigation } from "../contracts/validate";
import { place } from "../features/compare/placement";
import { registerCompare } from "../features/compare/register";
import { createCompareStore, type CompareStore } from "../features/compare/store";
import { styleOf } from "../features/compare/style";
import { analysisApi, gateAnalysisApi } from "../features/investigation/analysisApi";
import { createLayoutClient, type LayoutWorkerLike } from "../features/investigation/layoutClient";
import { createPrefsStore } from "../features/investigation/prefs";
import { registry as defaultRegistry, type Registry } from "../features/investigation/registry";
import { createInvestigationStore, type InvestigationStore } from "../features/investigation/store";
import { registerLiveSnapshot } from "../features/liveSnapshot";
import { loadSample, openSample, type SampleId } from "../features/samples/loadSample";
import { createScene } from "../scene/adapter";
import { createAnalysisClient, type AnalysisClient, type WorkerLike } from "../workers/client";
import { DEVHOOK_ENABLED, devState, forcedFailureGate, installDevHook } from "./devHook";
import { DemoSteps } from "./DemoSteps";
import { ErrorBoundary } from "./ErrorBoundary";
import { EvidenceView } from "./EvidenceView";
import { Inspector } from "./Inspector";
import { Legend } from "./Legend";
import { LoopsPanel } from "./LoopsPanel";
import { Landing } from "./Landing";
import { MapView } from "./MapView";
import { Search } from "./Search";
import { StatusRegion } from "./StatusRegion";
import { Toolbar } from "./Toolbar";
import { useReducedMotion } from "./useReducedMotion";
import { useViewState } from "./useStore";
import { WhoImportsPanel } from "./WhoImportsPanel";

export interface AppServices {
  store: InvestigationStore;
  registry: Registry;
  analysisClient: Pick<AnalysisClient, "analyze">;
  base: string;
  /** The scene factory; tests inject a fake. */
  createScene?: typeof createScene;
  /** The comparison store (snapshot-comparison, gate G2); absent in tests that do not need it. */
  compareStore?: CompareStore;
}

/**
 * The comparison feature at app start (snapshot-comparison, gate G2): its store over the app's store, analysis
 * client and sample loader, registered through the registry (control, `compare` handoff, legend entries).
 */
export function createCompareServices(deps: {
  store: InvestigationStore;
  registry: Registry;
  analysisClient: Pick<AnalysisClient, "analyze">;
  base: string;
  loadSample?: typeof loadSample;
  sha256Hex?: (text: string) => Promise<string>;
}): CompareStore {
  const compareStore = createCompareStore({
    store: deps.store,
    analysisApi,
    analysisClient: deps.analysisClient,
    loadSample: deps.loadSample ?? ((id, base) => loadSample(id, base)),
    base: deps.base,
    place,
    ...(deps.sha256Hex === undefined ? {} : { sha256Hex: deps.sha256Hex }),
  });
  registerCompare(deps.registry, compareStore);
  return compareStore;
}

/** `compareStore` and `compareWith` on `window.__hauntmap` (development builds only). */
function installCompareHook(store: InvestigationStore, registry: Registry, compareStore: CompareStore): void {
  const hook = window.__hauntmap as (Record<string, unknown> & object) | undefined;
  if (hook === undefined) return;
  hook["compareStore"] = compareStore;
  hook["compareWith"] = (after: Investigation, layoutKey?: string | null): Promise<void> => {
    const handoff = registry.getHandoff("compare") as ((args: { before: Investigation; after: Investigation; layoutKey: string | null }) => Promise<void>) | null;
    const state = store.getState();
    if (handoff === null || state.investigation === null) return Promise.reject(new Error("No comparison is possible: no handoff or no open investigation."));
    return handoff({ before: state.investigation, after, layoutKey: layoutKey ?? state.layout?.layoutKey ?? null });
  };
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The real services: workers for analysis and layout, localStorage for the preferences, the one registry. */
export function createServices(): AppServices {
  const registry = defaultRegistry;
  const analysisClient = createAnalysisClient(
    () => new Worker(new URL("../workers/analysis.worker.ts", import.meta.url), { type: "module" }) as unknown as WorkerLike,
  );
  const layoutClient = createLayoutClient(
    () => new Worker(new URL("../workers/layout.worker.ts", import.meta.url), { type: "module" }) as unknown as LayoutWorkerLike,
  );
  const store = createInvestigationStore({
    analysisApi: DEVHOOK_ENABLED ? gateAnalysisApi(analysisApi, forcedFailureGate) : analysisApi,
    layoutClient,
    prefs: createPrefsStore(safeStorage()),
    compareAvailable: () => registry.getHandoff("compare") !== null,
  });
  const base = import.meta.env.BASE_URL;
  const compareStore = createCompareServices({ store, registry, analysisClient, base });
  // kiro-integration task 10: the `Open live snapshot` control (one call, ownership exception).
  registerLiveSnapshot({
    store,
    registry,
    base,
    loadSample: (id, root) => loadSample(id, root),
    analysisClient,
    defaults: DEFAULT_ANALYSIS_OPTIONS,
    validate: validateInvestigation,
  });
  if (DEVHOOK_ENABLED) {
    installDevHook(store, registry);
    installCompareHook(store, registry, compareStore);
  }
  return { store, registry, analysisClient, base, compareStore };
}

/** `data-motion` on the root element is what the CSS reduced-motion rules follow. */
function useMotionAttribute(store: InvestigationStore): void {
  const reduced = useReducedMotion(useViewState(store).motion);
  useEffect(() => {
    document.documentElement.dataset["motion"] = reduced ? "reduce" : "allow";
  }, [reduced]);
}

function InvestigationScreen({ services }: { services: AppServices }) {
  // The flag stays set until the error boundary has caught the error: React renders once more after a throw, and that render must fail too.
  if (DEVHOOK_ENABLED && devState.crashNext) {
    throw new Error("forced render error");
  }
  const { store, registry, compareStore } = services;
  const state = useViewState(store);
  const comparison = useMemo(
    () => (compareStore === undefined ? undefined : { get: () => styleOf(compareStore.getState()), subscribe: compareStore.subscribe }),
    [compareStore],
  );
  return (
    <div className="investigation">
      <Toolbar store={store} registry={registry} search={<Search store={store} />} />
      <div className="workspace">
        <section id="view-panel" role="tabpanel" aria-labelledby={`tab-${state.activeView}`} className="view">
          <MapView store={store} createScene={services.createScene ?? createScene} comparison={comparison} />
          <LoopsPanel store={store} />
          <WhoImportsPanel store={store} />
          <Legend store={store} registry={registry} />
          {state.activeView === "evidence" ? (
            <div className="evidence-area">
              <EvidenceView store={store} />
            </div>
          ) : null}
        </section>
        <div className="side-column">
          <DemoSteps store={store} registry={registry} />
          <Inspector store={store} />
        </div>
      </div>
    </div>
  );
}

export function App({ services }: { services: AppServices }) {
  const { store } = services;
  const state = useViewState(store);
  useMotionAttribute(store);
  const onSample = (id: SampleId): void => {
    void openSample(id, { base: services.base, analysisClient: services.analysisClient, store });
  };
  return (
    <>
      {state.screen === "landing" ? (
        <Landing onSample={onSample} />
      ) : (
        <ErrorBoundary>
          <InvestigationScreen services={services} />
        </ErrorBoundary>
      )}
      <StatusRegion store={store} />
    </>
  );
}