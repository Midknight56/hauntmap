import { act, fireEvent, render, screen } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { DEFAULT_ANALYSIS_OPTIONS } from "../../src/contracts/options";
import type { Investigation } from "../../src/contracts/types";
import { validateInvestigation } from "../../src/contracts/validate";
import { IntakeHost } from "../../src/features/import/IntakeHost";
import { createIntake } from "../../src/features/import/intake";
import type { IntakeAnalysisClient, IntakeDeps, IntakeResult, IntakeService, IntakeStore } from "../../src/features/import/types";
import { createAnalysisClient, type WorkerLike } from "../../src/workers/client";
import { runRequest } from "../../src/workers/analysis.worker";
import type { ReadReply, ReadRequest, ReadResult, ReadWorkerLike } from "../../src/features/import/readFiles";
import { createInlineReadWorkers } from "./fakes";

// Shared set up of the dialog tests (jsdom): a store that records what it is told, an analysis client the test controls,
// the inline read worker, and a folder input probe that works in jsdom (which has no `webkitdirectory` property).

export interface FakeIntakeStore extends IntakeStore {
  statuses: string[];
  opened: { investigation: Investigation; source: ReadonlyMap<string, string> | null; demo: boolean }[];
  /** Every action name called, in order. */
  calls: string[];
}

/**
 * A store that records what it is told. With `over` (a real store) it delegates to it, so that the six fields of 3.3 can be read
 * from the real state; without, it keeps a small state of its own.
 */
export function fakeIntakeStore(initial: { investigation?: Investigation | null; preset?: "static-value" | "type-inclusive" | "dynamic-inclusive"; over?: IntakeStore } = {}): FakeIntakeStore {
  const own = { investigation: initial.investigation ?? null, preset: initial.preset ?? ("static-value" as const) };
  const over = initial.over;
  const store: FakeIntakeStore = {
    statuses: [],
    opened: [],
    calls: [],
    getState: () => (over === undefined ? own : over.getState()),
    actions: {
      openInvestigation(investigation, source, opts) {
        store.calls.push("openInvestigation");
        store.opened.push({ investigation, source, demo: opts.demo });
        if (over === undefined) own.investigation = investigation;
        else over.actions.openInvestigation(investigation, source, opts);
      },
      setStatus(message) {
        store.calls.push("setStatus");
        store.statuses.push(message);
        over?.actions.setStatus(message);
      },
    },
  };
  return store;
}

export interface AnalyzeCall {
  request: Parameters<IntakeAnalysisClient["analyze"]>[0];
  onProgress: ((done: number, total: number) => void) | undefined;
  resolve(investigation: Investigation): void;
  reject(error: Error): void;
}

export interface FakeAnalysisClient extends IntakeAnalysisClient {
  calls: AnalyzeCall[];
  cancelCount: number;
}

/** An analysis client whose calls stay pending until the test settles them. `cancel()` rejects the pending call like the real one. */
export function fakeAnalysisClient(): FakeAnalysisClient {
  const client: FakeAnalysisClient = {
    calls: [],
    cancelCount: 0,
    analyze(request, onProgress) {
      return new Promise<Investigation>((resolve, reject) => {
        client.calls.push({ request, onProgress, resolve, reject });
      });
    },
    cancel() {
      client.cancelCount += 1;
      const last = client.calls.at(-1);
      if (last !== undefined) {
        const error = new Error("The analysis was cancelled.");
        error.name = "AnalysisCancelled";
        last.reject(error);
      }
    },
  };
  return client;
}

export function namedError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

/** Gives `<input>` a `webkitdirectory` property for the duration of a test file, as Chromium has. */
export function installDirectoryInput(): void {
  if (!("webkitdirectory" in HTMLInputElement.prototype)) {
    Object.defineProperty(HTMLInputElement.prototype, "webkitdirectory", {
      configurable: true,
      get() {
        return this.hasAttribute("webkitdirectory");
      },
      set(value: boolean) {
        if (value) this.setAttribute("webkitdirectory", "");
        else this.removeAttribute("webkitdirectory");
      },
    });
  }
}

export function removeDirectoryInput(): void {
  delete (HTMLInputElement.prototype as unknown as Record<string, unknown>)["webkitdirectory"];
}

export interface Harness {
  service: IntakeService;
  store: FakeIntakeStore;
  analysis: FakeAnalysisClient;
  workers: ReturnType<typeof createInlineReadWorkers>;
  /** The result of the last `open` call, once settled. */
  results: IntakeResult[];
  open(args?: { purpose?: "open" | "after"; kind?: "local" | "github" }): Promise<IntakeResult>;
  opener: HTMLButtonElement;
}

