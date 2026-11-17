import type { LayoutRequest, LayoutResult } from "../../scene/layout/types";

// The layout worker client. It has the same shape as the analysis client of src/workers/client.ts,
// written for the `layout` message kind: a reply is used only from the current worker, with the
// current revision and the pending request ID; a cancel or a replacement terminates the busy worker
// and creates a fresh one, because a message cannot interrupt synchronous layout.

export interface LayoutRequestMessage {
  requestId: string;
  revision: number;
  kind: "layout";
  payload: LayoutRequest;
}

export type LayoutReply =
  | { requestId: string; revision: number; kind: "result"; result: LayoutResult }
  | { requestId: string; revision: number; kind: "error"; message: string };

export interface LayoutWorkerLike {
  postMessage(message: LayoutRequestMessage): void;
  terminate(): void;
  onmessage: ((event: { data: LayoutReply }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export class LayoutCancelled extends Error {
  constructor(message = "The layout was cancelled.") {
    super(message);
    this.name = "LayoutCancelled";
  }
}

export class LayoutFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LayoutFailed";
  }
}

export interface LayoutClient {
  request(payload: LayoutRequest, revision: number): Promise<LayoutResult>;
  cancel(): void;
  /** The last successful result; a failed or cancelled request never changes it. */
  readonly lastResult: LayoutResult | null;
}

interface Pending {
  requestId: string;
  revision: number;
  resolve(result: LayoutResult): void;
  reject(error: Error): void;
}

export function createLayoutClient(createWorker: () => LayoutWorkerLike): LayoutClient {
  let worker: LayoutWorkerLike | null = null;
  let pending: Pending | null = null;
  let last: LayoutResult | null = null;

  function attach(created: LayoutWorkerLike): LayoutWorkerLike {
    created.onmessage = (event) => {
      if (created === worker) handleReply(event.data);
    };
    created.onerror = (event) => {
      if (created !== worker || pending === null) return;
      const detail = event instanceof Error ? event.message : "The layout worker raised an error.";
      const failed = pending;
      pending = null;
      replaceWorker();
      failed.reject(new LayoutFailed(detail));
    };
    return created;
  }

  function replaceWorker(): LayoutWorkerLike {
    if (worker !== null) worker.terminate();
    worker = attach(createWorker());
    return worker;
  }

  function handleReply(reply: LayoutReply): void {
    if (pending === null || reply.requestId !== pending.requestId || reply.revision !== pending.revision) return;
    const settled = pending;
    pending = null;
    if (reply.kind === "result") {
      last = reply.result;
      settled.resolve(reply.result);
    } else {
      settled.reject(new LayoutFailed(reply.message));
    }
  }

  return {
    request(payload, revision) {
      if (pending !== null) {
        const superseded = pending;
        pending = null;
        superseded.reject(new LayoutCancelled("The layout was replaced by a newer request."));
        replaceWorker();
      }
      const active = worker ?? replaceWorker();
      return new Promise<LayoutResult>((resolve, reject) => {
        const requestId = `l-${revision}`;
        pending = { requestId, revision, resolve, reject };
        active.postMessage({ requestId, revision, kind: "layout", payload });
      });
    },
    cancel() {
      if (pending !== null) {
        const cancelled = pending;
        pending = null;
        cancelled.reject(new LayoutCancelled());
      }
      replaceWorker();
    },
    get lastResult() {
      return last;
    },
  };
}
