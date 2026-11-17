# H9 session script

This is the script for the recorded Kiro session (acceptance H9 of `kiro-integration`, requirement 9). It is the only file that states the expected calls, lines and counts of the session. The session is run by the person at this PC. Kiro wrote the script and the app spec; Kiro did not run the session when it wrote them.

What the session shows: a Kiro CLI session calls the HauntMap MCP tools, removes one import by editing `haunts/manor`, and the app then shows the same removed relation. The relation is a structural fact about static imports under `static-value`. It is not a statement about correctness, safety or performance.

## Preconditions

Run these from PowerShell in the repository root, in this order.

1. `pnpm build:mcp` builds `packages/hauntmap-mcp/dist`.
2. `pnpm demo:reset` restores `haunts/manor` from `public/demo/manor/before`.
3. `git status --porcelain` prints nothing. If it prints a path, commit or revert it first (the session must start clean, because the checks at the end use `git status`).
4. Start the app with the Vite dev server in a second terminal: `pnpm dev --port 4375 --strictPort`. Port 4375 is free of the preview ports 4373 and 4374 that `playwright.config.ts` uses. The dev server serves `public/demo/live.json` from disk on each request. *Verify* this on Vite 8.3.8 before the run: request `http://localhost:4375/demo/live.json` twice around the hook's write and compare. If the second request returns the old file, use the alternative: stop the dev server, run `pnpm build:devhook`, serve `dist-devhook` with `pnpm preview --outDir dist-devhook --port 4375 --strictPort` between the hook's `analyze:` line and the click, and say so in `recording.md`. The app must be a build with the development hook, because the Playwright script reads `window.__hauntmap`; `pnpm dev` has it.
5. `kiro-cli mcp list` and `kiro-cli mcp status hauntmap` (both exist in 3.4.0) show the server `hauntmap`; the first headless turn lists its tools `analyze`, `cycles`, `who_imports` and `compare` in the transcript. If `hauntmap` is not listed, stop: `.kiro/settings/mcp.json` is changed by the person who runs Kiro, not by Kiro.
6. Make the output folder: `New-Item -ItemType Directory -Force docs/acceptance/h9-session`.

## The prompt

Exactly this text, in one line:

```
In haunts/manor, remove the import of src/orders/checkout.ts from src/notifications/receipt.ts and the single statement that uses it, without adding any import. Report what changed.
```

The steering file `.kiro/steering/refactoring.md` is what makes Kiro call `cycles` before the edit and `compare` after it. The prompt does not name a tool.

## Running the session

```
kiro-cli chat --v3 --no-interactive --trust-workspace --trust-all-tools --model auto "<the prompt>" *> docs/acceptance/h9-session/transcript.md
```

The same command line observed the hooks and the MCP server on 2026-11-16 (`docs/acceptance/hook-analyze-live.md`, `docs/acceptance/mcp-first-use.md`).

