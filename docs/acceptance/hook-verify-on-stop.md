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

Hook output, first and last lines, duration and shell: not observed.
