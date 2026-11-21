import type { Investigation, SourceFile } from "../../contracts/types";
import { PRESERVED } from "../import/messages";
import { openOptions } from "../import/openOptions";
import { capMessage, classify } from "../import/review";
import type { IntakeDeps, IntakePurpose, IntakeResult } from "../import/types";
import { fetchFiles, listRepository, resolveVersion, type FetchResult, type ListingEntry } from "./jsdelivr";
import { analyzeFailedGh, fetchFailed, listFailed, loadCancelled, loaded, loadingStarted, TYPE_REF } from "./messages";
import { parseGithubUrl } from "./url";

// The GitHub state machine (design.md, The GitHub flow): url, resolving, listing, classification, fetching, analyzing, done.
// It holds no React. The dialog passes a `GithubUi` and one AbortController for the whole run; aborting the controller is
// the cancel. Every failure keeps the investigation store untouched except for `setStatus` (3.3, I4).

/** The most files the GitHub route analyzes (7.5). The plan's number; the local route's cap is in the analysis options. */
export const GITHUB_MAX_FILES = 400;

export type GithubState = "url" | "resolving" | "listing" | "fetching" | "analyzing";

export interface GithubUi {
  /** The text of `Repository URL`. */
  readonly url: string;
  /** The text of `Branch or tag`, or null while that field is not shown. Blank text counts as no ref. */
  readonly refField: string | null;
  /** One per `Load`. `abort()` is Cancel; the machine aborts it too when a file fails, so the dialog makes a new one for the next `Load`. */
  readonly controller: AbortController;
  setState(state: GithubState): void;
  setProgress(done: number, total: number): void;
  /** Shows `Branch or tag`, filled with `value`. */
  showRefField(value: string): void;
  /** The text the dialog shows beside the fields for an input problem; null clears it. */
  setNotice(message: string | null): void;
  focus(target: "url" | "ref" | "load"): void;
}

/** `input` means nothing was attempted and the user must change a field; the dialog stays open in both modes. */
export type GithubOutcome = IntakeResult | { ok: false; reason: "input"; message: string };

const BRANCHES_WITHOUT_TAGS = ["main", "master"] as const;

const nameOf = (error: unknown): string => {
  const name = (error as { name?: unknown } | null)?.name;
  return typeof name === "string" ? name : "";
};

