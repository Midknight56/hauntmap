# Observation: the refactoring steering file in a headless session (task 8)

Source: the headless session run by the person at this PC on 2026-11-16, 11:13 PM to 11:15 PM, with

```
kiro-cli chat --v3 --no-interactive --trust-workspace --trust-all-tools --model auto "<prompt>"
```

Kiro (this session) did not start the CLI session. It read the saved transcript `S3-steering.log` and the prompt `S3.txt`, both kept outside the repository in `D:/Projects/kiroween/hauntmap-logs/`. Only the relevant lines are quoted. The CLI is recorded as `Kiro CLI 3.3.0 / auto`; the model was `auto`, so the model that answered is not known. `.kiro/steering/refactoring.md` (`inclusion: always`) was active in the workspace. The transcript does not list the loaded rules, so that the file was in the model's context is inferred from the behavior below, not seen.

## Prompt

```
Add an import of src/orders/summary.ts to src/notifications/receipt.ts in samples/manor and report what changed. Do not run git commit.
```

The first sentence is the one the task names. The second was added by the person who ran the session.

## State of `samples/manor` during this session

`samples/manor/src/notifications/receipt.ts` still held one trailing space on line 1 from an earlier session, because the reset before this session failed. The session therefore started from a sample that differed from `public/demo/manor/before`. The model noticed it and left it alone (transcript line quoted below). `samples/manor` has since been restored with `pnpm demo:reset`.

## Transcript lines

The prompt did not name any tool. The `[tool]` lines of interest, in transcript order:

```
=== S3-steering try 1 start 11:13:57 PM
The working tree already has an uncommitted edit to `receipt.ts`: trailing whitespace on line 1. I didn't make it and I'll leave it alone. Now I'll run the "before" cycles check.
[tool] @hauntmap/cycles
[tool] Replace in File
[tool] @hauntmap/compare
[tool] status: Failed: @hauntmap/compare
[tool] @hauntmap/cycles
**`compare` was not run.** The MCP `compare` tool failed with `compare is not available until snapshot-comparison lands`, and the CLI gave the same error. So I have no relation IDs to list and no `cyclicComponentsBefore → cyclicComponentsAfter` figure.
=== S3-steering try 1 exit 0 end 11:15:18 PM
```

The transcript has U+2192 arrows replaced by a mis-decoded character sequence in the saved file; the arrow is restored above. Other transcript lines (the `Run Command` and `Tool Load` entries, one HTTP 429 throttling line at the start) are not quoted.

## What this shows

- Calls to `hauntmap` tools, in order: `@hauntmap/cycles`, then the edit (`Replace in File`), then `@hauntmap/compare`, then `@hauntmap/cycles`. The model made them without being told to.
- `cycles` ran before the edit, as the steering file asks. `compare` ran after it. A second `cycles` ran after the edit; the file does not ask for that.
- `compare` is the placeholder of task 5 and answered `compare is not available until snapshot-comparison lands`. The observation is about the calls, not the result.
- After the failure the model also tried the CLI (`Run Command` after the failed call; its final message says the CLI gave the same error). The steering file allows the CLI as a fallback and says it must be named as such; the model's message names it.
- The final message states `compare was not run`, the wording the steering file prescribes, and gives no relation IDs. Its "expected from the source alone" remark is labeled as not tool-confirmed.
- The final message reports the same single cyclic component before and after (`receipt.ts`, `checkout.ts`, `charge.ts`) from the two `cycles` calls.
- Duration: 81 s (11:13:57 PM to 11:15:18 PM), exit code 0.
- The model appended a row to `docs/kiro-log.md`. A later message in the transcript reports a hook run with three failures (`kiro-log.test.ts`, `sample-copy.test.ts`, `tools.test.ts`); the last two are caused by the requested edit and the model did not change those tests. The person's wrapper stripped that log row (`stripped .\docs\kiro-log.md`). The session's own row is not part of the repository and its credits are not known.

## Limits

- One session, one model setting (`auto`), one prompt. It shows that the calls occurred in this order once; it does not show that they always do.
- Whether the steering file caused the calls is not isolated: no session without the file was run.
- `--trust-all-tools` was passed, so no approval prompt was shown for any tool.
- A relation in the import graph is a structural fact under `static-value`. It says nothing about correctness, safety or performance.
