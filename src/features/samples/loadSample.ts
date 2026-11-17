import { DEFAULT_ANALYSIS_OPTIONS } from "../../contracts/options";
import type { SourceFile, SourceSet } from "../../contracts/types";
import type { AnalysisClient } from "../../workers/client";
import type { InvestigationStore } from "../investigation/store";

export type SampleId = "manor/before" | "manor/after" | "annex";

export type SampleResult = { ok: true; sourceSet: SourceSet } | { ok: false; message: string };

const labelOf = (id: SampleId): string => (id === "annex" ? "annex" : "manor");

function failure(id: SampleId, detail: string): { ok: false; message: string } {
  return { ok: false, message: `The ${labelOf(id)} sample could not be loaded (${detail}). Reload the page.` };
}

function isFile(value: unknown): value is { path: string; text: string } {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record["path"] === "string" && typeof record["text"] === "string";
}

/**
 * GET `<base>demo/<id>/sources.json`, a body `{ files: [{ path, text }] }` as written by
 * `pnpm pack:samples`, and build the `SourceSet` (`rootLabel` is the ID, `bytes` the UTF-8 length).
 */
export async function loadSample(id: SampleId, base: string, fetchImpl: typeof fetch = (input, init) => fetch(input, init)): Promise<SampleResult> {
  const prefix = base.endsWith("/") ? base : `${base}/`;
  let response: Response;
  try {
    response = await fetchImpl(`${prefix}demo/${id}/sources.json`);
  } catch (error) {
    return failure(id, error instanceof Error ? error.name : "network error");
  }
  if (response.status !== 200) return failure(id, String(response.status));
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return failure(id, "invalid sources.json");
  }
  const files = typeof body === "object" && body !== null ? (body as Record<string, unknown>)["files"] : undefined;
  if (!Array.isArray(files) || !files.every(isFile)) return failure(id, "invalid sources.json");
  const encoder = new TextEncoder();
  const list: SourceFile[] = files.map((f) => ({ path: f.path, text: f.text, bytes: encoder.encode(f.text).length }));
  return { ok: true, sourceSet: { rootLabel: id, files: list, skipped: [] } };
}

export interface OpenSampleDeps {
  base: string;
  fetchImpl?: typeof fetch;
  analysisClient: Pick<AnalysisClient, "analyze">;
  store: InvestigationStore;
}

/**
 * Load a sample, analyze it and open the investigation. A failure at either step writes its
 * message to the status region and leaves the landing screen as it is.
 */
export async function openSample(id: SampleId, deps: OpenSampleDeps): Promise<void> {
  const { store } = deps;
  const loaded = await loadSample(id, deps.base, deps.fetchImpl);
  if (!loaded.ok) {
    store.actions.setStatus(loaded.message);
    return;
  }
  let investigation;
  try {
    investigation = await deps.analysisClient.analyze({
      files: loaded.sourceSet.files,
      rootLabel: loaded.sourceSet.rootLabel,
      options: DEFAULT_ANALYSIS_OPTIONS,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    store.actions.setStatus(`The ${labelOf(id)} sample could not be analyzed (${message}). Reload the page.`);
    return;
  }
  const sourceText = new Map(loaded.sourceSet.files.map((f) => [f.path, f.text] as const));
  const demo = id === "manor/before";
  store.actions.openInvestigation(investigation, sourceText, demo ? { expandWing: "src/orders", demo } : { demo });
}