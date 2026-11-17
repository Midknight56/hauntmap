import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { expectedManor, REPO } from "./appPath";
import { RpcProcess } from "./rpc";

// Requirement 3.1, 3.6 and 3.8: the built server over stdio. Needs packages/hauntmap-mcp/dist
// (tests/kiro/globalSetup.ts builds it when it is older than the sources).

const SERVER = join(REPO, "packages", "hauntmap-mcp", "dist", "index.js");

const PRESET_SCHEMA = { type: "string", enum: ["static-value", "type-inclusive", "dynamic-inclusive"], default: "static-value" };
const ROOT_SCHEMA = { type: "string", description: "Directory relative to the workspace root, e.g. haunts/manor" };
const TOOLS = [
  {
    name: "analyze",
    description: "Analyze the JavaScript/TypeScript import graph of a directory inside this workspace and return HauntMap's versioned investigation JSON (source text omitted).",
    inputSchema: { type: "object", required: ["root"], properties: { root: ROOT_SCHEMA, preset: PRESET_SCHEMA }, additionalProperties: false },
  },
  {
    name: "cycles",
    description: "Return the dependency cycles (strongly connected components with one witness each) of a directory under a preset.",
    inputSchema: { type: "object", required: ["root"], properties: { root: ROOT_SCHEMA, preset: PRESET_SCHEMA }, additionalProperties: false },
  },
  {
    name: "who_imports",
    description: "Return the direct and indirect importers of a module, with a shortest path for each.",
    inputSchema: {
      type: "object",
      required: ["root", "module"],
      properties: { root: ROOT_SCHEMA, preset: PRESET_SCHEMA, module: { type: "string", description: "Module ID relative to the root, e.g. src/orders/checkout.ts" } },
      additionalProperties: false,
    },
  },
  {
    name: "compare",
    description: "Compare two directories' import graphs by structural relation ID and return the removed and added relations, changed modules and cycle counts.",
    inputSchema: { type: "object", required: ["rootBefore", "rootAfter"], properties: { rootBefore: { type: "string" }, rootAfter: { type: "string" } }, additionalProperties: false },
  },
];

let server: RpcProcess | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

async function start(): Promise<RpcProcess> {
  server = new RpcProcess(SERVER, REPO);
  await server.initialize();
  return server;
}

interface ToolCallResult {
  content: { type: string; text: string }[];
  isError?: boolean;
  structuredContent?: unknown;
}

async function call(rpc: RpcProcess, name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
  const response = await rpc.request("tools/call", { name, arguments: args });
  if (response.result === undefined) throw new Error(`tools/call ${name} failed: ${JSON.stringify(response.error)}`);
  return response.result as unknown as ToolCallResult;
}

describe("server (3.1)", () => {
  it("identifies itself as hauntmap and lists the four tools with the schemas and descriptions of the design, verbatim", async () => {
    const rpc = new RpcProcess(SERVER, REPO);
    server = rpc;
    const init = await rpc.initialize();
    expect((init.result?.serverInfo as { name: string }).name).toBe("hauntmap");
    const listed = await rpc.request("tools/list");
    expect(listed.result?.tools).toEqual(TOOLS);
  });

  it("writes nothing but protocol frames to stdout", async () => {
    const rpc = await start();
    await rpc.request("tools/list");
    await call(rpc, "cycles", { root: "haunts/manor" });
    expect(rpc.stdoutLines.length).toBeGreaterThanOrEqual(3);
    for (const line of rpc.stdoutLines) {
      const frame = JSON.parse(line) as { jsonrpc?: string };
      expect(frame.jsonrpc, line).toBe("2.0");
    }
  });
});

describe("tool calls over the transport (3.3, 3.6)", () => {
  it("cycles round-trips as one JSON text item", async () => {
    const rpc = await start();
    const result = await call(rpc, "cycles", { root: "haunts/manor", preset: "static-value" });
    expect(result.isError).not.toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.type).toBe("text");
    expect(result.content[0]?.text).not.toContain("\n");
    const report = JSON.parse(result.content[0]?.text ?? "") as { preset: string; components: { members: string[] }[] };
    expect(report.preset).toBe("static-value");
    expect(report.components.map((c) => c.members)).toEqual(expectedManor().cycles["static-value"].map((c) => c.members));
    if (result.structuredContent !== undefined) expect(result.structuredContent).toEqual(report);
  });

  it("an error result carries the error flag and the JSON error", async () => {
    const rpc = await start();
    const result = await call(rpc, "who_imports", { root: "haunts/manor", module: "src/nope.ts" });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]?.text ?? "")).toEqual({
      error: {
        code: "module-not-found",
        message: 'Module "src/nope.ts" is not in the analysis of "haunts/manor"; module IDs are paths relative to the root, such as src/orders/checkout.ts.',
      },
    });
  });

  it("an error for a root outside the workspace names the root and no path of the host", async () => {
    const rpc = await start();
    const result = await call(rpc, "analyze", { root: ".." });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0]?.text ?? "") as { error: { code: string } };
    expect(parsed.error.code).toBe("root-outside-workspace");
  });

  it("compare is registered and answers (placeholder or real)", async () => {
    const rpc = await start();
    const result = await call(rpc, "compare", { rootBefore: "public/demo/manor/before", rootAfter: "haunts/manor" });
    expect(result.content[0]?.type).toBe("text");
  });
});

describe("response time (3.8)", () => {
  it("prints the analyze response time for haunts/manor", async () => {
    const rpc = await start();
    const started = performance.now();
    const result = await call(rpc, "analyze", { root: "haunts/manor" });
    const elapsed = performance.now() - started;
    expect(result.isError).not.toBe(true);
    console.info(`analyze haunts/manor through the server: ${elapsed.toFixed(0)} ms (target 2000 ms, not a claim until recorded in docs/performance.md)`);
  });
});
