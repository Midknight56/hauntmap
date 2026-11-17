import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_ANALYSIS_OPTIONS, analyze, selectSources } from "../../src/analysis";
import type { AnalysisOptions, Investigation, SourceFile } from "../../src/contracts/types";
import { analysisApi } from "../../src/features/investigation/analysisApi";
import type { LayoutClient } from "../../src/features/investigation/layoutClient";
import { createPrefsStore } from "../../src/features/investigation/prefs";
import { createRegistry, type Registry } from "../../src/features/investigation/registry";
import { createInvestigationStore, type InvestigationStore } from "../../src/features/investigation/store";
import { loadSample as realLoadSample, type SampleId, type SampleResult } from "../../src/features/samples/loadSample";
import { layoutInvestigation } from "../../src/scene/layout/engine";
import type { LayoutRequest, LayoutResult } from "../../src/scene/layout/types";
import { AnalysisCancelled, AnalysisFailed, type AnalysisClient } from "../../src/workers/client";
import { REPO, nodeSha256 } from "./loadFolder";

// The compare store is tested against the real investigation store of `investigation-ui`, with these
// stand-ins at its edges: a layout client that records every request, an analysis client that runs the
// real analysis in-process (or fails on demand) and a `loadSample` over a fake `fetch` that reads the
// committed sample files. There is no fake fleet store.

export interface RecordedLayout {
  payload: LayoutRequest;
  revision: number;
  resolve(result: LayoutResult): void;
  reject(error: Error): void;
}

export interface RecordingLayoutClient extends LayoutClient {
  /** Every request, in order. */
  readonly requests: RecordedLayout[];
  cancelCount: number;
  /** `auto` answers with the real dagre layout; `manual` leaves each request pending until the test settles it. */
  mode: "auto" | "manual";
  /** The next request in `auto` mode fails with this message. */
  failNext(message: string): void;
}

export function createRecordingLayoutClient(mode: "auto" | "manual" = "auto"): RecordingLayoutClient {
  let failure: string | null = null;
  const client: RecordingLayoutClient = {
    requests: [],
    cancelCount: 0,
    mode,
    lastResult: null,
    failNext(message) {
      failure = message;
    },
    request(payload, revision) {
      return new Promise<LayoutResult>((resolve, reject) => {
        const entry: RecordedLayout = { payload, revision, resolve, reject };
        client.requests.push(entry);
        if (client.mode === "manual") return;
        if (failure !== null) {
          const message = failure;
          failure = null;
          reject(new Error(message));
          return;
        }
        layoutInvestigation(payload).then(resolve, reject);
      });
    },
    cancel() {
      client.cancelCount++;
    },
  };
  return client;
}

export interface AnalyzeCall {
  rootLabel: string;
  options: AnalysisOptions;
  fileCount: number;
}

export interface FakeAnalysisClient extends Pick<AnalysisClient, "analyze"> {
  readonly calls: AnalyzeCall[];
  /** The next call rejects with this error. */
  rejectNext(error: Error): void;
}

export function createFakeAnalysisClient(): FakeAnalysisClient {
  let rejection: Error | null = null;
  const calls: AnalyzeCall[] = [];
  return {
    calls,
    rejectNext(error) {
      rejection = error;
    },
    async analyze(request: { files: SourceFile[]; rootLabel: string; options: AnalysisOptions }, onProgress) {
      calls.push({ rootLabel: request.rootLabel, options: request.options, fileCount: request.files.length });
      if (rejection !== null) {
        const error = rejection;
        rejection = null;
        throw error;
      }
      const selected = selectSources(request.files, request.rootLabel, request.options);
      if (!selected.ok) throw new AnalysisFailed("file cap exceeded", selected.diagnostics);
      return analyze(selected.sourceSet, request.options, nodeSha256, onProgress, selected.diagnostics);
    },
  };
}

export { AnalysisCancelled, AnalysisFailed };

export interface FakeFetch {
  fetch: typeof fetch;
  /** Every requested URL, in order. */
  readonly urls: string[];
  /** Answer the next request for a sample with this HTTP status instead of its file. */
  failWith(id: SampleId, status: number): void;
}

export function createFakeFetch(): FakeFetch {
  const urls: string[] = [];
  const failures = new Map<string, number>();
  const impl = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    urls.push(url);
    const match = /demo\/(manor\/before|manor\/after|annex)\/sources\.json$/.exec(url);
    if (match === null) return new Response("not found", { status: 404 });
    const id = match[1] as SampleId;
    const status = failures.get(id);
    if (status !== undefined) {
      failures.delete(id);
      return new Response("error", { status });
    }
    return new Response(readFileSync(join(REPO, "public", "demo", ...id.split("/"), "sources.json"), "utf8"), { status: 200 });
  };
  return {
    fetch: impl as typeof fetch,
    urls,
    failWith(id, status) {
      failures.set(id, status);
    },
  };
}

export interface Harness {
  store: InvestigationStore;
  registry: Registry;
  layoutClient: RecordingLayoutClient;
  analysisClient: FakeAnalysisClient;
  fetcher: FakeFetch;
  base: string;
  /** `loadSample` over the fake fetch, with the signature the compare store takes. */
  loadSample: (id: SampleId, base: string) => Promise<SampleResult>;
}

export function createHarness(opts: { layout?: "auto" | "manual" } = {}): Harness {
  const layoutClient = createRecordingLayoutClient(opts.layout ?? "auto");
  const fetcher = createFakeFetch();
  const registry = createRegistry();
  const store = createInvestigationStore({
    analysisApi,
    layoutClient,
    prefs: createPrefsStore(null),
    compareAvailable: () => registry.getHandoff("compare") !== null,
  });
  return {
    store,
    registry,
    layoutClient,
    analysisClient: createFakeAnalysisClient(),
    fetcher,
    base: "/",
    loadSample: (id, base) => realLoadSample(id, base, fetcher.fetch),
  };
}

/** Resolve when the store's layout is not pending (idle or failed). */
export function layoutSettled(store: InvestigationStore): Promise<void> {
  if (store.getState().layoutStatus !== "pending") return Promise.resolve();
  return new Promise((resolve) => {
    const off = store.subscribe(() => {
      if (store.getState().layoutStatus !== "pending") {
        off();
        resolve();
      }
    });
  });
}

/** Open `manor/before` as the first screen of the manor sample does (`src/orders` expanded) and wait for its layout. */
export async function openManorBefore(h: Harness): Promise<Investigation> {
  const loaded = await h.loadSample("manor/before", h.base);
  if (!loaded.ok) throw new Error(loaded.message);
  const investigation = await h.analysisClient.analyze({
    files: loaded.sourceSet.files,
    rootLabel: loaded.sourceSet.rootLabel,
    options: DEFAULT_ANALYSIS_OPTIONS,
  });
  const sourceText = new Map(loaded.sourceSet.files.map((f) => [f.path, f.text] as const));
  h.store.actions.openInvestigation(investigation, sourceText, { expandWing: "src/orders", demo: false });
  await layoutSettled(h.store);
  return investigation;
}

/** Let promise continuations and zero-delay timers run. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
