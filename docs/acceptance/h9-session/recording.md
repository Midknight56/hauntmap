# H9 session recording notes

Date of the headless session: 2026-11-17, 10:48 AM, run by the person. Tool: Kiro CLI 3.4.0, model `auto`. Surface: Kiro CLI.

## How `mcp-cycles.json` and `mcp-compare.json` were made

These two files are NOT cut from `transcript.md`. The headless output shows the tool names (`@hauntmap/cycles`, `@hauntmap/compare`) and the agent's summary, but not the raw tool results. They were written afterwards, on 2026-11-17, by running the same tool code on the same inputs:

| File | Command | Input |
| --- | --- | --- |
| `mcp-cycles.json` | `cyclesTool` of `packages/hauntmap-mcp/src/tools.ts`, called in-process by a one-off script (removed afterwards), with `static-value`. The command line tool has no `cycles` command, so this file did not go through the CLI. | `public/demo/manor/before` |
| `mcp-compare.json` | `pnpm hauntmap compare public/demo/manor/before .hauntmap/manor-after-removal --out docs/acceptance/h9-session/mcp-compare.json` (the CLI; printed `compare: 1 removed, 0 added, 1 changed modules`) | `public/demo/manor/before` and `.hauntmap/manor-after-removal`, a copy of the sample with the import of `../orders/checkout` and its one use removed by `makeManorAfterRemoval` (`tests/kiro/generators.ts`) |

`.hauntmap/manor-after-removal` is a regeneration of the session's edit, not the session's own `samples/manor`: the session edited `samples/manor/src/notifications/receipt.ts`, and `pnpm demo:reset` has restored the sample since. The removed relation, the empty added list and the one changed module are the same as in the transcript's summary and in `app-comparison.json`; `tests/mcp-agreement.test.ts` (case `row 27 recorded`) compares the relations of `mcp-compare.json` with `app-comparison.json`.

## Files

| File | What it is |
| --- | --- |
| `transcript.md` | Headless Kiro CLI output of the edit turn, as the person saved it. |
| `live.json` | The snapshot of the session; byte-equal to `public/demo/live.json`. |
| `mcp-cycles.json`, `mcp-compare.json` | See above. |
| `app-before.png`, `app-after.png`, `app-comparison.json`, `app-recording.webm` | Output of `tests/kiro/h9/h9-app.spec.ts` (headless Chromium 1.65.1, 1,280 x 720, keyboard only, video on), run against the Vite dev server on its own port in the theme pass of 2026-11-17. The map text-size change of the same day (every drawn text at least 11 CSS px) came after that run: these four files show the map as it drew before that change, and they were not re-recorded. |
| `credits.md` | What the headless output shows about credits. |

Video length: not measured. No side-by-side recording of terminal and app was made; that needs a person and is optional.

The app was served by the Vite dev server, not by a rebuilt preview.

## Limits

A removed relation is a structural fact about static imports under `static-value`. It is not a statement about runtime behaviour, correctness or safety. The tool was not tested with outside users.
