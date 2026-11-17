import { useEffect } from "react";
import { analysisApi, gateAnalysisApi } from "../features/investigation/analysisApi";
import { createLayoutClient, type LayoutWorkerLike } from "../features/investigation/layoutClient";
import { createPrefsStore } from "../features/investigation/prefs";
import { registry as defaultRegistry, type Registry } from "../features/investigation/registry";
import { createInvestigationStore, type InvestigationStore } from "../features/investigation/store";
import { openSample, type SampleId } from "../features/samples/loadSample";
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
  if (DEVHOOK_ENABLED) installDevHook(store, registry);
  return { store, registry, analysisClient, base: import.meta.env.BASE_URL };
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
  const { store, registry } = services;
  const state = useViewState(store);
  return (
    <div className="investigation">
      <Toolbar store={store} registry={registry} search={<Search store={store} />} />
      <div className="workspace">
        <section id="view-panel" role="tabpanel" aria-labelledby={`tab-${state.activeView}`} className="view">
          <MapView store={store} createScene={services.createScene ?? createScene} />
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