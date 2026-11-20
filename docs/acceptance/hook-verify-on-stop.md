# Observation: verify-on-stop

Hook file: `.kiro/hooks/verify-on-stop.json` (trigger `Stop`, command `pnpm verify`, timeout 600). It is byte-identical to the block in `.kiro/specs/kiro-integration/design.md` (checked on 2026-11-16 by comparing the file text with the extracted block).

## Machine

Read on 2026-11-16 with `Get-CimInstance`: AMD Ryzen 9 9950X 16-Core Processor (16 cores, 32 logical processors), 93.6 GB memory (`Win32_ComputerSystem.TotalPhysicalMemory`), Gigabyte B850M EAGLE WIFI6E ICE, Windows 11 Pro. Node v24.19.0, pnpm 12.3.4. `kiro-cli --version` printed `kiro-cli 3.4.0` on this machine. The session that wrote this file reported its client as Kiro IDE, and the log rows use the surface string `Kiro CLI 3.3.0 / auto` as the owner instructed.

## Manual run of `pnpm verify` (this is not hook output)

Command, from PowerShell in the repository root, with the 14 failing test files of task 1c moved aside for the run and moved back afterwards (they are red on purpose until tasks 3 to 10, and `pnpm verify` is red while they are present):

```
Measure-Command { pnpm verify 2>&1 | Out-File .hauntmap\verify-no-red.txt -Encoding utf8 }
```

Result: exit code 0, 26.5 seconds. 23 test files and 410 tests passed. First line of the output:

```
$ pnpm typecheck && pnpm lint && pnpm test && pnpm pack:samples --check && pnpm check:expected
```

Last lines of the output:

```
$ tsx scripts/pack-samples.ts "--check"
$ node scripts/check-expected.mjs
D:\Projects\kiroween\hauntmap\public\demo\manor\before: 72 import lines in 40 files, expected.json lists 72
D:\Projects\kiroween\hauntmap\public\demo\manor\after: 72 import lines in 40 files, expected.json lists 72
D:\Projects\kiroween\hauntmap\public\demo\annex: 26 import lines in 18 files, expected.json lists 26
```

26.5 s is below the 90 s target and the 180 s limit of `.kiro/hooks/README.md`, so `pnpm verify:fast` is not added. The figure is for this machine on this date and with those 14 files absent.

## Hook observation

Method: the Stop hook of the same session that did tasks 1a to 3, as the owner instructed. No headless `kiro-cli chat` session was started.

Status when this file was written: not observed. The stop of the session comes after this file and its log row were written, so no hook output had reached the session yet. If the hook output reaches the session after the turn ends, the section below is completed from it; if it does not, the row stays `not observed` and the hook is cited nowhere.

Hook output, first and last lines, duration and shell: not observed on 2026-11-16. Superseded by the section Headless observation of 2026-11-20 below.

## Headless observation of 2026-11-20

Result: fired. The `Stop` hook `verify-on-stop` of `.kiro/hooks/verify-on-stop.json` ran `pnpm verify` at the end of one headless Kiro CLI 3.5.0 session (harness V3, model `auto`), and its output reached the session. The result of the hook run was a failure, 5 failing tests, which is expected: `tests/kiro/extensions.test.ts` had been written first and the later tasks of `.kiro/specs/kiro-extensions` had not yet satisfied it. A hook that fails is a defect to log and fix, not evidence that it did not run; the hook file was not changed.

The hook fired again at the end of the 20 November 2026 session and failed on a focus race in `tests/intake/local-intake.test.tsx` (case "returns focus to the map wrapper on Close when the opener is gone"); no hook output text is quoted here because the session record of that output is not available to me.

### Command

From the repository root, in PowerShell, with a process poll running in a background job (it lists every process whose command line has `pnpm` and one of `verify`, `typecheck`, `vitest`, `lint`, every 300 ms, with the time of first sight):

