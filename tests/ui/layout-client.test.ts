import { describe, expect, it } from "vitest";
import {
  LayoutCancelled,
  LayoutFailed,
  createLayoutClient,
  type LayoutReply,
  type LayoutRequestMessage,
  type LayoutWorkerLike,
} from "../../src/features/investigation/layoutClient";
import type { LayoutRequest } from "../../src/scene/layout/types";
import { makeLayoutResult } from "./fakeLayoutClient";

class FakeWorker implements LayoutWorkerLike {
  posted: LayoutRequestMessage[] = [];
  terminated = false;
  onmessage: ((event: { data: LayoutReply }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  postMessage(message: LayoutRequestMessage): void {
    this.posted.push(message);
  }
  terminate(): void {
    this.terminated = true;
  }
  reply(data: LayoutReply): void {
    this.onmessage?.({ data });
  }
}

const PAYLOAD: LayoutRequest = {
  layoutVersion: 1,
  engine: "dagre",
  modules: [],
  relations: [],
  boundaries: [],
  expandedWings: [],
  preset: "static-value",
  room: { w: 96, h: 64 },
};

function setup() {
  const workers: FakeWorker[] = [];
  const client = createLayoutClient(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  });
  return { client, workers };
}

describe("layout client", () => {
  it("posts { requestId, revision, kind: 'layout', payload } and resolves on the matching reply", async () => {
    const { client, workers } = setup();
    const promise = client.request(PAYLOAD, 7);
    const message = workers[0]!.posted[0]!;
    expect(message).toEqual({ requestId: "l-7", revision: 7, kind: "layout", payload: PAYLOAD });
    const result = makeLayoutResult("k7");
    workers[0]!.reply({ requestId: "l-7", revision: 7, kind: "result", result });
    await expect(promise).resolves.toEqual(result);
    expect(client.lastResult).toEqual(result);
  });

  it("drops a reply with a stale revision or request ID and keeps waiting", async () => {
    const { client, workers } = setup();
    let settled = false;
    const promise = client.request(PAYLOAD, 3).then(() => (settled = true));
    workers[0]!.reply({ requestId: "l-2", revision: 2, kind: "result", result: makeLayoutResult("old") });
    workers[0]!.reply({ requestId: "l-3", revision: 2, kind: "result", result: makeLayoutResult("old") });
    await Promise.resolve();
    expect(settled).toBe(false);
    workers[0]!.reply({ requestId: "l-3", revision: 3, kind: "result", result: makeLayoutResult("new") });
    await promise;
    expect(client.lastResult?.layoutKey).toBe("new");
  });

  it("a superseding request terminates the busy worker, creates a fresh one and ignores the old worker's reply", async () => {
    const { client, workers } = setup();
    const first = client.request(PAYLOAD, 1);
    const firstOutcome = first.then(
      () => "resolved",
      (error: unknown) => (error instanceof LayoutCancelled ? "cancelled" : "other"),
    );
    const second = client.request(PAYLOAD, 2);
    expect(workers).toHaveLength(2);
    expect(workers[0]!.terminated).toBe(true);
    workers[0]!.reply({ requestId: "l-1", revision: 1, kind: "result", result: makeLayoutResult("stale") });
    workers[1]!.reply({ requestId: "l-2", revision: 2, kind: "result", result: makeLayoutResult("fresh") });
    await expect(second).resolves.toMatchObject({ layoutKey: "fresh" });
    await expect(firstOutcome).resolves.toBe("cancelled");
    expect(client.lastResult?.layoutKey).toBe("fresh");
  });

  it("cancel() terminates the worker, recreates it and rejects the pending request", async () => {
    const { client, workers } = setup();
    const promise = client.request(PAYLOAD, 1);
    client.cancel();
    await expect(promise).rejects.toBeInstanceOf(LayoutCancelled);
    expect(workers[0]!.terminated).toBe(true);
    expect(workers).toHaveLength(2);
    const next = client.request(PAYLOAD, 2);
    expect(workers[1]!.posted).toHaveLength(1);
    workers[1]!.reply({ requestId: "l-2", revision: 2, kind: "result", result: makeLayoutResult("ok") });
    await expect(next).resolves.toMatchObject({ layoutKey: "ok" });
  });

  it("a worker error reply and a worker crash reject with LayoutFailed and leave the last result alone", async () => {
    const { client, workers } = setup();
    const good = client.request(PAYLOAD, 1);
    workers[0]!.reply({ requestId: "l-1", revision: 1, kind: "result", result: makeLayoutResult("good") });
    await good;

    const failing = client.request(PAYLOAD, 2);
    workers[0]!.reply({ requestId: "l-2", revision: 2, kind: "error", message: "bad request" });
    await expect(failing).rejects.toMatchObject({ name: "LayoutFailed", message: "bad request" });
    expect(client.lastResult?.layoutKey).toBe("good");

    const crashing = client.request(PAYLOAD, 3);
    const current = workers[workers.length - 1]!;
    current.onerror?.(new Error("worker crashed"));
    await expect(crashing).rejects.toBeInstanceOf(LayoutFailed);
    expect(client.lastResult?.layoutKey).toBe("good");
    expect(workers[workers.length - 1]).not.toBe(current);
  });
});
