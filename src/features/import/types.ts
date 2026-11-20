import type { AnalysisOptions, Investigation, Preset, SourceFile } from "../../contracts/types";
import type { ValidationResult } from "../../contracts/validate";
import type { ReadClient, ReadWorkerLike } from "./readFiles";

// The types of the intake service (design.md, Types and the service). They are structural: nothing here imports
// src/components or src/features/investigation, so the real store and analysis client satisfy them without a dependency.

export type IntakeKind = "local" | "github";
export type IntakePurpose = "open" | "after";

export interface IntakeArgs {
  purpose: IntakePurpose;
  kind: IntakeKind;
}

export type IntakeResult =
  | { ok: true; investigation: Investigation; sourceText: ReadonlyMap<string, string> | null; label: string }
  | { ok: false; reason: "cancelled" }
  | { ok: false; reason: "failed"; message: string };

/** The parts of the investigation store that intake uses. */
export interface IntakeStore {
  getState(): { investigation: Investigation | null; preset: Preset };
  actions: {
    openInvestigation(investigation: Investigation, source: ReadonlyMap<string, string> | null, opts: { demo: boolean }): void;
    setStatus(message: string): void;
  };
}

export interface IntakeAnalysisClient {
  analyze(request: { files: SourceFile[]; rootLabel: string; options: AnalysisOptions }, onProgress?: (done: number, total: number) => void): Promise<Investigation>;
  cancel(): void;
}

/** What a saved investigation holds (Requirement 5.2). The store itself is built in saved.ts. */
export interface SavedRecord {
  savedVersion: 1;
  label: string;
  /** ISO 8601, UTC. */
  savedAt: string;
  investigation: Investigation;
  sourceText: Record<string, string> | null;
}

export interface SavedStore {
  /** Newest `savedAt` first. Rejects with the error name when the database cannot be opened. */
  list(): Promise<SavedRecord[]>;
  /** Replaces a record with the same label. */
  put(record: SavedRecord): Promise<void>;
  delete(label: string): Promise<void>;
}

export interface IntakeDeps {
  store: IntakeStore;
  analysisClient: IntakeAnalysisClient;
  /** DEFAULT_ANALYSIS_OPTIONS */
  defaults: AnalysisOptions;
  /** validateInvestigation */
  validate: (value: unknown) => ValidationResult;
  saved: SavedStore | null;
  createReadWorker: () => ReadWorkerLike;
  /** Null until the GitHub route is wired. */
  github: { fetchImpl: typeof fetch } | null;
  now?: () => Date;
  /** The document of the folder input probe and of focus handling; tests pass jsdom's. */
  doc?: Document;
}

export interface IntakeState {
  dialog: { kind: IntakeKind; purpose: IntakePurpose; opener: Element | null } | null;
  /** The delay between files in the read worker; only the development hook sets it. */
  readDelayMs: number;
}

export interface IntakeService {
  readonly kinds: readonly IntakeKind[];
  readonly deps: IntakeDeps;
  /** The one read worker handle of the app; `cancel()` terminates a busy worker and the next read creates a fresh one. */
  readonly readClient: ReadClient;
  /** A call made while a dialog is open returns the pending promise. */
  open(args: IntakeArgs): Promise<IntakeResult>;
  getState(): IntakeState;
  subscribe(listener: () => void): () => void;
  /** Settles the promise of the open dialog and leaves the dialog open (the result screen). A second call changes nothing. */
  resolve(result: IntakeResult): void;
  /** Settles the promise if it is not settled, closes the dialog and returns focus. */
  close(result: IntakeResult): void;
  setReadDelay(ms: number): void;
}
