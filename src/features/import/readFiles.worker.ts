import { readAll } from "./readFiles";
import type { ReadReply, ReadRequest } from "./readFiles";

/**
 * Runs one read request and posts every reply through `post`. It never throws: a failure becomes one `error` reply.
 * Each reply echoes the `requestId` and the `revision` of the request.
 */
export async function runRead(request: ReadRequest, post: (reply: ReadReply) => void): Promise<void> {
  const { requestId, revision } = request;
  try {
    if (request.kind !== "read") {
      post({ requestId, revision, kind: "error", payload: { message: `Unknown request kind: ${String(request.kind)}` } });
      return;
    }
    const result = await readAll(request.payload.files, {
      delayMs: request.payload.delayMs,
      now: () => performance.now(),
      onProgress: (done, total) => post({ requestId, revision, kind: "progress", payload: { done, total } }),
    });
    post({ requestId, revision, kind: "done", payload: result });
  } catch (error) {
    post({ requestId, revision, kind: "error", payload: { message: error instanceof Error ? error.message : String(error) } });
  }
}

// Register the entry only inside a real worker; importing this file in Node or in a test does nothing.
interface WorkerScope {
  onmessage: ((event: { data: ReadRequest }) => void) | null;
  postMessage(reply: ReadReply): void;
}

if (typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope !== "undefined") {
  const scope = globalThis as unknown as WorkerScope;
  scope.onmessage = (event) => {
    void runRead(event.data, (reply) => scope.postMessage(reply));
  };
}
