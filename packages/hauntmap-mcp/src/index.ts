import { realpath } from "node:fs/promises";
import process from "node:process";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { errorText } from "./errors";
import type { ToolResult } from "./errors";
import { analyzeTool, compareTool, createContext, cyclesTool, whoImportsTool } from "./tools";
import type { ToolContext } from "./tools";

// The MCP server `hauntmap` over stdio. The low-level `Server` class answers tools/list and
// tools/call itself, so that the input schemas below reach the client as written (the high-level
// registerTool converts schemas of its own library). stdout belongs to the transport; every
// diagnostic goes to stderr with the prefix `hauntmap-mcp: `.

const VERSION = "0.0.0";

const PRESET_SCHEMA = { type: "string", enum: ["static-value", "type-inclusive", "dynamic-inclusive"], default: "static-value" };
const ROOT_SCHEMA = { type: "string", description: "Directory relative to the workspace root, e.g. haunts/manor" };

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run(ctx: ToolContext, args: unknown): Promise<ToolResult<unknown>>;
}

const TOOLS: ToolDefinition[] = [
  {
    name: "analyze",
    description: "Analyze the JavaScript/TypeScript import graph of a directory inside this workspace and return HauntMap's versioned investigation JSON (source text omitted).",
    inputSchema: { type: "object", required: ["root"], properties: { root: ROOT_SCHEMA, preset: PRESET_SCHEMA }, additionalProperties: false },
    run: analyzeTool,
  },
  {
    name: "cycles",
    description: "Return the dependency cycles (strongly connected components with one witness each) of a directory under a preset.",
    inputSchema: { type: "object", required: ["root"], properties: { root: ROOT_SCHEMA, preset: PRESET_SCHEMA }, additionalProperties: false },
    run: cyclesTool,
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
    run: whoImportsTool,
  },
  {
    name: "compare",
    description: "Compare two directories' import graphs by structural relation ID and return the removed and added relations, changed modules and cycle counts.",
    inputSchema: { type: "object", required: ["rootBefore", "rootAfter"], properties: { rootBefore: { type: "string" }, rootAfter: { type: "string" } }, additionalProperties: false },
    run: compareTool,
  },
];

export function toolList(): { name: string; description: string; inputSchema: Record<string, unknown> }[] {
  return TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

export type CallResult =
  | { content: { type: "text"; text: string }[]; structuredContent: Record<string, unknown> }
  | { content: { type: "text"; text: string }[]; isError: true };

export async function callTool(ctx: ToolContext, name: string, args: unknown): Promise<CallResult> {
  const tool = TOOLS.find((candidate) => candidate.name === name);
  if (tool === undefined) return { content: [{ type: "text", text: errorText({ code: "invalid-arguments", message: `Unknown tool "${name}".` }) }], isError: true };
  let result: ToolResult<unknown>;
  try {
    result = await tool.run(ctx, args);
  } catch (thrown) {
    ctx.log(`${name} threw: ${thrown instanceof Error ? thrown.message : String(thrown)}`);
    result = { ok: false, error: { code: "analysis-failed", message: `Tool "${name}" failed.` } };
  }
  if (!result.ok) return { content: [{ type: "text", text: errorText(result.error) }], isError: true };
  return { content: [{ type: "text", text: JSON.stringify(result.value) }], structuredContent: result.value as Record<string, unknown> };
}

async function main(): Promise<void> {
  const ctx = createContext(await realpath(process.cwd()));
  const server = new Server({ name: "hauntmap", version: VERSION }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolList() }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => callTool(ctx, request.params.name, request.params.arguments));

  const stop = (): void => {
    void server.close().finally(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  process.on("unhandledRejection", (reason) => {
    process.stderr.write(`hauntmap-mcp: ${reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason)}\n`);
    process.exit(1);
  });
  await server.connect(new StdioServerTransport());
}

main().catch((thrown: unknown) => {
  process.stderr.write(`hauntmap-mcp: ${thrown instanceof Error ? `${thrown.name}: ${thrown.message}` : String(thrown)}\n`);
  process.exit(1);
});
