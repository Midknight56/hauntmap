import type { AnalysisOptions, Investigation, SourceFile, SourceSet } from "../../contracts/types";
import type { ValidationResult } from "../../contracts/validate";
import type { ReactElement } from "react";
import { fetchLive } from "./fetchLive";
import { MSG_MISSING, MSG_NO_COMPARE, msgFetchFailed, msgLoaded, msgMalformed, msgSampleAnalyzeFailed } from "./messages";

// The registry and the store are reached through these structural types, so that nothing here imports
// src/components or src/features/investigation (the real store and registry satisfy them).

export interface LiveStore {
  getState(): { investigation: Investigation | null; layout: { layoutKey: string } | null };
  actions: {
    setStatus(message: string): void;
    openInvestigation(investigation: Investigation, sourceText: ReadonlyMap<string, string>, options: { demo: boolean }): void;
  };
}

export interface LiveRegistry {
  getHandoff(name: "compare"): ((...args: never[]) => unknown) | null;
  registerControl(slot: "live-snapshot", component: (props: { store: LiveStore }) => ReactElement | null): void;
}

export interface LiveDeps {
  store: LiveStore;
  registry: LiveRegistry;
  /** import.meta.env.BASE_URL */
  base: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  loadSample: (id: "manor/before", base: string) => Promise<{ ok: true; sourceSet: SourceSet } | { ok: false; message: string }>;
  analysisClient: { analyze(request: { files: SourceFile[]; rootLabel: string; options: AnalysisOptions }): Promise<Investigation> };
  defaults: AnalysisOptions;
  validate: (value: unknown) => ValidationResult;
}

export type LiveOutcome = "missing" | "fetch-failed" | "malformed" | "no-compare" | "sample-failed" | "compare-failed" | "loaded";

type CompareHandoff = (args: { before: Investigation; after: Investigation; layoutKey: string | null }) => Promise<void>;

let pending: Promise<LiveOutcome> | null = null;

function messageOf(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}

async function run(deps: LiveDeps): Promise<LiveOutcome> {
  const { store } = deps;
  const fetched = await fetchLive(deps.base, deps.fetchImpl ?? ((input, init) => fetch(input, init)), deps.now ?? Date.now, deps.validate);
  if (fetched.kind === "missing") {
    store.actions.setStatus(MSG_MISSING);
    return "missing";
  }
  if (fetched.kind === "fetch-failed") {
    store.actions.setStatus(msgFetchFailed(fetched.reason));
    return "fetch-failed";
  }
  if (fetched.kind === "malformed") {
    store.actions.setStatus(msgMalformed(fetched.firstError));
    return "malformed";
  }

  if (store.getState().investigation === null) {
    const sample = await deps.loadSample("manor/before", deps.base);
    if (!sample.ok) {
      store.actions.setStatus(sample.message);
      return "sample-failed";
    }
    let investigation: Investigation;
    try {
      investigation = await deps.analysisClient.analyze({
        files: sample.sourceSet.files,
        rootLabel: sample.sourceSet.rootLabel,
        options: { ...deps.defaults, preset: "static-value" },
      });
    } catch (thrown) {
      store.actions.setStatus(msgSampleAnalyzeFailed(messageOf(thrown)));
      return "sample-failed";
    }
    const sourceText = new Map(sample.sourceSet.files.map((file) => [file.path, file.text] as const));
    store.actions.openInvestigation(investigation, sourceText, { demo: false });
  }

  const handoff = deps.registry.getHandoff("compare") as CompareHandoff | null;
  if (handoff === null) {
    store.actions.setStatus(MSG_NO_COMPARE);
    return "no-compare";
  }
  const state = store.getState();
  const before = state.investigation;
  if (before === null) return "compare-failed";
  try {
    await handoff({ before, after: fetched.investigation, layoutKey: state.layout?.layoutKey ?? null });
  } catch {
    // The handoff wrote its own message; no second one is written.
    return "compare-failed";
  }
  store.actions.setStatus(msgLoaded(fetched.investigation.sourceLabel, fetched.investigation.modules.length, before.sourceLabel));
  return "loaded";
}

/** One run at a time: a call made while a run is pending returns that run. It never rejects. */
export function openLiveSnapshot(deps: LiveDeps): Promise<LiveOutcome> {
  if (pending !== null) return pending;
  const current = run(deps).finally(() => {
    pending = null;
  });
  pending = current;
  return current;
}