export function makeHarness(
  options: { store?: FakeIntakeStore; github?: boolean; extra?: ReactElement; deps?: Partial<IntakeDeps> } = {},
): Harness {
  const store = options.store ?? fakeIntakeStore();
  const analysis = fakeAnalysisClient();
  const workers = createInlineReadWorkers();
  const service = createIntake({
    store,
    analysisClient: analysis,
    defaults: DEFAULT_ANALYSIS_OPTIONS,
    validate: validateInvestigation,
    saved: null,
    createReadWorker: workers.create,
    github: options.github === true ? { fetchImpl: (input, init) => fetch(input, init) } : null,
    ...options.deps,
  });
  const results: IntakeResult[] = [];
  render(createElement("div", null, createElement("button", { type: "button", id: "opener" }, "Opener"), createElement(IntakeHost, { service }), options.extra));
  const opener = screen.getByRole("button", { name: "Opener" }) as HTMLButtonElement;
  return {
    service,
    store,
    analysis,
    workers,
    results,
    opener,
    open(args = {}) {
      opener.focus();
      let promise: Promise<IntakeResult> | undefined;
      act(() => {
        promise = service.open({ purpose: args.purpose ?? "open", kind: args.kind ?? "local" });
      });
      const settled = (promise as Promise<IntakeResult>).then((result) => {
        results.push(result);
        return result;
      });
      return settled;
    },
  };
}

/** Chooses files in the folder input, as the browser's folder picker does. */
export function chooseFiles(input: HTMLInputElement, files: File[]): void {
  Object.defineProperty(input, "files", { value: files, configurable: true });
  fireEvent.change(input);
}

export function folderInput(): HTMLInputElement {
  return screen.getByLabelText("Choose a folder") as HTMLInputElement;
}

/** A `File` of a given size without allocating it, with `webkitRelativePath` `<folder>/<path>`. */
export function sizedFile(folder: string, path: string, size: number): File {
  const file = new File([""], path.slice(path.lastIndexOf("/") + 1));
  Object.defineProperty(file, "size", { value: size, configurable: true });
  Object.defineProperty(file, "webkitRelativePath", { value: `${folder}/${path}`, configurable: true });
  return file;
}

/** The text of every element, one string per list item, of the named list. */
export function itemsOf(listName: string): string[] {
  const list = screen.getByRole("list", { name: listName });
  return Array.from(list.querySelectorAll("li")).map((li) => li.textContent ?? "");
}

/** The real analysis client over a worker that runs `runRequest` in this thread. */
export function inlineAnalysisClient(): IntakeAnalysisClient & { requests: Parameters<IntakeAnalysisClient["analyze"]>[0][] } {
  const requests: Parameters<IntakeAnalysisClient["analyze"]>[0][] = [];
  const client = createAnalysisClient(() => {
    const worker: WorkerLike = {
      onmessage: null,
      onerror: null,
      terminate: () => undefined,
      postMessage(message) {
        queueMicrotask(() => {
          void runRequest(message, (reply) => worker.onmessage?.({ data: reply }));
        });
      },
    };
    return worker;
  });
  return {
    requests,
    analyze(request, onProgress) {
      requests.push(request);
      return client.analyze(request, onProgress);
    },
    cancel: () => client.cancel(),
  };
}

/** A read worker that answers only when the test says so. */
export class HeldReadWorker implements ReadWorkerLike {
  posted: ReadRequest[] = [];
  terminated = false;
  onmessage: ((event: { data: ReadReply }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  postMessage(message: ReadRequest): void {
    this.posted.push(message);
  }
  terminate(): void {
    this.terminated = true;
  }
  private send(reply: (request: ReadRequest) => ReadReply): void {
    const request = this.posted.at(-1);
    if (request === undefined) throw new Error("no read request was posted");
    act(() => {
      this.onmessage?.({ data: reply(request) });
    });
  }
  progress(done: number, total: number): void {
    this.send((r) => ({ requestId: r.requestId, revision: r.revision, kind: "progress", payload: { done, total } }));
  }
  done(result: ReadResult): void {
    this.send((r) => ({ requestId: r.requestId, revision: r.revision, kind: "done", payload: result }));
  }
  fail(message: string): void {
    this.send((r) => ({ requestId: r.requestId, revision: r.revision, kind: "error", payload: { message } }));
  }
}

export function heldReadWorkers(): { create: () => HeldReadWorker; workers: HeldReadWorker[] } {
  const workers: HeldReadWorker[] = [];
  return {
    workers,
    create: () => {
      const worker = new HeldReadWorker();
      workers.push(worker);
      return worker;
    },
  };
}