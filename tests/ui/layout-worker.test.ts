import { describe, expect, it } from "vitest";
import type { LayoutReply, LayoutRequestMessage } from "../../src/features/investigation/layoutClient";
import { runLayoutRequest } from "../../src/workers/layout.worker";
import { fixture } from "./fixtureFiles";
import { requestFor } from "./layoutRequests";

async function run(message: unknown): Promise<LayoutReply[]> {
  const replies: LayoutReply[] = [];
  await runLayoutRequest(message as LayoutRequestMessage, (reply) => replies.push(reply));
  return replies;
}

describe("layout worker entry", () => {
  it("replies with a result that echoes requestId and revision", async () => {
    const payload = requestFor(fixture("two-wings"), "all");
    const replies = await run({ requestId: "l-7", revision: 7, kind: "layout", payload });
    expect(replies).toHaveLength(1);
    const reply = replies[0]!;
    expect(reply).toMatchObject({ requestId: "l-7", revision: 7, kind: "result" });
    if (reply.kind !== "result") throw new Error("expected a result");
    expect(reply.result.rooms).toHaveLength(5);
    expect(reply.result.layoutKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it("answers a bad payload with an error reply and does not throw", async () => {
    for (const payload of [null, {}, { layoutVersion: 2 }, { ...requestFor(fixture("triad")), modules: "no" }, { ...requestFor(fixture("triad")), engine: "elk" }]) {
      const replies = await run({ requestId: "l-1", revision: 1, kind: "layout", payload });
      expect(replies).toHaveLength(1);
      expect(replies[0]).toMatchObject({ requestId: "l-1", revision: 1, kind: "error" });
      expect((replies[0] as { message: string }).message.length).toBeGreaterThan(0);
    }
  });

  it("answers an unknown kind with an error reply", async () => {
    const replies = await run({ requestId: "l-2", revision: 2, kind: "analyze", payload: {} });
    expect(replies[0]).toMatchObject({ requestId: "l-2", revision: 2, kind: "error" });
  });

  it("answers a message that is not an object with an error reply", async () => {
    const replies = await run(undefined);
    expect(replies[0]).toMatchObject({ kind: "error" });
  });

  it("importing the module in Node registers no listener", () => {
    expect((globalThis as { onmessage?: unknown }).onmessage).toBeUndefined();
  });
});