```
kiro-cli chat --v3 --agent haunt-reviewer --no-interactive --trust-workspace "Reply with the single word ready. Do not call any tool. If hook output reaches you after that, quote its first line and its last line exactly, and say which command it came from."
```

The agent is `haunt-reviewer` so that the session cannot write a file or run a shell command (see `docs/acceptance/haunt-reviewer-session/README.md`). The prompt asks for one word and no tool call, so nothing in the session ran `pnpm`. Exit code 0. Wall clock 91.7 seconds, against 8.8 seconds for the power session (`docs/acceptance/power-session/README.md`), which ran in a folder with no hooks. That comparison is a hint, not a measurement.

### Output of the session (raw, minus the five lines that PowerShell adds around the first line of stderr)

```
[INFO] [KRS] <-- GenerateAssistantResponseCommand done totalEvents=5
ready**First line:**
`$ pnpm typecheck && pnpm lint && pnpm test && pnpm pack:samples --check && pnpm check:expected`

**Last line:**
`    181|   it("4.1 names the power, the agent and the hook proof fiGǪ [truncated]`

**Command:** The output comes from the chain on the first line, `pnpm typecheck && pnpm lint && pnpm test && pnpm pack:samples --check && pnpm check:expected`. That is the chain `pnpm verify` runs, and the output doesn't say which hook triggered it. The chain stopped at `pnpm test` (`vitest run`) with 5 failed tests. The output is truncated, so I can only see 2 of the 5 failures. Both are in `tests/kiro/extensions.test.ts`: 3.1 and 4.1. `pack:samples --check` and `check:expected` did not run in this output.

I haven't acted on the hook output, since you only asked me to quote it.
```

The first line quoted is the first line that `pnpm verify` prints (compare the section above). The last line is cut by Kiro before it reaches the agent (`[truncated]`). The agent did not edit anything.

### Process poll (excerpt)

Times are the clock time of first sight on the machine. The poll started at 10:33:22.8 and the session at about the same time.

```
10:33:26.812 pid 44324  ppid 49712  cmd.exe /d /s /c "pnpm verify"
10:33:26.832 pid 45964  ppid 49452  pnpm-native.exe verify
10:33:26.851 pid 52900  ppid 45964  cmd.exe /d /s /c pnpm typecheck && pnpm lint && pnpm test && pnpm pack:samples --check && pnpm check:expected
10:33:27.408 pid 46156  ppid 48392  pnpm-native.exe typecheck
10:33:30.454 pid 52208  ppid 42436  pnpm-native.exe lint
10:33:33 to 10:33:39  82 vitest worker processes (node.exe --experimental-import-meta-resolve ...), all children of pid 52492
```

`cmd.exe /c "pnpm verify"` started 3.6 seconds after the session did, right after the one word answer. The command string is the `command` of the hook. Its parent, pid 49712, was not itself matched by the poll, so the poll does not show which process of Kiro started it; that is the part this proof cannot show. The hook is the only thing in the run that names `pnpm verify`: the prompt, the agent's tools and the agent's prompt do not.

### Other sessions that saw the same hook

The two sessions of `docs/acceptance/haunt-reviewer-session/` ended the same way: after the review, the agent received a failing `pnpm verify` log and described it. That is a second and third sighting, not a separate proof.

### The save hook

`typecheck-on-save` (trigger `PostFileSave`) was not seen to run, in this session or in any CLI session. Its trigger is a file save event of an editor. A headless session writes files through the agent's tools, which are not editor saves, and the observation of 2026-11-16 (`docs/kiro-log.md`, row `Setup: hook observation typecheck-on-save`) saw no output in a headless session. No Kiro IDE session was run for this work, so the README does not claim that it runs anywhere.

### Limits

One session, one machine. It shows that the Stop hook starts `pnpm verify` at the end of a headless CLI turn and that the output returns to the session. It does not show the order of the two Stop hooks (`analyze-live` also has the trigger `Stop`), the shell Kiro used, or a passing run of the hook.