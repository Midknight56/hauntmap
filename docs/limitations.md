# Limitations

## Comparison (snapshot-comparison)

Comparison accepts the bundled manor pair and the live snapshot; comparing two arbitrary folders is not available in this build.

The export feature is not built.

A comparison is a structural comparison of relation IDs and source hashes under the documented resolver subset. A removed or added relation is a change in the import graph found in the source; it is not a claim about behaviour, safety or correctness.

## Kiro integration (kiro-integration)

Every `*verify*` mark of the `kiro-integration` spec, `.kiro/hooks/README.md` and `packages/hauntmap-mcp/README.md` is either settled in a log row or an acceptance file, or listed here with its consequence. Settled: the SDK class and request handler names, the error flag and `structuredContent` (`packages/hauntmap-mcp/README.md`, task 4b); the `--filter` syntax of `build:mcp` (the script runs); the headless trust flags of Kiro CLI 3.3.0 (`docs/acceptance/mcp-first-use.md`); the `Stop` trigger and the `analyze-live` side effect (`docs/acceptance/hook-analyze-live.md`).

Not settled:

- The hook field `version: "v1"`, the `timeout` unit (seconds is assumed) and the `matcher` form with Windows path separators were not observed. Consequence: the hook files follow the standalone format the revision of 2026-11-16 states; if Kiro reads a field differently, a hook may not fire, and nothing in this repository depends on it firing except the recorded demo.
- The order of the two `Stop` hooks (`verify-on-stop`, `analyze-live`) was not observed. Consequence: none for correctness, because neither reads what the other writes.
- The shell that runs a hook command and whether it starts in the workspace root were not read from output. Consequence: the commands are plain `pnpm <script>` and the `analyze:` line of the hook was not seen; the command itself was run by hand from PowerShell.
- The save trigger (`PostFileSave`) was not observed to fire from an agent write, and its entry was removed from `analyze-live.json`. Consequence: the live snapshot is written only when a turn ends.
- The Kiro IDE was not observed to read standalone `.kiro/hooks/*.json` files. Consequence: no claim is made about the IDE.
- Whether `compare` prompts for approval in an interactive session was not observed (the headless runs trusted all tools). Consequence: the per-call approval is configured, not observed.
- The `analyze:` line and the duration of the hook in the recorded H9 session are not in the headless transcript. Consequence: the committed `public/demo/live.json` is byte-equal to `docs/acceptance/h9-session/live.json`, and `tests/kiro/live-json.test.ts` checks it; the hook's own output is not shown.
- The raw results of `cycles` and `compare` in the H9 session are not in the headless transcript. Consequence: `mcp-cycles.json` and `mcp-compare.json` were regenerated from the same tool code on the same inputs and are labelled so in `docs/acceptance/h9-session/recording.md`.
- The final headless turn of tasks 12 and 14 (the `identical` skip line) is run by the person. Consequence: until it is logged, the skip rule is checked by `tests/kiro/demo-live.test.ts` and by a manual run of the command, not by a Kiro turn.
- No deployed URL exists in this checkout, so the fetch of `<deployed URL>/demo/live.json` was not run.