export async function runGithubIntake(deps: IntakeDeps & { github: { fetchImpl: typeof fetch } }, purpose: IntakePurpose, ui: GithubUi): Promise<GithubOutcome> {
  const { store, analysisClient, defaults } = deps;
  const fetchImpl = deps.github.fetchImpl;
  const signal = ui.controller.signal;

  const cancel = (): GithubOutcome => {
    const open = store.getState().investigation?.sourceLabel ?? null;
    store.actions.setStatus(loadCancelled(open));
    ui.setState("url");
    ui.focus("load");
    return { ok: false, reason: "cancelled" };
  };
  /** A failure. In `open` mode the status gets the preservation sentence; in `after` mode the bare message goes to the caller (9.2). */
  const fail = (message: string): GithubOutcome => {
    // In `open` mode the dialog stays, so the same sentence is shown inside it as well as in the status region (12.1).
    if (purpose === "open") {
      ui.setNotice(`${message} ${PRESERVED}`);
      store.actions.setStatus(`${message} ${PRESERVED}`);
    }
    ui.setState("url");
    ui.focus("load");
    return { ok: false, reason: "failed", message };
  };
  const input = (message: string, focus: "url" | "ref"): GithubOutcome => {
    ui.setNotice(message);
    if (purpose === "open") store.actions.setStatus(message);
    ui.setState("url");
    ui.focus(focus);
    return { ok: false, reason: "input", message };
  };

  ui.setNotice(null);
  const parsed = parseGithubUrl(ui.url);
  if (!parsed.ok) {
    if (parsed.showRefField) ui.showRefField("");
    return input(parsed.message, parsed.showRefField ? "ref" : "url");
  }
  const { owner, repo } = parsed;
  const typed = ui.refField?.trim() ?? "";
  let ref: string | null = typed !== "" ? typed : parsed.ref;
  let entries: ListingEntry[] | null = null;

  if (ref === null) {
    ui.setState("resolving");
    const resolved = await resolveVersion(owner, repo, fetchImpl, signal);
    if (signal.aborted) return cancel();
    // No ref exists yet to name in the message; jsDelivr calls this one `latest`.
    if (!resolved.ok) return fail(listFailed(owner, repo, "latest", resolved.status));
    if (resolved.version !== null) {
      ref = resolved.version;
    } else {
      // No tags: the newest tag is not there to load, so try the branches a repository usually has.
      ui.setState("listing");
      for (const branch of BRANCHES_WITHOUT_TAGS) {
        const listed = await listRepository(owner, repo, branch, fetchImpl, signal);
        if (signal.aborted) return cancel();
        if (listed.ok) {
          ref = branch;
          entries = listed.entries;
          break;
        }
        if (listed.status !== "404") return fail(listFailed(owner, repo, branch, listed.status));
      }
      if (ref === null) {
        ui.showRefField("main");
        return input(TYPE_REF, "ref");
      }
    }
  }

  if (entries === null) {
    ui.setState("listing");
    const listed = await listRepository(owner, repo, ref, fetchImpl, signal);
    if (signal.aborted) return cancel();
    if (!listed.ok) return fail(listFailed(owner, repo, ref, listed.status));
    entries = listed.entries;
  }

  const review = classify(`${owner}/${repo}@${ref}`, entries.map((entry) => ({ path: entry.path, size: entry.size })), defaults);
  const capped = capMessage(review, GITHUB_MAX_FILES, defaults.maxTotalBytes, "github");
  if (capped !== null) return fail(capped);

  store.actions.setStatus(loadingStarted(owner, repo, ref, review.included.length));
  ui.setState("fetching");
  ui.setProgress(0, review.included.length);
  let fetched: FetchResult;
  try {
    fetched = await fetchFiles(owner, repo, ref, review.included, fetchImpl, signal, (done, total) => ui.setProgress(done, total));
  } catch (error) {
    if (nameOf(error) === "AbortError" || signal.aborted) return cancel();
    throw error;
  }
  if (signal.aborted) return cancel();
  if (!fetched.ok) {
    // Stop the requests that are still in flight; nothing is kept.
    ui.controller.abort();
    return fail(fetchFailed(fetched.path, owner, repo, ref, fetched.status));
  }

  // A file over 1 MiB is never fetched; it goes to the analysis as an empty entry so that the diagnostic is the same as for a local folder (8.5).
  const sizes = new Map(entries.map((entry) => [entry.path, entry.size] as const));
  const oversized: SourceFile[] = review.skipped.filter((entry) => entry.reason === "oversized").map((entry) => ({ path: entry.path, text: "", bytes: sizes.get(entry.path) ?? 0 }));
  const files = [...fetched.files, ...oversized];
  ui.setState("analyzing");
  ui.setProgress(0, files.length);
  const stop = (): void => analysisClient.cancel();
  signal.addEventListener("abort", stop, { once: true });
  let investigation: Investigation;
  try {
    investigation = await analysisClient.analyze(
      { files, rootLabel: `gh:${owner}/${repo}@${ref}`, options: { ...defaults, preset: store.getState().preset, maxFiles: GITHUB_MAX_FILES } },
      (done, total) => ui.setProgress(done, total),
    );
  } catch (error) {
    if (nameOf(error) === "AnalysisCancelled" || signal.aborted) return cancel();
    return fail(analyzeFailedGh(error instanceof Error ? error.message : String(error)));
  } finally {
    signal.removeEventListener("abort", stop);
  }
  if (signal.aborted) return cancel();

  const sourceText = new Map(fetched.files.map((file) => [file.path, file.text] as const));
  const result: IntakeResult = { ok: true, investigation, sourceText, label: investigation.sourceLabel };
  if (purpose === "open") {
    store.actions.openInvestigation(investigation, sourceText, openOptions(investigation));
    const relations = new Set(investigation.imports.map((record) => record.relationId)).size;
    store.actions.setStatus(loaded(owner, repo, ref, fetched.files.length, investigation.modules.length, relations, investigation.diagnostics.length));
  }
  return result;
}
