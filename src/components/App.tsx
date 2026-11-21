import { useEffect, useMemo, useSyncExternalStore } from "react";
import { DEFAULT_ANALYSIS_OPTIONS } from "../contracts/options";
import type { Investigation } from "../contracts/types";
import { validateInvestigation } from "../contracts/validate";
import { ComparisonDock } from "../features/compare/ComparisonDock";
import { place } from "../features/compare/placement";
import { registerCompare } from "../features/compare/register";
import { createCompareStore, type CompareStore } from "../features/compare/store";
import { styleOf } from "../features/compare/style";
import { analysisApi, gateAnalysisApi } from "../features/investigation/analysisApi";
import { createLayoutClient, type LayoutWorkerLike } from "../features/investigation/layoutClient";
import { createPrefsStore } from "../features/investigation/prefs";
import { registry as defaultRegistry, type Registry } from "../features/investigation/registry";
import { createInvestigationStore, type InvestigationStore } from "../features/investigation/store";
import { installIntakeHook } from "../features/import/devHook";
import { createIntake } from "../features/import/intake";
import { IntakeHost } from "../features/import/IntakeHost";
import { createSavedStore } from "../features/import/saved";
import type { ReadWorkerLike } from "../features/import/readFiles";
import type { IntakeService } from "../features/import/types";
import { registerLiveSnapshot } from "../features/liveSnapshot";
import { loadSample, openSample, type SampleId } from "../features/samples/loadSample";
import { createScene } from "../scene/adapter";
import { createAnalysisClient, type AnalysisClient, type WorkerLike } from "../workers/client";
import { DEVHOOK_ENABLED, devState, forcedFailureGate, installDevHook } from "./devHook";
import { Breadcrumb } from "./Breadcrumb";
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
  /** The intake service (`intake`, gate I2); absent in tests that do not need it, and then the landing screen offers no intake button. */
  intake?: IntakeService;
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
  /** Gate I2 of intake: the intake service, so that the panel can offer a folder or a repository as the newer snapshot. */
  intake?: IntakeService;
}): CompareStore {
  const compareStore = createCompareStore({
    store: deps.store,
    analysisApi,
    analysisClient: deps.analysisClient,
    loadSample: deps.loadSample ?? ((id, base) => loadSample(id, base)),
    base: deps.base,
    place,
    ...(deps.intake === undefined ? {} : { intake: deps.intake }),
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
  // intake tasks 6, 7 and 11 (gate I2): the local route, saved investigations and the GitHub route.
  const intake = createIntake({
    store,
    analysisClient,
    defaults: DEFAULT_ANALYSIS_OPTIONS,
    validate: validateInvestigation,
    saved: createSavedStore(globalThis.indexedDB),
    createReadWorker: () => new Worker(new URL("../features/import/readFiles.worker.ts", import.meta.url), { type: "module" }) as unknown as ReadWorkerLike,
    github: { fetchImpl: (input, init) => fetch(input, init) },
  });
  // intake task 12 (gates I2, I4): the comparison panel gets the intake service for the newer snapshot.
  const compareStore = createCompareServices({ store, registry, analysisClient, base, intake });
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
    installIntakeHook(intake);
  }
  return { store, registry, analysisClient, base, compareStore, intake };
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
  const comparing = useSyncExternalStore(
    compareStore?.subscribe ?? noopSubscribe,
    () => compareStore?.getState().status === "active",
  );
  return (
    <div
      className="investigation"
      data-view={state.activeView}
      data-selection={state.selection.kind === "none" ? "off" : "on"}
      data-comparing={comparing ? "" : undefined}
    >
      <Toolbar store={store} registry={registry} search={<Search store={store} />} trailing={<Breadcrumb store={store} />} />
      <section id="view-panel" role="tabpanel" aria-labelledby={`tab-${state.activeView}`} className="view">
        <MapView store={store} createScene={services.createScene ?? createScene} comparison={comparison} />
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
      <div className="dock">
        <div className="dock-left">
          <ComparisonDock />
          {!comparing && state.panel.kind === "none" ? <p className="dock-hint">{DOCK_HINT}</p> : null}
          <LoopsPanel store={store} />
          <WhoImportsPanel store={store} />
        </div>
        <Legend store={store} registry={registry} />
      </div>
    </div>
  );
}

/** The words in the place of the loops list while no panel is open there (blind test fixes of 20 November 2026). */
export const DOCK_HINT = "Press Dependency loops to list the loops of this map.";

const noopSubscribe = (): (() => void) => () => undefined;
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
        <Landing
          onSample={onSample}
          intakeKinds={services.intake?.kinds ?? []}
          onIntake={(kind) => {
            void services.intake?.open({ purpose: "open", kind });
          }}
        />
      ) : (
        <ErrorBoundary>
          <InvestigationScreen services={services} />
        </ErrorBoundary>
      )}
      <StatusRegion store={store} />
      {services.intake === undefined ? null : <IntakeHost service={services.intake} />}
    </>
  );
}