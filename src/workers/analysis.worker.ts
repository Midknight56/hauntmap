import { analyze, selectSources, type HashFn } from "../analysis";
import type { Diagnostic } from "../contracts/types";
import type { WorkerReply, WorkerRequest } from "./client";

/** SHA-256 hex through Web Crypto, which a worker and Node both have. */
const webCryptoHash: HashFn = async (text) => {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

function errorReply(request: WorkerRequest, message: string, diagnostics: Diagnostic[]): WorkerReply {
  return { requestId: request.requestId, revision: request.revision, kind: "error", diagnostics, message };
}

/**
 * Runs one request and posts every reply through `post`. It never throws: any error becomes an
 * `error` reply, so the client can keep its last good investigation. Each reply echoes the
 * `requestId` and the `revision` of the request. `selectSources` runs first; when it returns
 * `ok: false` (a cap), the reply is an `error` carrying the `cap-reached` diagnostic.
 */
export async function runRequest(
  request: WorkerRequest,
  post: (reply: WorkerReply) => void,
  hash: HashFn = webCryptoHash,
): Promise<void> {
  const { requestId, revision } = request;
  try {
    if (request.kind !== "analyze") {
      post(errorReply(request, `Unknown request kind: ${String(request.kind)}`, []));
      return;
    }
    const { files, rootLabel, options } = request.payload;
    const selected = selectSources(files, rootLabel, options);
    if (!selected.ok) {
      const message = selected.diagnostics.map((d) => `${d.code}: ${d.message}`).join(" ");
      post(errorReply(request, message, selected.diagnostics));
      return;
    }
    const investigation = await analyze(
      selected.sourceSet,
      options,
      hash,
      (done, total) => post({ requestId, revision, kind: "progress", done, total }),
      selected.diagnostics,
    );
    post({ requestId, revision, kind: "result", investigation });
  } catch (error) {
    post(errorReply(request, error instanceof Error ? error.message : String(error), []));
  }
}

// Register the entry only inside a real worker; importing this file in Node or in a test does nothing.
interface WorkerScope {
  onmessage: ((event: { data: WorkerRequest }) => void) | null;
  postMessage(reply: WorkerReply): void;
}

if (typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope !== "undefined") {
  const scope = globalThis as unknown as WorkerScope;
  scope.onmessage = (event) => {
    void runRequest(event.data, (reply) => scope.postMessage(reply));
  };
}
