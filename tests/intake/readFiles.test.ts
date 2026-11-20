import { describe, expect, it } from "vitest";
import { createReadClient, readAll } from "../../src/features/import/readFiles";
import type { ReadReply, ReadRequest, ReadWorkerLike } from "../../src/features/import/readFiles";
import { runRead } from "../../src/features/import/readFiles.worker";
import { createInlineReadWorkers } from "./fakes";

// Requirement 3.1: reading in a worker, the NUL check, throttled progress, cancel and the revision guard.

function blob(text: string | Uint8Array): Blob {
  return new Blob([text as BlobPart]);
}

function silent() {
  return { delayMs: 0, now: () => 0, onProgress: () => undefined };
}

describe("readAll", () => {
  it("removes a leading byte order mark, keeps CRLF and sets bytes to the file size", async () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("a\r\nb\r\n")]);
    const result = await readAll([{ path: "a.ts", file: blob(withBom) }], silent());
    expect(result.files).toEqual([{ path: "a.ts", text: "a\r\nb\r\n", bytes: 9 }]);
    expect(result.binary).toEqual([]);
  });

  it("counts bytes, not characters, for text outside ASCII", async () => {
    const result = await readAll([{ path: "u.ts", file: blob("// \u00e9\u4e2d\n") }], silent());
    expect(result.files[0]?.bytes).toBe(new TextEncoder().encode("// \u00e9\u4e2d\n").byteLength);
  });

  it("lists a file with a NUL in its first 8,192 characters as binary and leaves it out of files", async () => {
    const nul = new Uint8Array([0, 1, 2, ...new TextEncoder().encode("export {};\n")]);
    const late = `${"a".repeat(8191)}\u0000tail`;
    const after = `${"a".repeat(8192)}\u0000tail`;
    const result = await readAll(
      [
        { path: "bin.ts", file: blob(nul) },
        { path: "late.ts", file: blob(late) },
        { path: "after.ts", file: blob(after) },
        { path: "ok.ts", file: blob("export {};\n") },
      ],
      silent(),
    );
    expect(result.binary).toEqual(["bin.ts", "late.ts"]);
    expect(result.files.map((file) => file.path)).toEqual(["after.ts", "ok.ts"]);
  });

  it("returns files sorted by path in code unit order whatever the input order", async () => {
    const result = await readAll(
      ["b.ts", "B.ts", "a/z.ts", "a.ts"].map((path) => ({ path, file: blob("x") })),
      silent(),
    );
    expect(result.files.map((file) => file.path)).toEqual(["B.ts", "a.ts", "a/z.ts", "b.ts"]);
  });

  it("reports progress at most every 100 ms by the given clock, and always for the last file", async () => {
    let t = 0;
    const reports: [number, number][] = [];
    const files = Array.from({ length: 10 }, (_, i) => ({ path: `f${String(i).padStart(2, "0")}.ts`, file: blob("x") }));
    await readAll(files, {
      delayMs: 0,
      now: () => {
        const value = t;
        t += 40;
        return value;
      },
      onProgress: (done, total) => reports.push([done, total]),
    });
    expect(reports).toEqual([
      [3, 10],
      [6, 10],
      [9, 10],
      [10, 10],
    ]);
  });

  it("reports the only file of a one file read", async () => {
    const reports: [number, number][] = [];
    await readAll([{ path: "a.ts", file: blob("x") }], { delayMs: 0, now: () => 0, onProgress: (d, t) => reports.push([d, t]) });
    expect(reports).toEqual([[1, 1]]);
  });

  it("waits delayMs between files, not after the last, and not at all when it is 0", async () => {
    const waits: number[] = [];
    const sleep = (ms: number) => {
      waits.push(ms);
      return Promise.resolve();
    };
    const three = ["a.ts", "b.ts", "c.ts"].map((path) => ({ path, file: blob("x") }));
    await readAll(three, { ...silent(), delayMs: 20, sleep });
    expect(waits).toEqual([20, 20]);
    waits.length = 0;
    await readAll(three, { ...silent(), sleep });
    expect(waits).toEqual([]);
  });

  it("returns empty results for no files", async () => {
    expect(await readAll([], silent())).toEqual({ files: [], binary: [] });
  });
});

class ManualWorker implements ReadWorkerLike {
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
  emit(reply: ReadReply): void {
    this.onmessage?.({ data: reply });
  }
}

