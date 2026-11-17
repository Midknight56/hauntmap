import { describe, expect, it } from "vitest";
import { DEFAULT_ANALYSIS_OPTIONS } from "../../src/contracts/options";
import type { Diagnostic, Investigation, SourceFile } from "../../src/contracts/types";
import {
  AnalysisCancelled,
  AnalysisFailed,
  createAnalysisClient,
  type WorkerLike,
  type WorkerReply,
  type WorkerRequest,
} from "../../src/workers/client";

// A stand-in for a Worker. `emit` delivers a reply even after terminate(), so the tests can check
// that the client ignores late messages. These tests do not prove timing in a real browser worker.
class FakeWorker implements WorkerLike {
  onmessage: WorkerLike["onmessage"] = null;
  onerror: WorkerLike["onerror"] = null;
  posted: WorkerRequest[] = [];
  terminated = false;
  postMessage(message: WorkerRequest): void {
    this.posted.push(message);
  }
  terminate(): void {
    this.terminated = true;
  }
  emit(reply: WorkerReply): void {
    this.onmessage?.({ data: reply });
  }
  fail(): void {
    this.onerror?.(new Error("worker crashed"));
  }
}

function setup() {
  const workers: FakeWorker[] = [];
  const client = createAnalysisClient(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  });
  return { workers, client };
}

const FILES: SourceFile[] = [{ path: "a.ts", text: "export const a = 1;\n", bytes: 20 }];

function request(label = "one") {
  return { files: FILES, rootLabel: label, options: DEFAULT_ANALYSIS_OPTIONS };
}

function investigation(label: string): Investigation {
  return {
    schemaVersion: 1,
    resolverMode: "documented-source-subset",
    sourceLabel: label,
    modules: [],
    imports: [],
    diagnostics: [],
    options: DEFAULT_ANALYSIS_OPTIONS,
  };
}

