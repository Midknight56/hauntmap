import { runRead } from "../../src/features/import/readFiles.worker";
import type { ReadReply, ReadRequest, ReadWorkerLike } from "../../src/features/import/readFiles";

// Fakes for the intake tests: a File that refuses to be read, a fetch with a routing table, and a read worker
// that runs `readAll` inline.

export interface GuardedFile extends File {
  /** Lets the read methods work. */
  allowRead(): void;
  /** Names of the read methods called while reading was not allowed, in call order. */
  readonly attempts: string[];
}

const READ_METHODS = ["slice", "stream", "text", "arrayBuffer", "bytes"] as const;

/** A `File` whose read methods throw until `allowRead()`. `name`, `size` and `webkitRelativePath` work from the start. */
export function guardedFile(path: string, content: string | Uint8Array, folder?: string): GuardedFile {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const file = new File([content as BlobPart], name) as GuardedFile;
  if (folder !== undefined) Object.defineProperty(file, "webkitRelativePath", { value: `${folder}/${path}`, configurable: true });
  const attempts: string[] = [];
  let allowed = false;
  Object.defineProperty(file, "attempts", { value: attempts });
  Object.defineProperty(file, "allowRead", { value: () => { allowed = true; } });
  for (const method of READ_METHODS) {
    const original = (file as unknown as Record<string, unknown>)[method];
    if (typeof original !== "function") continue;
    Object.defineProperty(file, method, {
      configurable: true,
      value: (...args: unknown[]) => {
        if (!allowed) {
          attempts.push(method);
          throw new Error(`File.${method} was called before reading was allowed`);
        }
        return (original as (...a: unknown[]) => unknown).apply(file, args);
      },
    });
  }
  return file;
}

export interface FakeRoute {
  status?: number;
  /** A string or bytes as they are; any other object is sent as JSON. */
  body?: string | Uint8Array | object;
  /** Answer after this many milliseconds. */
  delayMs?: number;
  /** Answer only after `release(url)` or `release()`. */
  hold?: boolean;
  /** Reject with an error of this name instead of answering. */
  reject?: string;
}

export interface RecordedCall {
  url: string;
  method: string;
  credentials: RequestCredentials | undefined;
  headers: Record<string, string>;
}

export interface FakeFetch {
  fetch: typeof fetch;
  calls: RecordedCall[];
  /** Requests that have started and not yet answered or been aborted. */
  readonly pending: number;
  /** The highest value `pending` has had. */
  readonly maxPending: number;
  /** Answers the held request for `url`, or every held request. */
  release(url?: string): void;
}

type Routes = Record<string, FakeRoute> | ((url: string) => FakeRoute | undefined);

function urlOf(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

function bodyOf(route: FakeRoute): BodyInit {
  const body = route.body ?? "";
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return body as BodyInit;
  return JSON.stringify(body);
}

/** A `fetch` that records each call, answers from `routes` (404 for an unknown URL) and counts pending requests. */
export function createFakeFetch(routes: Routes): FakeFetch {
  const calls: RecordedCall[] = [];
  const held = new Map<string, (() => void)[]>();
  let pending = 0;
  let maxPending = 0;

  const fakeFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = urlOf(input);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    calls.push({ url, method: init?.method ?? "GET", credentials: init?.credentials, headers });
    const route = (typeof routes === "function" ? routes(url) : routes[url]) ?? { status: 404, body: "" };
    pending += 1;
    maxPending = Math.max(maxPending, pending);
    const signal = init?.signal ?? null;
    return new Promise<Response>((resolve, reject) => {
      let settled = false;
      const finish = (action: () => void): void => {
        if (settled) return;
        settled = true;
        pending -= 1;
        signal?.removeEventListener("abort", onAbort);
        action();
      };
      const answer = (): void =>
        finish(() => {
          if (route.reject !== undefined) {
            const error = new Error(route.reject);
            error.name = route.reject;
            reject(error);
          } else {
            resolve(new Response(bodyOf(route), { status: route.status ?? 200 }));
          }
        });
      function onAbort(): void {
        finish(() => reject(new DOMException("The operation was aborted.", "AbortError")));
      }
      if (signal?.aborted === true) {
        onAbort();
        return;
      }
      signal?.addEventListener("abort", onAbort);
      if (route.hold === true) held.set(url, [...(held.get(url) ?? []), answer]);
      else if ((route.delayMs ?? 0) > 0) setTimeout(answer, route.delayMs);
      else queueMicrotask(answer);
    });
  };

  return {
    fetch: fakeFetch as typeof fetch,
    calls,
    get pending() {
      return pending;
    },
    get maxPending() {
      return maxPending;
    },
    release(url) {
      const keys = url === undefined ? [...held.keys()] : [url];
      for (const key of keys) {
        const waiting = held.get(key) ?? [];
        held.delete(key);
        for (const answer of waiting) answer();
      }
    },
  };
}

export class InlineReadWorker implements ReadWorkerLike {
  terminated = false;
  onmessage: ((event: { data: ReadReply }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  postMessage(message: ReadRequest): void {
    queueMicrotask(() => {
      void runRead(message, (reply) => {
        if (!this.terminated) this.onmessage?.({ data: reply });
      });
    });
  }
  terminate(): void {
    this.terminated = true;
  }
}

/** A factory for `createReadClient`: each call makes a worker that runs `readAll` in this thread, and the list keeps them. */
export function createInlineReadWorkers(): { create: () => InlineReadWorker; workers: InlineReadWorker[] } {
  const workers: InlineReadWorker[] = [];
  return {
    workers,
    create: () => {
      const worker = new InlineReadWorker();
      workers.push(worker);
      return worker;
    },
  };
}