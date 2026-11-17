# Resume here

Paused on 17 Nov 2026 at about 1:05 AM, because the PC was turned off for the night.

- Last commit on `main`: `cc971da` (investigation-ui tasks 9, 7, 8, 10). `pnpm verify` was green there: 71 files, 802 tests.
- Half work: branch `wip/iu-11` (`e22dffb`), two test files for investigation-ui task 11 only. Not merged and not verified.
- Kiro credits at 12:54 AM: 1,397.42 of 4,000 used (shared pool). Stop line: 3,200.
- Private state, logs and prompts: `docs/state.md` (not tracked) and `D:\Projects\kiroween\hauntmap-logs\`.

## Tasks per spec

| Spec | Done | Open |
| --- | --- | --- |
| analysis-core | 1-10, 12-15 | 11 (needs the Kiro IDE property feature) |
| kiro-integration | 1a-6, 8 | 7 tick (waits for `compare.ts`, then move `tests/pending/kiro/live-json.test.ts` back), 9-12, 14, 15. 13a and 13b are not done by the revision. |
| investigation-ui | 1a-10 | 11, 12, 13 (with three look fixes), 14 fallback test only, 15 |
| snapshot-comparison | spec review only | 1a-4b, 8-12, 14, 15 (5, 6, 7, 13 are cut) |

## Next step

1. Read credits:

```bash
powershell -NoProfile -File D:/Projects/kiroween/hauntmap-logs/credits.ps1
```

2. Bring the wip tests back to the working tree, then rerun investigation-ui tasks 11 to 14 (the prompt already says to check what is in the working tree):

```bash
cd /d/Projects/kiroween/hauntmap && git checkout wip/iu-11 -- tests/ui/demo-steps.test.ts tests/ui/manorFixture.ts && git reset -q tests/ui && git branch -D wip/iu-11
```

```bash
/d/Projects/kiroween/hauntmap-logs/run.sh D-iu-4b task /d/Projects/kiroween/hauntmap-logs/D-iu-4.txt 6600
```

3. Then `pnpm verify`, look at the screenshots, commit through a short branch. Then snapshot-comparison 1a-4b, 8-12, 14, 15, then kiro-integration 7 (tick), 9-12, 14, 15, then investigation-ui 15.