function manualFactory() {
  const workers: ManualWorker[] = [];
  return {
    workers,
    create: () => {
      const worker = new ManualWorker();
      workers.push(worker);
      return worker;
    },
  };
}

const FILE = { path: "a.ts", file: blob("export {};\n") };

describe("createReadClient", () => {
  it("posts one read request with the envelope and resolves with the done payload", async () => {
    const factory = manualFactory();
    const client = createReadClient(factory.create);
    const progress: [number, number][] = [];
    const pending = client.read([FILE], (d, t) => progress.push([d, t]), 7);
    const worker = factory.workers[0] as ManualWorker;
    const request = worker.posted[0] as ReadRequest;
    expect(request.kind).toBe("read");
    expect(request.revision).toBe(1);
    expect(typeof request.requestId).toBe("string");
    expect(request.payload).toEqual({ files: [FILE], delayMs: 7 });
    worker.emit({ requestId: request.requestId, revision: 1, kind: "progress", payload: { done: 1, total: 2 } });
    expect(progress).toEqual([[1, 2]]);
    worker.emit({ requestId: request.requestId, revision: 1, kind: "done", payload: { files: [{ path: "a.ts", text: "t", bytes: 1 }], binary: ["b.ts"] } });
    await expect(pending).resolves.toEqual({ files: [{ path: "a.ts", text: "t", bytes: 1 }], binary: ["b.ts"] });
  });

  it("defaults delayMs to 0 and counts a new revision for each read", async () => {
    const factory = manualFactory();
    const client = createReadClient(factory.create);
    const first = client.read([FILE], () => undefined);
    const worker = factory.workers[0] as ManualWorker;
    const one = worker.posted[0] as ReadRequest;
    expect(one.payload.delayMs).toBe(0);
    worker.emit({ requestId: one.requestId, revision: 1, kind: "done", payload: { files: [], binary: [] } });
    await first;
    const second = client.read([FILE], () => undefined);
    const two = worker.posted[1] as ReadRequest;
    expect(two.revision).toBe(2);
    expect(two.requestId).not.toBe(one.requestId);
    worker.emit({ requestId: two.requestId, revision: 2, kind: "done", payload: { files: [], binary: [] } });
    await second;
    expect(factory.workers).toHaveLength(1);
  });

  it("drops a reply with an older revision or another request id", async () => {
    const factory = manualFactory();
    const client = createReadClient(factory.create);
    const stale = client.read([FILE], () => undefined);
    stale.catch(() => undefined);
    const fresh = client.read([FILE], () => undefined);
    const current = factory.workers[factory.workers.length - 1] as ManualWorker;
    const request = current.posted[0] as ReadRequest;
    expect(request.revision).toBe(2);
    current.emit({ requestId: "read-1", revision: 1, kind: "done", payload: { files: [{ path: "old.ts", text: "", bytes: 0 }], binary: [] } });
    current.emit({ requestId: "other", revision: 2, kind: "done", payload: { files: [{ path: "other.ts", text: "", bytes: 0 }], binary: [] } });
    current.emit({ requestId: request.requestId, revision: 2, kind: "done", payload: { files: [{ path: "new.ts", text: "", bytes: 0 }], binary: [] } });
    await expect(fresh).resolves.toEqual({ files: [{ path: "new.ts", text: "", bytes: 0 }], binary: [] });
    await expect(stale).rejects.toMatchObject({ name: "AbortError" });
  });

  it("cancel terminates the busy worker and rejects with AbortError; the next read makes a new worker", async () => {
    const factory = manualFactory();
    const client = createReadClient(factory.create);
    const pending = client.read([FILE], () => undefined);
    const first = factory.workers[0] as ManualWorker;
    client.cancel();
    expect(first.terminated).toBe(true);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    const request = first.posted[0] as ReadRequest;
    first.emit({ requestId: request.requestId, revision: 1, kind: "done", payload: { files: [], binary: [] } });
    const next = client.read([FILE], () => undefined);
    expect(factory.workers).toHaveLength(2);
    const second = factory.workers[1] as ManualWorker;
    expect(second.terminated).toBe(false);
    const again = second.posted[0] as ReadRequest;
    expect(again.revision).toBe(2);
    second.emit({ requestId: again.requestId, revision: 2, kind: "done", payload: { files: [], binary: [] } });
    await expect(next).resolves.toEqual({ files: [], binary: [] });
  });

  it("cancel with nothing pending changes nothing", () => {
    const factory = manualFactory();
    const client = createReadClient(factory.create);
    client.cancel();
    expect(factory.workers).toHaveLength(0);
  });

  it("rejects with the message of an error reply, and the next read still works", async () => {
    const factory = manualFactory();
    const client = createReadClient(factory.create);
    const pending = client.read([FILE], () => undefined);
    const worker = factory.workers[0] as ManualWorker;
    const request = worker.posted[0] as ReadRequest;
    worker.emit({ requestId: request.requestId, revision: 1, kind: "error", payload: { message: "disk gone" } });
    await expect(pending).rejects.toThrow("disk gone");
    const next = client.read([FILE], () => undefined);
    const again = worker.posted[1] as ReadRequest;
    worker.emit({ requestId: again.requestId, revision: 2, kind: "done", payload: { files: [], binary: [] } });
    await expect(next).resolves.toEqual({ files: [], binary: [] });
  });

  it("rejects and drops the worker when the worker raises an error", async () => {
    const factory = manualFactory();
    const client = createReadClient(factory.create);
    const pending = client.read([FILE], () => undefined);
    const worker = factory.workers[0] as ManualWorker;
    worker.onerror?.(new Error("crashed"));
    await expect(pending).rejects.toThrow("crashed");
    expect(worker.terminated).toBe(true);
    void client.read([FILE], () => undefined).catch(() => undefined);
    expect(factory.workers).toHaveLength(2);
  });

  it("rejects when no worker can be created", async () => {
    const client = createReadClient(() => {
      throw new Error("no worker");
    });
    await expect(client.read([FILE], () => undefined)).rejects.toThrow("no worker");
  });
});