function lastPosted(worker: FakeWorker | undefined): WorkerRequest {
  const message = worker?.posted[worker.posted.length - 1];
  if (message === undefined) throw new Error("nothing was posted");
  return message;
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("message envelope (requirement 7.1)", () => {
  it("posts requestId, revision, kind and payload, and starts at revision 0 with no investigation", () => {
    const { workers, client } = setup();
    expect(client.currentRevision).toBe(0);
    expect(client.lastInvestigation).toBeNull();
    void client.analyze(request("envelope")).catch(() => undefined);
    expect(workers).toHaveLength(1);
    const message = lastPosted(workers[0]);
    expect(typeof message.requestId).toBe("string");
    expect(message.requestId).not.toBe("");
    expect(message.revision).toBe(1);
    expect(message.kind).toBe("analyze");
    expect(message.payload).toEqual({ files: FILES, rootLabel: "envelope", options: DEFAULT_ANALYSIS_OPTIONS });
    expect(client.currentRevision).toBe(1);
  });

  it("gives each request its own requestId and a growing revision", () => {
    const { workers, client } = setup();
    void client.analyze(request()).catch(() => undefined);
    void client.analyze(request()).catch(() => undefined);
    const first = workers[0]?.posted[0];
    const second = workers[1]?.posted[0];
    expect(second?.revision).toBe(2);
    expect(second?.requestId).not.toBe(first?.requestId);
  });

  it("resolves with the result of the current revision, and forwards progress with the same ids", async () => {
    const { workers, client } = setup();
    const progress: [number, number][] = [];
    const pending = client.analyze(request(), (done, total) => progress.push([done, total]));
    const message = lastPosted(workers[0]);
    workers[0]?.emit({ requestId: message.requestId, revision: message.revision, kind: "progress", done: 1, total: 3 });
    workers[0]?.emit({ requestId: message.requestId, revision: message.revision, kind: "progress", done: 2, total: 3 });
    const result = investigation("result");
    workers[0]?.emit({ requestId: message.requestId, revision: message.revision, kind: "result", investigation: result });
    await expect(pending).resolves.toBe(result);
    expect(progress).toEqual([
      [1, 3],
      [2, 3],
    ]);
    expect(client.lastInvestigation).toBe(result);
  });
});

describe("revision guard (requirement 7.2)", () => {
  it("discards a result with an older revision, even from the current worker", async () => {
    const { workers, client } = setup();
    const first = client.analyze(request("first"));
    const firstMessage = lastPosted(workers[0]);
    const second = client.analyze(request("second"));
    await expect(first).rejects.toBeInstanceOf(AnalysisCancelled);
    const secondMessage = lastPosted(workers[1]);
    expect(secondMessage.revision).toBe(2);

    // an old result arrives from the new worker and from the terminated one: both are dropped
    const stale = investigation("stale");
    workers[1]?.emit({ requestId: firstMessage.requestId, revision: 1, kind: "result", investigation: stale });
    workers[0]?.emit({ requestId: firstMessage.requestId, revision: 1, kind: "result", investigation: stale });
    await flush();
    expect(client.lastInvestigation).toBeNull();

    const fresh = investigation("fresh");
    workers[1]?.emit({ requestId: secondMessage.requestId, revision: 2, kind: "result", investigation: fresh });
    await expect(second).resolves.toBe(fresh);
    expect(client.lastInvestigation).toBe(fresh);
  });

  it("discards progress of an older revision", async () => {
    const { workers, client } = setup();
    const seen: number[] = [];
    const first = client.analyze(request(), (done) => seen.push(done));
    const firstMessage = lastPosted(workers[0]);
    void client.analyze(request()).catch(() => undefined);
    await expect(first).rejects.toBeInstanceOf(AnalysisCancelled);
    workers[1]?.emit({ requestId: firstMessage.requestId, revision: 1, kind: "progress", done: 9, total: 9 });
    workers[0]?.emit({ requestId: firstMessage.requestId, revision: 1, kind: "progress", done: 8, total: 9 });
    expect(seen).toEqual([]);
  });

  it("ignores a reply whose requestId is not the pending one", async () => {
    const { workers, client } = setup();
    const pending = client.analyze(request());
    const message = lastPosted(workers[0]);
    workers[0]?.emit({ requestId: "someone-else", revision: message.revision, kind: "result", investigation: investigation("wrong") });
    expect(client.lastInvestigation).toBeNull();
    const right = investigation("right");
    workers[0]?.emit({ requestId: message.requestId, revision: message.revision, kind: "result", investigation: right });
    await expect(pending).resolves.toBe(right);
  });
});

describe("cancel by terminate and recreate (requirement 7.3)", () => {
  it("replaces a running request: terminates the busy worker, creates a new one within 500 ms, rejects with AnalysisCancelled", async () => {
    const { workers, client } = setup();
    const first = client.analyze(request("first"));
    const started = performance.now();
    void client.analyze(request("second")).catch(() => undefined);
    const elapsed = performance.now() - started;
    expect(workers).toHaveLength(2);
    expect(workers[0]?.terminated).toBe(true);
    expect(workers[1]?.terminated).toBe(false);
    expect(elapsed).toBeLessThan(500);
    await expect(first).rejects.toBeInstanceOf(AnalysisCancelled);
    expect(lastPosted(workers[1]).payload.rootLabel).toBe("second");
  });

  it("cancel() terminates the busy worker, creates a new one within 500 ms and rejects with AnalysisCancelled", async () => {
    const { workers, client } = setup();
    const pending = client.analyze(request());
    const started = performance.now();
    client.cancel();
    const elapsed = performance.now() - started;
    expect(workers).toHaveLength(2);
    expect(workers[0]?.terminated).toBe(true);
    expect(workers[1]?.terminated).toBe(false);
    expect(elapsed).toBeLessThan(500);
    await expect(pending).rejects.toBeInstanceOf(AnalysisCancelled);
    expect(client.lastInvestigation).toBeNull();
  });

  it("cancels a worker that never answers, and the next request runs on the new worker", async () => {
    const { workers, client } = setup();
    const silent = client.analyze(request("silent"));
    // the first worker never replies, as a worker busy in synchronous parsing would not
    await flush();
    client.cancel();
    await expect(silent).rejects.toBeInstanceOf(AnalysisCancelled);
    expect(workers[0]?.terminated).toBe(true);

    const next = client.analyze(request("next"));
    const message = lastPosted(workers[1]);
    expect(workers).toHaveLength(2);
    const result = investigation("next");
    workers[1]?.emit({ requestId: message.requestId, revision: message.revision, kind: "result", investigation: result });
    await expect(next).resolves.toBe(result);
  });

  it("ignores a late result of a cancelled request", async () => {
    const { workers, client } = setup();
    const pending = client.analyze(request());
    const message = lastPosted(workers[0]);
    client.cancel();
    await expect(pending).rejects.toBeInstanceOf(AnalysisCancelled);
    workers[0]?.emit({ requestId: message.requestId, revision: message.revision, kind: "result", investigation: investigation("late") });
    workers[1]?.emit({ requestId: message.requestId, revision: message.revision, kind: "result", investigation: investigation("late") });
    expect(client.lastInvestigation).toBeNull();
  });

  it("does nothing when cancel() is called with no request running", () => {
    const { workers, client } = setup();
    expect(() => client.cancel()).not.toThrow();
    expect(workers.every((worker) => !worker.terminated)).toBe(true);
    expect(workers.length).toBeLessThanOrEqual(1);
  });

  it("names the error AnalysisCancelled", async () => {
    const { client } = setup();
    const pending = client.analyze(request());
    client.cancel();
    const error = await pending.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe("AnalysisCancelled");
  });
});

describe("failure keeps the last investigation (requirement 7.4)", () => {
  const diagnostics: Diagnostic[] = [{ code: "cap-reached", message: "too many files: 1001, first over the limit: z.ts" }];

  it("rejects with AnalysisFailed and the diagnostics of an error reply, and keeps the last investigation", async () => {
    const { workers, client } = setup();
    const first = client.analyze(request("good"));
    const good = investigation("good");
    const goodMessage = lastPosted(workers[0]);
    workers[0]?.emit({ requestId: goodMessage.requestId, revision: goodMessage.revision, kind: "result", investigation: good });
    await first;

    const second = client.analyze(request("bad"));
    const badMessage = lastPosted(workers[0]);
    workers[0]?.emit({ requestId: badMessage.requestId, revision: badMessage.revision, kind: "error", diagnostics, message: "cap reached" });
    const error = await second.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AnalysisFailed);
    expect((error as AnalysisFailed).diagnostics).toEqual(diagnostics);
    expect((error as AnalysisFailed).message).toBe("cap reached");
    expect(client.lastInvestigation).toBe(good);
  });

  it("rejects with AnalysisFailed when the worker raises an error event, keeps the last investigation, and recovers", async () => {
    const { workers, client } = setup();
    const first = client.analyze(request("good"));
    const good = investigation("good");
    const goodMessage = lastPosted(workers[0]);
    workers[0]?.emit({ requestId: goodMessage.requestId, revision: goodMessage.revision, kind: "result", investigation: good });
    await first;

    const second = client.analyze(request("crash"));
    workers[0]?.fail();
    await expect(second).rejects.toBeInstanceOf(AnalysisFailed);
    expect(client.lastInvestigation).toBe(good);

    const third = client.analyze(request("again"));
    const worker = workers[workers.length - 1];
    const message = lastPosted(worker);
    const again = investigation("again");
    worker?.emit({ requestId: message.requestId, revision: message.revision, kind: "result", investigation: again });
    await expect(third).resolves.toBe(again);
    expect(client.lastInvestigation).toBe(again);
  });

  it("keeps the last investigation when a later request is cancelled", async () => {
    const { workers, client } = setup();
    const first = client.analyze(request("good"));
    const good = investigation("good");
    const message = lastPosted(workers[0]);
    workers[0]?.emit({ requestId: message.requestId, revision: message.revision, kind: "result", investigation: good });
    await first;
    const second = client.analyze(request("cancelled"));
    client.cancel();
    await expect(second).rejects.toBeInstanceOf(AnalysisCancelled);
    expect(client.lastInvestigation).toBe(good);
  });

  it("rejects with AnalysisFailed when the worker cannot be created", async () => {
    const client = createAnalysisClient(() => {
      throw new Error("no workers here");
    });
    await expect(client.analyze(request())).rejects.toBeInstanceOf(AnalysisFailed);
    expect(client.lastInvestigation).toBeNull();
  });
});
