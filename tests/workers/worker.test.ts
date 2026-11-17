import { createHash } from "node:crypto";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyze } from "../../src/analysis/parser/analyze";
import { selectSources } from "../../src/analysis/parser/select";
import { DEFAULT_ANALYSIS_OPTIONS } from "../../src/contracts/options";
import type { Investigation, SourceFile } from "../../src/contracts/types";
import { runRequest } from "../../src/workers/analysis.worker";
import { createAnalysisClient, type WorkerLike, type WorkerReply, type WorkerRequest } from "../../src/workers/client";
import { FIXTURES_ROOT, loadFixtureFiles } from "../fixtures/load";

const nodeHash = (text: string): Promise<string> => Promise.resolve(createHash("sha256").update(text, "utf8").digest("hex"));

async function collect(request: WorkerRequest): Promise<WorkerReply[]> {
  const replies: WorkerReply[] = [];
  await runRequest(request, (reply) => replies.push(reply));
  return replies;
}

function envelope(files: SourceFile[], rootLabel: string, options = DEFAULT_ANALYSIS_OPTIONS): WorkerRequest {
  return { requestId: "r1", revision: 7, kind: "analyze", payload: { files, rootLabel, options } };
}

describe("the analysis worker entry", () => {
  it("answers with progress for each file and one result, all echoing requestId and revision", async () => {
    const files = loadFixtureFiles(join(FIXTURES_ROOT, "two-cycles"));
    const replies = await collect(envelope(files, "two-cycles"));
    expect(replies.every((reply) => reply.requestId === "r1" && reply.revision === 7)).toBe(true);
    const progress = replies.filter((reply) => reply.kind === "progress");
    expect(progress.map((reply) => (reply.kind === "progress" ? reply.done : -1))).toEqual([1, 2, 3, 4, 5, 6]);
    expect(replies[replies.length - 1]?.kind).toBe("result");
    expect(replies.filter((reply) => reply.kind === "result")).toHaveLength(1);
  });

  it("gives the same investigation, byte for byte, as selectSources then analyze with a node:crypto hash", async () => {
    const files = loadFixtureFiles(join(FIXTURES_ROOT, "case"));
    const selected = selectSources(files, "case", DEFAULT_ANALYSIS_OPTIONS);
    if (!selected.ok) throw new Error("selection failed");
    const direct = await analyze(selected.sourceSet, DEFAULT_ANALYSIS_OPTIONS, nodeHash, undefined, selected.diagnostics);
    const replies = await collect(envelope(files, "case"));
    const result = replies.find((reply) => reply.kind === "result");
    expect(result?.kind === "result" ? JSON.stringify(result.investigation) : "").toBe(JSON.stringify(direct));
    expect(direct.diagnostics.some((d) => d.code === "case-collision")).toBe(true);
  });

  it("answers with an error and the cap-reached diagnostic when selectSources returns ok: false", async () => {
    const files = loadFixtureFiles(join(FIXTURES_ROOT, "chain"));
    const replies = await collect(envelope(files, "chain", { ...DEFAULT_ANALYSIS_OPTIONS, maxFiles: 2 }));
    expect(replies).toHaveLength(1);
    const reply = replies[0];
    expect(reply?.kind).toBe("error");
    if (reply?.kind !== "error") throw new Error("not an error reply");
    expect(reply.diagnostics.map((d) => d.code)).toEqual(["cap-reached"]);
    expect(reply.message).toContain("cap-reached");
  });

  it("turns any thrown error into an error reply", async () => {
    const broken = { requestId: "r2", revision: 1, kind: "analyze", payload: null } as unknown as WorkerRequest;
    const replies = await collect(broken);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({ requestId: "r2", revision: 1, kind: "error", diagnostics: [] });
  });

  it("answers an unknown kind with an error reply", async () => {
    const odd = { requestId: "r3", revision: 2, kind: "layout", payload: {} } as unknown as WorkerRequest;
    const replies = await collect(odd);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({ requestId: "r3", revision: 2, kind: "error" });
  });

  it("works through the client when a fake worker runs runRequest", async () => {
    const client = createAnalysisClient((): WorkerLike => {
      const worker: WorkerLike = {
        onmessage: null,
        onerror: null,
        terminate: () => undefined,
        postMessage: (message) => {
          void runRequest(message, (reply) => worker.onmessage?.({ data: reply }));
        },
      };
      return worker;
    });
    const progress: number[] = [];
    const result: Investigation = await client.analyze(
      { files: loadFixtureFiles(join(FIXTURES_ROOT, "diamond")), rootLabel: "diamond", options: DEFAULT_ANALYSIS_OPTIONS },
      (done) => progress.push(done),
    );
    expect(result.modules.map((m) => m.id)).toEqual(["base.ts", "left.ts", "right.ts", "top.ts"]);
    expect(progress).toEqual([1, 2, 3, 4]);
    expect(client.lastInvestigation).toBe(result);
  });
});
