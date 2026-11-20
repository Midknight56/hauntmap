import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_ANALYSIS_OPTIONS } from "../../src/contracts/options";
import type { Investigation } from "../../src/contracts/types";
import type { GithubState, GithubUi } from "../../src/features/github/githubIntake";
import type { IntakeAnalysisClient, IntakeDeps, IntakeStore } from "../../src/features/import/types";
import { validateInvestigation } from "../../src/contracts/validate";
import { runRequest } from "../../src/workers/analysis.worker";
import type { WorkerReply } from "../../src/workers/client";
import { fileUrl, listingUrl } from "../../src/features/github/jsdelivr";
import { createInlineReadWorkers, type FakeFetch, type FakeRoute } from "./fakes";
import { liveInvestigation } from "./graphHelpers";

// Fakes for the GitHub machine tests (node safe: no DOM, no React): a store that records what it is told, a fake
// GithubUi, an analysis client that runs the real analysis in this thread, and one the test settles by hand.

export interface RecordingStore extends IntakeStore {
  statuses: string[];
  opened: { investigation: Investigation; source: ReadonlyMap<string, string> | null; demo: boolean }[];
  calls: string[];
  /** The six fields of 3.3, which no failure may change. */
  snapshot(): string;
}

export function recordingStore(current: Investigation | null = null): RecordingStore {
  const state = { investigation: current, preset: "static-value" as const };
  const store: RecordingStore = {
    statuses: [],
    opened: [],
    calls: [],
    getState: () => state,
    actions: {
      openInvestigation(investigation, source, opts) {
        store.calls.push("openInvestigation");
        store.opened.push({ investigation, source, demo: opts.demo });
        state.investigation = investigation;
      },
      setStatus(message) {
        store.calls.push("setStatus");
        store.statuses.push(message);
      },
    },
    snapshot: () => JSON.stringify({ investigation: state.investigation?.sourceLabel ?? null, preset: state.preset }),
  };
  return store;
}

export interface RecordingUi extends GithubUi {
  states: GithubState[];
  /** Progress while files are fetched. */
  progress: [number, number][];
  /** Progress while the analysis runs. */
  analysisProgress: [number, number][];
  notices: (string | null)[];
  shownRefField: string[];
  focused: string[];
  url: string;
  refField: string | null;
}

export function recordingUi(url: string, refField: string | null = null): RecordingUi {
  const ui: RecordingUi = {
    url,
    refField,
    controller: new AbortController(),
    states: [],
    progress: [],
    analysisProgress: [],
    notices: [],
    shownRefField: [],
    focused: [],
    setState: (state) => void ui.states.push(state),
    setProgress: (done, total) => void (ui.states.at(-1) === "analyzing" ? ui.analysisProgress : ui.progress).push([done, total]),
    showRefField: (value) => {
      ui.shownRefField.push(value);
      ui.refField = value;
    },
    setNotice: (message) => void ui.notices.push(message),
    focus: (target) => void ui.focused.push(target),
  };
  return ui;
}

/** Runs the analysis worker's own entry in this thread, as the parity test does. */
export function inlineAnalysisClient(): IntakeAnalysisClient & { requests: Parameters<IntakeAnalysisClient["analyze"]>[0][] } {
  const requests: Parameters<IntakeAnalysisClient["analyze"]>[0][] = [];
  return {
    requests,
    async analyze(request, onProgress) {
      requests.push(request);
      const replies: WorkerReply[] = [];
      await runRequest({ requestId: "gh", revision: 1, kind: "analyze", payload: request }, (reply) => replies.push(reply));
      const failed = replies.find((reply) => reply.kind === "error");
      if (failed !== undefined) {
        const error = new Error("analysis failed");
        error.name = "AnalysisFailed";
        throw error;
      }
      onProgress?.(request.files.length, request.files.length);
      const result = replies.find((reply) => reply.kind === "result");
      if (result?.kind !== "result") throw new Error("no result");
      return result.investigation;
    },
    cancel() {},
  };
}

/** An analysis client that answers at once with the live snapshot, for tests that only look at requests. */
export function instantAnalysisClient(): IntakeAnalysisClient & { requests: Parameters<IntakeAnalysisClient["analyze"]>[0][] } {
  const requests: Parameters<IntakeAnalysisClient["analyze"]>[0][] = [];
  return {
    requests,
    analyze: async (request) => {
      requests.push(request);
      return liveInvestigation();
    },
    cancel() {},
  };
}

export interface PendingAnalysis extends IntakeAnalysisClient {
  calls: { request: Parameters<IntakeAnalysisClient["analyze"]>[0]; resolve(value: Investigation): void; reject(error: Error): void }[];
  cancelCount: number;
}

/** An analysis client whose call stays pending until the test settles it; `cancel()` rejects like the real one. */
export function pendingAnalysisClient(): PendingAnalysis {
  const client: PendingAnalysis = {
    calls: [],
    cancelCount: 0,
    analyze(request) {
      return new Promise<Investigation>((resolve, reject) => {
        client.calls.push({ request, resolve, reject });
      });
    },
    cancel() {
      client.cancelCount += 1;
      const error = new Error("The analysis was cancelled.");
      error.name = "AnalysisCancelled";
      client.calls.at(-1)?.reject(error);
    },
  };
  return client;
}

export function githubDeps(store: IntakeStore, analysisClient: IntakeAnalysisClient, fake: FakeFetch): IntakeDeps & { github: { fetchImpl: typeof fetch } } {
  return {
    store,
    analysisClient,
    defaults: DEFAULT_ANALYSIS_OPTIONS,
    validate: validateInvestigation,
    saved: null,
    createReadWorker: createInlineReadWorkers().create,
    github: { fetchImpl: fake.fetch },
  };
}

const GH_FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "gh");

/** The listing of `listing-small.json` and the bodies of `gh/files/src/*` for `owner/repo@ref`: the three included files of the folder fixture. */
export function smallRepoRoutes(owner: string, repo: string, ref: string): Record<string, FakeRoute> {
  const routes: Record<string, FakeRoute> = {
    [listingUrl(owner, repo, ref)]: { body: JSON.parse(readFileSync(join(GH_FIXTURES, "listing-small.json"), "utf8")) as object },
  };
  for (const path of ["src/a.ts", "src/b.ts", "src/c.tsx"]) routes[fileUrl(owner, repo, ref, path)] = { body: readFileSync(join(GH_FIXTURES, "files", path), "utf8") };
  return routes;
}