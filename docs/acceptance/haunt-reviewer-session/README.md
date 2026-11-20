# Proof: the haunt-reviewer custom agent in one headless session

Date: 2026-11-20. Tool: Kiro CLI 3.5.0, model `auto`, harness V3 (`--v3`). Agent file: `.kiro/agents/haunt-reviewer.json`. Files here: `session-output.txt` (the review run), `write-refusal-output.txt` (a second run that asks the agent to write and run a shell command) and this page. Both outputs are the raw session text, minus the five lines that PowerShell adds around the first line of stderr.

## Validation

```powershell
kiro-cli agent validate --path .kiro/agents/haunt-reviewer.json
```

Printed nothing, exit code 0. (`kiro-cli agent validate` takes `--path`.) As a control, the same command on a file `{"name": 5, "tools": "read"}` printed `Error: Json supplied at ... is invalid: invalid type: integer `5`, expected a string at line 1 column 10` and exited 1, so a silent exit 0 is a pass and not a skipped check. `kiro-cli agent list` in the repository lists `haunt-reviewer` as a Workspace agent in v3 format.

## The review run

```powershell
kiro-cli chat --v3 --agent haunt-reviewer --no-interactive --trust-workspace --trust-tools="fs_read,@hauntmap" "Review the change from public/demo/manor/before to public/demo/manor/after for new or closed dependency loops."
```

Exit code 0, run from the repository root.

### Tool calls seen

Lines of `session-output.txt` that name a tool:

```
[tool] @hauntmap/cycles
[tool] @hauntmap/cycles
[tool] @hauntmap/compare
[tool] Grep Search
```

Two `cycles` calls and one `compare` call, in that order, all completed, then one read only search of the files for the import line. The output does not print the arguments of the calls; the answer names the before and after folders. No write tool and no shell tool appears.

### What the agent reported

- Loops under `static-value`: `1 to 0` (`cyclicComponentsBefore → cyclicComponentsAfter`).
- Closed loop members: `src/notifications/receipt.ts`, `src/orders/checkout.ts`, `src/payments/charge.ts`, with the witness `receipt.ts → checkout.ts → charge.ts → receipt.ts`.
- Import line: `public/demo/manor/before/src/notifications/receipt.ts`, line 3, `import { describeOrder } from "../orders/checkout";`. In the after copy, line 3 is `import { summarizeOrder } from "../orders/summary";`.
- Removed relation: `["src/notifications/receipt.ts",["local","src/orders/checkout.ts"],"import","value"]`.
- Added relation: `["src/notifications/receipt.ts",["local","src/orders/summary.ts"],"import","value"]`.
- New loops: none. Changed modules: `src/notifications/receipt.ts` and `src/orders/checkout.ts`.

These match `.kiro/steering/analysis.md` (one removed relation, one added relation, two changed modules, one cyclic component before and none after). The match was checked by reading.

## The write and shell refusal

```powershell
kiro-cli chat --v3 --agent haunt-reviewer --no-interactive --trust-workspace --trust-all-tools "Create a file named reviewer-write-test.txt in the repository root containing the word hello, and run the command git status in the shell."
```

Even with `--trust-all-tools`, the agent answered `I can't do either of those. This reviewer role has file reads and the four HauntMap tools ... It has no way to write files or run shell commands`. `reviewer-write-test.txt` was not created (`Test-Path` printed `False`). This shows the tool list of the agent file is enforced in this session. It is one run of one prompt.

## Other things in the output

At the end of each run, the `Stop` hooks of `.kiro/hooks` ran `pnpm verify` and the agent received its output. The hook output is part of the saved text after the review. That is the observation used in `docs/acceptance/hook-verify-on-stop.md`. The line `hauntmap-mcp: output failed validation: sourceLabel must be a string` in that output is printed by an existing test of the MCP package that expects it (see the log row of intake task 15). At the time of these runs `pnpm verify` was red on purpose, because `tests/kiro/extensions.test.ts` was written first and not yet satisfied (the agent's text names two of its failing cases).

## Limits

One review of one pair of folders, by one model run. It shows that the agent loads, calls HauntMap's tools in the order its prompt gives, and reports the removed relation and loops 1 to 0. A removed or added relation is a structural fact about static imports, not a claim about correctness, safety or performance.
