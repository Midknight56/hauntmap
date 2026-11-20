# Requirements: kiro-extensions

Three Kiro features that the judges ask about: a power, a custom agent and a hook. Each claim in the README must point at a saved proof file. `.kiro/steering/revision-2026-11-16.md` wins where this file differs. Kiro's own pages, saved on 2026-11-20 in `D:/Projects/kiroween/hauntmap-logs/kiro-docs-2026-11-20/`, win over memory.

## 1. Power

1.1 `power/hauntmap/` is a power in the Agent Plugins format: `plugin.json` (with `$schema`, `name`, `version`, `description`, `author`, `keywords`), `mcp.json` and `skills/<name>/SKILL.md`.
1.2 `mcp.json` starts the MCP server of `packages/hauntmap-mcp` (`analyze`, `cycles`, `who_imports`, `compare`). It works from a clone of this repository after `pnpm install` and `pnpm build:mcp`, with no absolute path of this machine in it.
1.3 The skill holds the refactor rule of `.kiro/steering/refactoring.md`: call `cycles` before an import change, `compare` after it, and report the removed and added relations. It says that the result is a structural fact, not a correctness claim.
1.4 `power/hauntmap/README.md` says how to install (`kiro-cli powers install <path>`), what it needs (Node 24, `pnpm install`, `pnpm build:mcp`) and how to uninstall.
1.5 Proof: the power is installed with `kiro-cli powers install`, one headless session (`kiro-cli chat --no-interactive`) in a throwaway copy of `haunts/manor` under `D:/Projects/kiroween/hauntmap-logs/power-run/` asks in plain words for the dependency loops, and the output and the tool calls seen are saved in `docs/acceptance/power-session/`. The power is then uninstalled with `kiro-cli powers uninstall`, and the proof says so.

## 2. Custom agent

2.1 `.kiro/agents/haunt-reviewer.json` reviews a change for new or closed dependency loops.
2.2 Its tools are file reads and the four HauntMap MCP tools only. It has no write tool and no shell tool, and its configuration has no rule that allows either.
2.3 Its prompt says: call `cycles` on the before folder and the after folder, then `compare`, and report each loop change with the import line.
2.4 `kiro-cli agent validate` accepts the file.
2.5 Proof: one headless run (`kiro-cli chat --agent haunt-reviewer --no-interactive`) on `public/demo/manor/before` and `public/demo/manor/after`, saved in `docs/acceptance/haunt-reviewer-session/`. The output reports the removed relation and loops 1 to 0.

## 3. Hook

3.1 The `verify-on-stop` hook of `.kiro/hooks/` fires in one headless CLI session. Proof is its own output or a file only it writes, saved in `docs/acceptance/hook-verify-on-stop.md`.
3.2 `typecheck-on-save` is cited as run only if it was seen to run. If it can fire only in the Kiro IDE, the README says so.

## 4. Tests and claims

4.1 `tests/kiro/extensions.test.ts` checks that `plugin.json`, `mcp.json` and the agent file parse; that every tool they name exists in `packages/hauntmap-mcp/src/index.ts`; that the agent's tool list has no write or shell tool; and that the README claims point at proof files that exist.
4.2 Every text a user sees is in plain words, with no dash between words. A README line that says something ran names the proof file. A step that failed is written with its error text and not claimed.
4.3 `README.md` (Custom agents, Kiro powers, Agent hooks, Judging criteria), `docs/write-up.md` and `docs/kiro-log.md` (one row per task) are updated last.
