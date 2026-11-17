# Observation: analyze-live

Hook file: `.kiro/hooks/analyze-live.json`. It now holds one entry, `analyze-live` (trigger `Stop`, command `pnpm demo:live`, timeout 120). The entry `analyze-live-on-save` (trigger `PostFileSave`) was not observed and is deleted (Requirement 6.2).

Source: the headless session run by the person at this PC on 2026-11-16, with

```
kiro-cli chat --v3 --no-interactive --trust-workspace --trust-all-tools --model auto "<prompt>"
```

Kiro (this session) did not start it. It read the saved transcript `S2-hook-analyze-live.log`, the prompt `S2.txt` and the file copy `S2-live.json`, kept in `D:/Projects/kiroween/hauntmap-logs/`. Only the relevant lines are quoted. The transcript was not redirected to `.hauntmap/hook-analyze-live.txt`, as the task wrote; the person's log file stands in for it.

## Prompt

```
Add one trailing space to the end of line 1 of samples/manor/src/notifications/receipt.ts and change nothing else. Do not run any command. Do not run git commit. Then end your turn with one short sentence.
```

## Transcript lines

```
=== S2-hook-analyze-live try 1 start 11:12:35 PM
[tool] Read File
[tool] Replace in File
[tool] status: Completed
I added one trailing space to line 1 of `samples/manor/src/notifications/receipt.ts`. I changed nothing else, ran no commands, and made no commit.
The edit is in place, and it is the cause of the failing check. `tests/kiro/sample-copy.test.ts` requires `samples/manor` to be byte-identical to `public/demo/manor/before`, and the added space on line 1 of `receipt.ts` breaks that. I left the edit as you asked. `pnpm demo:reset` restores the sample, or I can remove the space if you want.
=== S2-hook-analyze-live try 1 exit 0 end 11:13:38 PM
```

The model ran no command (`Do not run any command`). The second paragraph of its answer reports a failing `sample-copy.test.ts`, which is the output of the `verify-on-stop` hook reaching the session after the turn ended. That is an observation of the `verify-on-stop` hook, not of `analyze-live`, and it is not logged as one here.

## Side effect only the hook produces

| Check | Result |
| --- | --- |
| `public/demo/live.json` before the session | did not exist (reported by the person who ran it) |
| `public/demo/live.json` after the session | existed, write time 11:12 PM, inside the session window 11:12:35 PM to 11:13:38 PM (reported by the person who ran it) |
| Writer | the `analyze-live` hook. The agent ran no command and its tools are `Read File` and `Replace in File`. |
| Content of the copy `S2-live.json` | 1155 lines, `sourceLabel` `live:samples/manor`, 40 modules |
| Difference from the snapshot of the unedited sample | one line: the `sourceHash` of the edited module (`5484573c…` in the session file, `62a5ae34…` in the unedited snapshot written later by `pnpm hauntmap analyze samples/manor --out public/demo/live.json`). The edit changed only the hash, not any relation. |

- Trigger: `Stop`. The CLI session ended its turn and the hook rewrote the file.
- The `analyze:` line printed by the CLI: not observed. The transcript holds no hook output of `analyze-live`.
- Duration of the hook: not observed. Only the session duration is known: 63 s (11:12:35 PM to 11:13:38 PM), and it includes the model turn and the `verify-on-stop` hook.
- Whether `verify-on-stop` and `analyze-live` ran in file order, in parallel or only the first: both ran. Their order was not observed.
- `git diff --stat public/demo/live.json` for the session: not available. The file did not exist before the session and was untracked, so the one-line comparison above stands in for it.
- `PostFileSave` (`analyze-live-on-save`): not observed in a CLI session. An agent write through `Replace in File` is not an editor save, and the file was not saved by an editor. Whether the Kiro IDE raises it needs a person and is not observed.
- Which shell ran the hook command on Windows: not observed (no hook output).
- Whether `matcher` is a regular expression or a glob, and its path form on Windows: not observed. The deleted entry carried the only matcher.

## Commands run afterwards from PowerShell (by Kiro, in the repository)

After `pnpm demo:reset` had restored `samples/manor` and the session's `public/demo/live.json` had been removed:

```
pnpm hauntmap analyze samples/manor --out public/demo/live.json
analyze: 40 modules, 72 relations, 1 diagnostics → public/demo/live.json
```

`public/demo/live.json` is the pre-edit snapshot (the file task 12 replaces). Determinism:

```
pnpm hauntmap analyze samples/manor --out .hauntmap/live-again.json
analyze: 40 modules, 72 relations, 1 diagnostics → .hauntmap/live-again.json
git diff --no-index --exit-code public/demo/live.json .hauntmap/live-again.json
exit 0
```

The first run of the second command failed with `hauntmap: cannot write .hauntmap/live-again.json (ENOENT).` and exit code 6, because the folder `.hauntmap/` did not exist. The CLI does not create parent folders. After `New-Item -ItemType Directory .hauntmap` it ran.

## Second turn, replaced by running the command

The task asks for a second headless turn that leaves the sample untouched. By the owner's instruction it is replaced by running the hook command once, as the hook would:

```
pnpm demo:live
demo:live: skipped (samples/manor is identical to public/demo/manor/before)
```

`public/demo/live.json` was not rewritten. `git status --porcelain public/demo/live.json` printed `?? public/demo/live.json`, because the file is not committed yet (Kiro does not run `git commit`). It prints nothing only after the owner commits the file. That check is not observed. This was a run of the command, not a second Kiro turn, so it does not show that the `Stop` hook ran the skip path.

## Limits

The snapshot is a structural fact about static imports under the documented subset. It says nothing about correctness, safety or performance.
