import { useId, useRef, useState, type ChangeEvent } from "react";
import type { Investigation, SourceFile } from "../../contracts/types";
import { DialogFrame } from "./DialogFrame";
import { hasDirectoryInput } from "./intake";
import {
  analyzeFailed,
  analyzing,
  BUTTON_ANALYZE,
  BUTTON_BACK,
  BUTTON_CANCEL,
  BUTTON_CLOSE,
  cancelled,
  CHOOSE_FOLDER,
  excludedDirsLine,
  extensionLine,
  folderLine,
  heading,
  IMPORT_GRAPH_HEADING,
  includedLine,
  includedListTitle,
  moreEntries,
  NO_DIRECTORY_INPUT,
  oversizedLine,
  PRESERVED,
  reading,
  readingStarted,
  REVIEW_SENTENCE,
  secretLine,
  summary,
  skippedEntry,
  skippedLine,
  skippedListTitle,
} from "./messages";
import type { ReadResult } from "./readFiles";
import { capMessage, classify, formatSize, reasonWords, stripRoot, type Candidate, type Review } from "./review";
import type { IntakePurpose, IntakeService } from "./types";

// The screens of the local route: choose, review, reading, analyzing and result.

/** Each list of the review shows this many entries, then how many more there are. */
const LIST_LIMIT = 200;

interface Selection {
  review: Review;
  /** The size of every chosen file by path, for the entries of files over 1 MiB (3.4). */
  sizes: Map<string, number>;
}
type Screen =
  | { name: "choose" }
  | ({ name: "review" } & Selection)
  | ({ name: "reading" | "analyzing"; done: number; total: number } & Selection)
  | { name: "result"; summary: string };

