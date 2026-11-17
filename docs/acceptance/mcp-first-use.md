# Observation: first use of the hauntmap MCP server (task 6)

Source: the headless session run by the person at this PC on 2026-11-16, 11:11 PM to 11:12 PM, with

```
kiro-cli chat --v3 --no-interactive --trust-workspace --trust-all-tools --model auto "<prompt>"
```

`--trust-all-tools` stands in for the per-call approval, because a headless session cannot answer a prompt. Kiro (this session) did not start the CLI session; it read the saved transcript `S1-mcp-first-use.log` and the prompt `S1-mcp-first-use.txt`, both kept outside the repository in `D:/Projects/kiroween/hauntmap-logs/`. Only the relevant lines are quoted. The CLI that ran the session is recorded as `Kiro CLI 3.3.0 / auto`; the model was `auto`, so the model that answered is not known.

## Prompt

```
Which modules of samples/manor form a dependency loop under the static-value preset? Use the tools of the MCP server named hauntmap. Do not change any file. Do not run git commit.
```

The sentence the task names is the first one. The second sentence was added by the person who ran the session so that the model used the server and changed no file.

## Transcript lines

```
=== S1-mcp-first-use try 1 start 11:11:41 PM
[tool] Tool Load
[tool] status: Completed
[tool] @hauntmap/cycles
[tool] status: InProgress
[tool] status: Completed
[ERROR] [KRS] HTTP 429 requestId=00716ded-be65-493b-aa70-c567c532075f body={"__type":"com.amazon.kiro.runtimeservice#ThrottlingException","message":"Too many requests, please wait before trying again.","reason":"USER_REQUEST_RATE_EXCEEDED"}
Under `static-value`, `samples/manor` has one dependency loop. It contains three modules:

- `src/notifications/receipt.ts`
- `src/orders/checkout.ts`
- `src/payments/charge.ts`

The witness walk is `receipt.ts → checkout.ts → charge.ts → receipt.ts`. All three links are value imports. I got this from the `hauntmap` MCP `cycles` tool with `root: "samples/manor"` and `preset: "static-value"`.
=== S1-mcp-first-use try 1 exit 0 end 11:12:23 PM
```

## What this shows

- The tool call `@hauntmap/cycles` ran and completed. The server `hauntmap` was therefore started and reached by the CLI.
- The three members equal the three members of `public/demo/manor/before/expected.json`.
- Duration of the session: 42 s (11:11:41 PM to 11:12:23 PM).
- The transcript contains one HTTP 429 throttling line from the model service. The tool call completed before it, and the session ended with exit code 0.

## Items marked *verify*

| Item | Result |
| --- | --- |
| Workspace-level `.kiro/settings/mcp.json` is read | Seen. `C:\Users\adria\.kiro\settings\mcp.json` does not exist on this machine, so the only registration of `hauntmap` is the workspace file, and the CLI called the tool. |
| The server starts with the workspace as current directory | Seen. `args` is the relative path `packages/hauntmap-mcp/dist/index.js` and the tool resolved the root `samples/manor`. No `cwd` field or absolute path was needed. |
| Name of the flag that trusts the tools in 3.3.0 | `--trust-all-tools`, as in the command above. `--trust-workspace` was also passed. A narrower flag for one server was not tried. |
| Command that lists MCP servers and their tools in 3.3.0 | Not observed. The transcript shows `Tool Load` and one tool call, not a list. The count of four tools is not taken from this session; `tests/kiro/server.test.ts` checks the four-tool `tools/list` of the server. |
| `cycles` runs without a prompt and `compare` prompts | Not observed. It needs a person in an interactive session. This session used `--trust-all-tools`, so no prompt was shown for any tool. |

## Limits

A dependency loop is a structural fact about static imports under `static-value`. It says nothing about correctness, safety or performance.
