# Design: kiro-extensions

## Files

| Path | Content |
| --- | --- |
| `power/hauntmap/plugin.json`, `mcp.json`, `skills/refactor-loops/SKILL.md`, `README.md` | The power. |
| `.kiro/agents/haunt-reviewer.json` | The custom agent. |
| `tests/kiro/extensions.test.ts` | The checks of requirement 4.1. |
| `docs/acceptance/power-session/`, `haunt-reviewer-session/`, `hook-verify-on-stop.md` | Proof. |
| `README.md`, `docs/write-up.md`, `docs/kiro-log.md` | Claims, last. |

No file under `src/`, `haunts/`, `public/demo/live.json`, `.kiro/settings/` or `.design-ref/` changes. The hook files are not edited unless the proof shows a defect.

## Power

Format from `powers_create.md`. The name is `hauntmap`; Kiro namespaces the server as `power-hauntmap-<server>`. Keywords are what a person says about loops: `dependency cycle`, `circular import`, `import loop`, `who imports`, `refactor imports`, `hauntmap`.

The server reads its workspace from its current directory and refuses roots outside it, so the session folder is the workspace and the server file can live anywhere. The path to `dist/index.js` is the open point: `mcp.json` may not hold an absolute path of this machine. Task 2 reads how the installed power runs its server (copy or reference, working directory, variable expansion in `args`) and picks the one form that works from a clone: an environment variable `HAUNTMAP_MCP_DIST` that the README tells the user to set, or a relative path if Kiro keeps the power in place. The choice and the observation are written in `power/hauntmap/README.md`.

## Agent

JSON, fields from `custom-agents.md`: `name`, `description`, `tools`, `includeMcpJson`, `includePowers`, `prompt`. The tools are `read` and `@hauntmap/analyze`, `@hauntmap/cycles`, `@hauntmap/who_imports`, `@hauntmap/compare` (the full selector form that CLI V3 wants). `includePowers` is false so the proof does not depend on the power. The workspace `.kiro/settings/mcp.json` supplies the server `hauntmap`.

## Proof sessions

All sessions are headless and name the harness (`--v3`), per `cli_agent-harness.md`. Output goes to a file with `*>`; the saved copy is the raw output with ANSI codes removed and the command above it. The tool calls seen are the lines of the output that name a tool, copied under their own heading. If the output shows no tool call, the proof says that and the claim is not made.

## Hook

`kiro-cli chat --v3 --no-interactive` with a one line prompt, run in this checkout. The hook is `pnpm verify`, which prints `$ pnpm typecheck && ...`; the proof is that line or another line only the hook produces, in the session output, or a file the hook wrote. `PostFileSave` is an editor event; unless a headless session shows it, the README says it was not seen to run.
