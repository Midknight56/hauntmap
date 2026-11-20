import type { SourceFile } from "../../contracts/types";

// Reading the included files of a chosen folder (Requirement 3.1). `readAll` is pure over `Blob`; the worker
// entry in readFiles.worker.ts runs it off the main thread, and `createReadClient` talks to that worker with the
// envelope of .kiro/steering/analysis.md: every message carries { requestId, revision, kind, payload }.

export interface ReadInput {
  path: string;
  file: Blob;
}

export interface ReadResult {
  files: SourceFile[];
  binary: string[];
}

export type ReadRequest = {
  requestId: string;
  revision: number;
  kind: "read";
  payload: { files: ReadInput[]; delayMs: number };
};

export type ReadReply =
  | { requestId: string; revision: number; kind: "progress"; payload: { done: number; total: number } }
  | { requestId: string; revision: number; kind: "done"; payload: ReadResult }
  | { requestId: string; revision: number; kind: "error"; payload: { message: string } };

export interface ReadWorkerLike {
  postMessage(message: ReadRequest): void;
  terminate(): void;
  onmessage: ((event: { data: ReadReply }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

const NUL_SCAN_LENGTH = 8192;
const PROGRESS_INTERVAL_MS = 100;

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Reads every file in path order. `Blob.text()` decodes UTF-8 and removes a leading byte order mark, as the Node
 * loader's TextDecoder does; line ends are kept. A file with a NUL in its first 8,192 characters is listed in
 * `binary` and left out of `files`. `bytes` is the file size. Progress is reported when 100 ms have passed since the
 * last report (by `now`), and always for the last file. `delayMs` is waited between files (0 means no wait).
 */
export async function readAll(
  files: ReadInput[],
  opts: { delayMs: number; now: () => number; onProgress(done: number, total: number): void; sleep?: (ms: number) => Promise<void> },
): Promise<ReadResult> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const ordered = [...files].sort((a, b) => compareText(a.path, b.path));
  const read: SourceFile[] = [];
  const binary: string[] = [];
  let last = opts.now();
  for (let index = 0; index < ordered.length; index += 1) {
    const item = ordered[index] as ReadInput;
    const text = await item.file.text();
    if (text.slice(0, NUL_SCAN_LENGTH).includes("\u0000")) binary.push(item.path);
    else read.push({ path: item.path, text, bytes: item.file.size });
    const done = index + 1;
    const time = opts.now();
    if (done === ordered.length || time - last >= PROGRESS_INTERVAL_MS) {
      last = time;
      opts.onProgress(done, ordered.length);
    }
    if (opts.delayMs > 0 && done < ordered.length) await sleep(opts.delayMs);
  }
  return { files: read, binary };
}

function namedError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

interface Pending {
  requestId: string;
  revision: number;
  resolve(result: ReadResult): void;
  reject(error: Error): void;
  onProgress: (done: number, total: number) => void;
}

/**
 * The read worker handle. A message cannot interrupt a read, so `cancel()` terminates the busy worker and drops it;
 * the next `read` creates a fresh one. A reply counts only when it comes from the current worker and carries the
 * current revision and the pending request id; anything else is dropped.
 */
export function createReadClient(createWorker: () => ReadWorkerLike): {
  read(files: ReadInput[], onProgress: (done: number, total: number) => void, delayMs?: number): Promise<ReadResult>;
  cancel(): void;
} {
  let worker: ReadWorkerLike | null = null;
  let pending: Pending | null = null;
  let revision = 0;

  function dropWorker(): void {
    const old = worker;
    worker = null;
    old?.terminate();
  }

  function attach(created: ReadWorkerLike): ReadWorkerLike {
    created.onmessage = (event) => {
      if (created === worker) handleReply(event.data);
    };
    created.onerror = (event) => {
      if (created !== worker || pending === null) return;
      const failed = pending;
      pending = null;
      dropWorker();
      failed.reject(namedError("ReadFailed", event instanceof Error ? event.message : "The read worker raised an error."));
    };
    return created;
  }

  function handleReply(reply: ReadReply): void {
    if (pending === null || reply.revision < revision || reply.revision !== pending.revision || reply.requestId !== pending.requestId) return;
    if (reply.kind === "progress") {
      pending.onProgress(reply.payload.done, reply.payload.total);
      return;
    }
    const settled = pending;
    pending = null;
    if (reply.kind === "done") settled.resolve(reply.payload);
    else settled.reject(namedError("ReadFailed", reply.payload.message));
  }

  function cancelPending(): void {
    if (pending === null) return;
    const cancelled = pending;
    pending = null;
    dropWorker();
    cancelled.reject(namedError("AbortError", "The read was cancelled."));
  }

  return {
    read(files, onProgress, delayMs = 0) {
      revision += 1;
      const mine = revision;
      cancelPending();
      return new Promise<ReadResult>((resolve, reject) => {
        try {
          worker ??= attach(createWorker());
        } catch (error) {
          reject(namedError("ReadFailed", error instanceof Error ? error.message : "The read worker could not be created."));
          return;
        }
        const requestId = `read-${mine}`;
        pending = { requestId, revision: mine, resolve, reject, onProgress };
        worker.postMessage({ requestId, revision: mine, kind: "read", payload: { files, delayMs } });
      });
    },
    cancel() {
      cancelPending();
    },
  };
}