Trust setting. In `.kiro/settings/mcp.json` only `cycles` and `who_imports` are in `autoApprove`; `analyze` and `compare` are not. A headless session cannot answer an approval prompt, so a call to `compare` would not run without a trust flag. `--trust-all-tools` also trusts the file edit, which the session needs. A narrower choice is `--trust-tools=@hauntmap,fs_write,fs_read`, which `kiro-cli chat --help` on 3.4.0 documents (`@server` trusts a server's tools); use it only if you check that the edit still goes through. The transcript shows every call either way. Remove secrets from `transcript.md` before it is committed (there should be none).

## Expected sequence of calls and results

1. `cycles` with `root: "haunts/manor"` and `preset: "static-value"`, before any edit. One component, members `src/notifications/receipt.ts`, `src/orders/checkout.ts`, `src/payments/charge.ts`.
2. One edit to `haunts/manor/src/notifications/receipt.ts` only: line 3 (`import { describeOrder } from "../orders/checkout";`) and line 13 (`console.info(describeOrder(input.orderId));`) are deleted. No import is added. No other file under `haunts/` changes.
3. `compare` with `rootBefore: "public/demo/manor/before"` and `rootAfter: "haunts/manor"`. The result has:
   - `removedRelations`: exactly one, with `relationId` `["src/notifications/receipt.ts",["local","src/orders/checkout.ts"],"import","value"]`;
   - `addedRelations`: empty;
   - `changedModules`: `["src/notifications/receipt.ts"]`;
   - `before.relationCount` 72 and `after.relationCount` 71;
   - `cyclicComponentsBefore` 1 and `cyclicComponentsAfter` 0, written `1 → 0`.
4. Kiro's final message ends with the heading `Removed relations` and that one relation ID, the heading `Added relations` with nothing under it, the two labels (`live:public/demo/manor/before`, `live:haunts/manor`) and `1 → 0`, as `.kiro/steering/refactoring.md` requires.
5. When the turn ends, the `analyze-live` hook (`Stop`) runs `pnpm demo:live`. Because `haunts/manor` now differs from the fixture, the CLI runs and rewrites `public/demo/live.json`. Its line `analyze: 40 modules, 71 relations, 1 diagnostics → public/demo/live.json` is in the transcript if the CLI shows hook output; otherwise the rewritten file (write time inside the session window, 71 relation IDs) is the evidence. The `verify-on-stop` hook also runs; it may report that `tests/kiro/sample-copy.test.ts` fails while the sample is edited. That is expected until `pnpm demo:reset`.

If the `compare` result has any other removed or added relation, the session is not the acceptance (requirement 9.2). Fix the defect, run `pnpm demo:reset`, run `git checkout public/demo/live.json`, and run again. Two repair passes at most; after the second failed pass, stop and report the reproducer.

## The app steps (keyboard only)

The Playwright script `tests/kiro/h9/h9-app.spec.ts`, configured by `tests/kiro/h9/playwright.config.ts`, runs against the dev server of step 4 at 1,280 × 720 with video on. It lives outside every `pnpm verify:e2e` project, because it needs the file the hook wrote. Run it right after the session:

```
pnpm exec playwright test --config tests/kiro/h9/playwright.config.ts
```

Set `HAUNTMAP_H9_PORT` if the server is not on 4375. With Tab and Enter only, the script:

1. opens `http://localhost:4375/` and activates `Explore the manor`;
2. activates `Dependency loops` and selects the one loop, so that its witness is the route filter (`snapshot-comparison` 6.3 plays the closing corridor only when the route filter is a witness that holds a removed relation);
3. saves `app-before.png` (the manor, loop selected);
4. activates `Open live snapshot`, which fetches the file the hook wrote;
5. waits for `Live snapshot loaded: live:haunts/manor (40 modules) is the newer snapshot; manor/before is the older one.` and for `activeTweens` to return to 0;
6. saves `app-after.png`, opens the comparison panel with `Compare revisions` and checks that it lists `Removed relations (1)` with the item that begins `src/notifications/receipt.ts imports src/orders/checkout.ts` and `Added relations (0)`;
7. checks that every room drawn before is drawn after with the same rectangle relative to the map center;
8. writes `app-comparison.json` as `{ "comparison": { "result": <compareStore.getState().result> } }` and the video as `app-recording.webm`.

## Stop condition

The run is finished when all three hold: Kiro's final message is printed in `transcript.md`; the hook's `analyze:` line is printed or `public/demo/live.json` was rewritten during the session; the app video is saved.

## Artifacts

Everything goes to `docs/acceptance/h9-session/`:

| File | Content |
| --- | --- |
| `transcript.md` | The headless output as the CLI printed it, tool calls and raw tool results included, secrets removed. |
| `mcp-cycles.json` | The `cycles` result, cut verbatim from the transcript. |
| `mcp-compare.json` | The `compare` result, cut verbatim from the transcript. Exactly one `"relationId"` occurrence. |
| `live.json` | A copy of the `public/demo/live.json` that the hook wrote. |
| `app-comparison.json` | `{ "comparison": { "result": … } }` from the app, written by the script. |
| `app-before.png`, `app-after.png` | Screenshots before the activation and after the closing corridor. |
| `app-recording.webm` | The Playwright video of the app steps. |
| `recording.md` | The file names, the video length, the date, the Kiro CLI version, the model and which server served the app (dev server or rebuilt preview). |
| `credits.md` | The credits the headless output printed, or `not shown in headless output`. |

A side-by-side recording of terminal and app for the video needs a person and is optional; if made, add its path to `recording.md`. The session must never be presented as the acceptance if the import was removed by hand, the `compare` result was edited, or `live.json` came from another root.

## Reset steps

After the artifacts are saved and `public/demo/live.json` equals `docs/acceptance/h9-session/live.json`:

1. `pnpm demo:reset` restores `haunts/manor` (the sample is the "before" state, the committed `live.json` is the "after" state).
2. Run one more headless turn that does not touch the sample, for example `kiro-cli chat --v3 --no-interactive --trust-workspace --model auto "Reply with the word ready and change nothing."`. The hook prints `demo:live: skipped (haunts/manor is identical to public/demo/manor/before)` or changes no file.
3. `git status --porcelain haunts/ public/demo/live.json` prints nothing after the file is committed.
4. Stop the dev server.

Failure path: `pnpm demo:reset`, then `git checkout public/demo/live.json`, then run again.
