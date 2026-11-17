import type { AnalysisOptions, Diagnostic, Investigation, SourceFile } from "../contracts/types";

// Every message carries { requestId, revision, kind, payload }; replies echo requestId and revision.
export type WorkerRequest = {
  requestId: string;
  revision: number;
  kind: "analyze";
  payload: { files: SourceFile[]; rootLabel: string; options: AnalysisOptions };
};

export type WorkerReply =
  | { requestId: string; revision: number; kind: "progress"; done: number; total: number }
  | { requestId: string; revision: number; kind: "result"; investigation: Investigation }
  | { requestId: string; revision: number; kind: "error"; diagnostics: Diagnostic[]; message: string };

export interface WorkerLike {
  postMessage(message: WorkerRequest): void;
  terminate(): void;
  onmessage: ((event: { data: WorkerReply }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export class AnalysisCancelled extends Error {
  constructor(message = "The analysis was cancelled.") {
    super(message);
    this.name = "AnalysisCancelled";
  }
}

export class AnalysisFailed extends Error {
  diagnostics: Diagnostic[];
  constructor(message: string, diagnostics: Diagnostic[] = []) {
    super(message);
    this.name = "AnalysisFailed";
    this.diagnostics = diagnostics;
  }
}

export interface AnalysisClient {
  analyze(
    request: { files: SourceFile[]; rootLabel: string; options: AnalysisOptions },
    onProgress?: (done: number, total: number) => void,
  ): Promise<Investigation>;
  cancel(): void;
  readonly currentRevision: number;
  readonly lastInvestigation: Investigation | null;
}

interface Pending {
  requestId: string;
  revision: number;
  resolve(investigation: Investigation): void;
  reject(error: Error): void;
  onProgress: ((done: number, total: number) => void) | undefined;
}

/**
 * The worker handle with the revision guard. A message cannot interrupt synchronous parsing, so
 * a cancel or a replacement calls `terminate()` on the busy worker and creates a fresh one with
 * `createWorker`. A reply is used only when it comes from the current worker, carries the
 * current revision and the pending requestId; anything else is dropped. A failed or cancelled
 * request never changes `lastInvestigation`.
 */
export function createAnalysisClient(createWorker: () => WorkerLike): AnalysisClient {
  let worker: WorkerLike | null = null;
  let pending: Pending | null = null;
  let revision = 0;
  let last: Investigation | null = null;

  function attach(created: WorkerLike): WorkerLike {
    created.onmessage = (event) => {
      if (created === worker) handleReply(event.data);
    };
    created.onerror = (event) => {
      if (created !== worker || pending === null) return;
      const detail = event instanceof Error ? event.message : "The analysis worker raised an error.";
      const failed = pending;
      pending = null;
      replaceWorker();
      failed.reject(new AnalysisFailed(detail));
    };
    return created;
  }

  function replaceWorker(): void {
    worker?.terminate();
    worker = null;
    worker = attach(createWorker());
  }

  function handleReply(reply: WorkerReply): void {
    if (reply.revision < revision) return;
    if (pending === null || reply.revision !== pending.revision || reply.requestId !== pending.requestId) return;
    if (reply.kind === "progress") {
      pending.onProgress?.(reply.done, reply.total);
      return;
    }
    const settled = pending;
    pending = null;
    if (reply.kind === "result") {
      last = reply.investigation;
      settled.resolve(reply.investigation);
    } else {
      settled.reject(new AnalysisFailed(reply.message, reply.diagnostics));
    }
  }

  function cancelRunning(): void {
    if (pending === null) return;
    const cancelled = pending;
    pending = null;
    try {
      replaceWorker();
    } catch {
      // No replacement could be created; the next analyze() tries again.
    }
    cancelled.reject(new AnalysisCancelled());
  }

  return {
    analyze(request, onProgress) {
      revision += 1;
      const mine = revision;
      cancelRunning();
      return new Promise<Investigation>((resolve, reject) => {
        try {
          worker ??= attach(createWorker());
        } catch (error) {
          reject(new AnalysisFailed(error instanceof Error ? error.message : "The analysis worker could not be created."));
          return;
        }
        const requestId = `analysis-${mine}`;
        pending = { requestId, revision: mine, resolve, reject, onProgress };
        worker.postMessage({ requestId, revision: mine, kind: "analyze", payload: request });
      });
    },
    cancel() {
      cancelRunning();
    },
    get currentRevision() {
      return revision;
    },
    get lastInvestigation() {
      return last;
    },
  };
}