describe("runRead and the inline worker", () => {
  it("answers with progress and done replies that echo requestId and revision", async () => {
    const replies: ReadReply[] = [];
    await runRead(
      { requestId: "r-1", revision: 4, kind: "read", payload: { files: [{ path: "a.ts", file: blob("export {};\n") }], delayMs: 0 } },
      (reply) => replies.push(reply),
    );
    expect(replies.map((reply) => reply.kind)).toEqual(["progress", "done"]);
    expect(replies.every((reply) => reply.requestId === "r-1" && reply.revision === 4)).toBe(true);
    expect(replies[1]).toMatchObject({ payload: { files: [{ path: "a.ts", text: "export {};\n", bytes: 11 }], binary: [] } });
  });

  it("turns a read failure into one error reply and never throws", async () => {
    const broken = { text: () => Promise.reject(new Error("unreadable")), size: 1 } as unknown as Blob;
    const replies: ReadReply[] = [];
    await runRead({ requestId: "r-2", revision: 1, kind: "read", payload: { files: [{ path: "a.ts", file: broken }], delayMs: 0 } }, (reply) => replies.push(reply));
    expect(replies).toEqual([{ requestId: "r-2", revision: 1, kind: "error", payload: { message: "unreadable" } }]);
  });

  it("answers an unknown kind with an error reply", async () => {
    const replies: ReadReply[] = [];
    await runRead({ requestId: "r-3", revision: 1, kind: "other", payload: { files: [], delayMs: 0 } } as unknown as ReadRequest, (reply) => replies.push(reply));
    expect(replies[0]).toMatchObject({ kind: "error" });
  });

  it("the inline worker runs readAll through the client, and terminate stops its replies", async () => {
    const inline = createInlineReadWorkers();
    const client = createReadClient(inline.create);
    const progress: [number, number][] = [];
    const result = await client.read(
      [
        { path: "b.ts", file: blob("export const b = 1;\n") },
        { path: "a.ts", file: blob("import { b } from './b';\n") },
        { path: "bin.ts", file: blob(new Uint8Array([0, 1])) },
      ],
      (d, t) => progress.push([d, t]),
    );
    expect(result.files.map((file) => file.path)).toEqual(["a.ts", "b.ts"]);
    expect(result.binary).toEqual(["bin.ts"]);
    expect(progress[progress.length - 1]).toEqual([3, 3]);

    const slow = client.read([{ path: "a.ts", file: blob("x") }, { path: "b.ts", file: blob("y") }], () => undefined, 50);
    client.cancel();
    await expect(slow).rejects.toMatchObject({ name: "AbortError" });
    expect(inline.workers[0]?.terminated).toBe(true);
    const again = await client.read([{ path: "c.ts", file: blob("z") }], () => undefined);
    expect(again.files.map((file) => file.path)).toEqual(["c.ts"]);
    expect(inline.workers).toHaveLength(2);
  });
});