/** `Analyzed <folder>: ...` (3.5). Relations are counted by relation ID; a failed module is one with `parseStatus: "failed"`. */
export function summaryMessage(folder: string, investigation: Investigation, review: Review, binary: number): string {
  const relations = new Set(investigation.imports.map((record) => record.relationId)).size;
  const failed = investigation.modules.filter((module) => module.parseStatus === "failed").length;
  return summary(folder, investigation.modules.length, relations, investigation.diagnostics.length, review.skipped.length, binary, failed);
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The chosen files as candidates: paths relative to the folder, and the folder's name. No file is read. */
function candidatesOf(files: File[]): { folder: string; candidates: Candidate[] } {
  let folder = "";
  const candidates: Candidate[] = [];
  for (const file of files) {
    const stripped = stripRoot(file.webkitRelativePath !== "" ? file.webkitRelativePath : file.name);
    if (folder === "" && stripped.folder !== "") folder = stripped.folder;
    if (stripped.path !== "") candidates.push({ path: stripped.path, size: file.size, file });
  }
  return { folder: folder === "" ? "folder" : folder, candidates };
}

function FileList({ title, entries }: { title: string; entries: string[] }) {
  const headingId = useId();
  const more = entries.length - LIST_LIMIT;
  return (
    <div role="region" aria-label={title} tabIndex={0} className="intake-list">
      <h3 id={headingId} className="intake-subheading">
        {title}
      </h3>
      <ul aria-labelledby={headingId} className="intake-mono">
        {entries.slice(0, LIST_LIMIT).map((entry, index) => (
          <li key={index}>{entry}</li>
        ))}
        {more > 0 ? <li className="intake-muted">{moreEntries(more)}</li> : null}
      </ul>
    </div>
  );
}

export function LocalFolderDialog({ service, purpose }: { service: IntakeService; purpose: IntakePurpose }) {
  const { deps } = service;
  const [screen, setScreen] = useState<Screen>({ name: "choose" });
  const folderInputId = useId();
  const graphHeadingId = useId();
  const capId = useId();
  const doc = deps.doc ?? document;
  /** Each Analyze gets a number; Cancel moves it on, so that whatever a cancelled run still delivers is ignored. */
  const run = useRef(0);
  /** Set while a run is in the analysis step, so that Cancel knows which client to stop. */
  const stage = useRef<"reading" | "analyzing" | null>(null);

  const close = (): void => service.close({ ok: false, reason: "cancelled" });

  const onFolderChosen = (event: ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(event.currentTarget.files ?? []);
    if (files.length === 0) return;
    const { folder, candidates } = candidatesOf(files);
    setScreen({ name: "review", review: classify(folder, candidates, deps.defaults), sizes: new Map(candidates.map((candidate) => [candidate.path, candidate.size])) });
  };

  const openLabel = (): string | null => deps.store.getState().investigation?.sourceLabel ?? null;

  /** Back to the review after a cancel or a failure; the store's six fields are not touched (3.3). */
  const backToReview = (selection: Selection): void => {
    stage.current = null;
    setScreen({ name: "review", ...selection });
  };

  const fail = (error: unknown, selection: Selection): void => {
    const message = analyzeFailed(errorMessage(error));
    if (purpose === "after") {
      service.close({ ok: false, reason: "failed", message });
      return;
    }
    deps.store.actions.setStatus(`${message} ${PRESERVED}`);
    backToReview(selection);
  };

  const analyze = async (selection: Selection): Promise<void> => {
    const { review, sizes } = selection;
    const { store, analysisClient, defaults } = deps;
    run.current += 1;
    const mine = run.current;
    const current = (): boolean => run.current === mine;
    store.actions.setStatus(readingStarted(review.included.length, review.folder));
    stage.current = "reading";
    setScreen({ name: "reading", ...selection, done: 0, total: review.included.length });

    let read: ReadResult;
    try {
      read = await service.readClient.read(
        review.included.map((candidate) => ({ path: candidate.path, file: candidate.file as File })),
        (done, total) => {
          if (current()) setScreen((s) => (s.name === "reading" ? { ...s, done, total } : s));
        },
        service.getState().readDelayMs,
      );
    } catch (error) {
      if (current()) fail(error, selection);
      return;
    }
    if (!current()) return;

    // A file over 1 MiB goes in as an empty entry, so that the investigation carries the same `oversized` diagnostic as the command line tool.
    const oversized: SourceFile[] = review.skipped.filter((entry) => entry.reason === "oversized").map((entry) => ({ path: entry.path, text: "", bytes: sizes.get(entry.path) ?? 0 }));
    const files = [...read.files, ...oversized];
    stage.current = "analyzing";
    setScreen({ name: "analyzing", ...selection, done: 0, total: files.length });
    let investigation: Investigation;
    try {
      investigation = await analysisClient.analyze({ files, rootLabel: `local:${review.folder}`, options: { ...defaults, preset: store.getState().preset } }, (done, total) => {
        if (current()) setScreen((s) => (s.name === "analyzing" ? { ...s, done, total } : s));
      });
    } catch (error) {
      if (current()) fail(error, selection);
      return;
    }
    if (!current()) return;

    stage.current = null;
    const sourceText = new Map(read.files.map((file) => [file.path, file.text] as const));
    const result = { ok: true as const, investigation, sourceText, label: investigation.sourceLabel };
    if (purpose === "after") {
      service.close(result);
      return;
    }
    const text = summaryMessage(review.folder, investigation, review, read.binary.length);
    store.actions.openInvestigation(investigation, sourceText, { demo: false });
    store.actions.setStatus(text);
    service.resolve(result);
    setScreen({ name: "result", summary: text });
  };

  const cancelWork = (selection: Selection): void => {
    const was = stage.current;
    run.current += 1;
    if (was === "reading") service.readClient.cancel();
    else if (was === "analyzing") deps.analysisClient.cancel();
    deps.store.actions.setStatus(cancelled(openLabel()));
    backToReview(selection);
  };

  let body;
  if (screen.name === "choose") {
    body = (
      <>
        {hasDirectoryInput(doc) ? (
          <div className="intake-field">
            <label htmlFor={folderInputId}>{CHOOSE_FOLDER}</label>
            <input id={folderInputId} type="file" multiple {...{ webkitdirectory: "" }} onChange={onFolderChosen} />
          </div>
        ) : (
          <p>{NO_DIRECTORY_INPUT}</p>
        )}
        <section aria-labelledby={graphHeadingId} className="intake-section">
          <h3 id={graphHeadingId} className="intake-subheading">
            {IMPORT_GRAPH_HEADING}
          </h3>
        </section>
        <div className="intake-actions">
          <button type="button" onClick={close}>
            {BUTTON_CLOSE}
          </button>
        </div>
      </>
    );
  } else if (screen.name === "reading" || screen.name === "analyzing") {
    const selection: Selection = { review: screen.review, sizes: screen.sizes };
    body = (
      <>
        <p className="intake-progress">{screen.name === "reading" ? reading(screen.done, screen.total) : analyzing(screen.done, screen.total)}</p>
        <div className="intake-actions">
          <button type="button" onClick={() => cancelWork(selection)}>
            {BUTTON_CANCEL}
          </button>
        </div>
      </>
    );
  } else if (screen.name === "result") {
    body = (
      <>
        <p>{screen.summary}</p>
        <div className="intake-actions">
          <button type="button" onClick={close}>
            {BUTTON_CLOSE}
          </button>
        </div>
      </>
    );
  } else {
    const { review } = screen;
    const selection: Selection = { review, sizes: screen.sizes };
    const cap = capMessage(review, deps.defaults.maxFiles, deps.defaults.maxTotalBytes, "local");
    const lines = [
      review.counts["excluded-dir"] > 0 ? excludedDirsLine(review.counts["excluded-dir"]) : null,
      review.counts["secret-pattern"] > 0 ? secretLine(review.counts["secret-pattern"]) : null,
      review.counts.extension > 0 ? extensionLine(review.counts.extension) : null,
      review.counts.oversized > 0 ? oversizedLine(review.counts.oversized) : null,
    ].filter((line): line is string => line !== null);
    body = (
      <>
        <p className="intake-mono">{folderLine(review.folder)}</p>
        <p className="intake-mono">{includedLine(review.included.length, formatSize(review.includedBytes))}</p>
        <p className="intake-mono">{skippedLine(review.skipped.length)}</p>
        {lines.length > 0 ? (
          <ul aria-label="Why files were skipped" className="intake-reasons">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
        <FileList title={includedListTitle(review.included.length)} entries={review.included.map((entry) => entry.path)} />
        <FileList title={skippedListTitle(review.skipped.length)} entries={review.skipped.map((entry) => skippedEntry(entry.path, reasonWords(entry.reason)))} />
        <p className="intake-muted">{REVIEW_SENTENCE}</p>
        {cap !== null ? (
          <p id={capId} className="intake-cap">
            {cap}
          </p>
        ) : null}
        <div className="intake-actions">
          <button
            type="button"
            className="primary"
            data-autofocus=""
            aria-disabled={cap !== null ? "true" : undefined}
            aria-describedby={cap !== null ? capId : undefined}
            onClick={() => {
              if (cap === null) void analyze(selection);
            }}
          >
            {BUTTON_ANALYZE}
          </button>
          <button type="button" onClick={() => setScreen({ name: "choose" })}>
            {BUTTON_BACK}
          </button>
          <button type="button" onClick={close}>
            {BUTTON_CLOSE}
          </button>
        </div>
      </>
    );
  }

  const busy = screen.name === "reading" || screen.name === "analyzing";
  return (
    <DialogFrame title={heading("local", purpose)} busy={busy} screenKey={screen.name} onEscape={close}>
      {body}
    </DialogFrame>
  );
}