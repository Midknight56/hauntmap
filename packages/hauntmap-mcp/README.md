# hauntmap-mcp

The `hauntmap` command line tool and the MCP server of HauntMap. Both are built from the same
analysis code the app runs in its worker (`src/analysis/index.ts`, `src/contracts/`). The package is
private and is not published.

## Build and run

```powershell
pnpm install
pnpm build:mcp                 # writes packages/hauntmap-mcp/dist/index.js and dist/cli.js
pnpm hauntmap analyze haunts/manor --out .hauntmap/live.json   # needs the CLI of task 4c
```

`pnpm hauntmap` without a built `dist/cli.js` prints `hauntmap: the CLI is not built. Run pnpm build:mcp first.` and exits with code 3.

## Versions and licences

Read from `pnpm-lock.yaml` and the installed `package.json` files on 2026-11-16.

| Package | Version | Licence | Use |
| --- | --- | --- | --- |
| `@modelcontextprotocol/sdk` (the MCP TypeScript SDK) | 1.32.2 | MIT | MCP server (task 4b) |
| `esbuild` | 0.28.2 | MIT | bundler |
| `typescript` | 6.0.3 | Apache-2.0 | type check inside `pnpm build:mcp` |
| `@types/node` | 24.19.2 | MIT | Node types |

The SDK brings 82 more packages into the lockfile (zod 4.6.7, ajv 8.20.0, express 5.3.0, hono 4.13.18 and others); each is MIT, ISC, BSD-2-Clause or BSD-3-Clause, read from the installed `package.json` files.

## Bundler

- esbuild 0.28.2, configured in `build.mjs`. It bundles `src/index.ts` and `src/cli.ts` to `dist/index.js` and `dist/cli.js` with every dependency and the analysis code inlined.
- Format: ES module, target `node24`, with a banner that defines `require` for bundled CommonJS dependencies. Node 24 runs the files from a folder that has no `package.json` (it detects the ES module syntax). Copying `dist/` to a temporary folder outside the repository and running `node index.js` there started and exited with code 0 on 2026-11-16 (`tests/kiro/dist-standalone.test.ts` of task 4b repeats this with a `tools/list` request).
- `pnpm-workspace.yaml` sets `allowBuilds: esbuild: false`, which denies esbuild's install script. esbuild runs anyway: `pnpm --filter hauntmap-mcp exec esbuild --version` printed `0.28.2` and `pnpm build:mcp` succeeded on 2026-11-16, because the binary comes from the platform package (`@esbuild/win32-x64`), not from the install script.

## Node

Target: Node 24, from `engines` (`>=24`) of the root `package.json`. Installed on 2026-11-16: `node --version` printed `v24.19.0`.

## Analysis entry points

Read on `main` on 2026-11-16, all exported from `src/analysis/index.ts`:

- `selectSources(files: SourceFile[], rootLabel: string, options: AnalysisOptions): SelectResult`
- `analyze(sourceSet, options, hash: HashFn, onProgress?, selectionDiagnostics?): Promise<Investigation>`, with `HashFn = (text: string) => Promise<string>`
- `findCycles(investigation, preset): CycleReport`
- `trace(investigation, origin, direction, preset): TraceResult` (throws when `origin` is not a module)
- `DEFAULT_ANALYSIS_OPTIONS: AnalysisOptions` (with `preset: "static-value"`)

`compareInvestigations` comes later from `src/analysis/graph/compare.ts` (`snapshot-comparison`).
## Server (task 4b), read from the pinned SDK 1.32.2 on 2026-11-16

- Class: the low-level Server from @modelcontextprotocol/sdk/server/index.js, with capabilities { tools: {} }. The high-level McpServer.registerTool is not used, because it converts input schemas through its own schema library, and 	ools/list must return the schemas of design.md as written.
- Request handlers: setRequestHandler(ListToolsRequestSchema, …) and setRequestHandler(CallToolRequestSchema, …), both from @modelcontextprotocol/sdk/types.js. Transport: StdioServerTransport from @modelcontextprotocol/sdk/server/stdio.js (newline-delimited JSON on stdin and stdout).
- structuredContent is supported (z.record(string, unknown) in the CallToolResult schema), so a success result carries the one-line JSON text item and the same value as structuredContent.
- The error flag is isError: true; the text item then holds {"error":{"code":…,"message":…}}.

## Registration in Kiro CLI 3.3.0 (task 6), observed 2026-11-16

Transcript excerpt: `docs/acceptance/mcp-first-use.md`.

- The workspace file `.kiro/settings/mcp.json` is read. No user-level `mcp.json` exists on the machine, and a headless session called `@hauntmap/cycles`.
- The server starts with the workspace as its current directory: the relative `args` path worked and the tool resolved `haunts/manor`. No `cwd` field was needed.
- The flag that trusts the tools in a headless session is `--trust-all-tools` (with `--trust-workspace`).
- Not observed: the command that lists MCP servers and tools, and whether `cycles` runs without a prompt while `compare` prompts. The second needs a person in an interactive session.
- Run `pnpm build:mcp` before the first session; `dist/` is not committed.