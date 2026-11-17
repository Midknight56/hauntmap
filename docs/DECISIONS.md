# Decisions

Picks made while building without the owner. Newest at the bottom.

| Date | Decision | Why |
| --- | --- | --- |
| 2026-11-16 | The planning README of the Kiro package and the log examples sit in `plans/`, which git never sees. `.kiro/` holds hooks, settings, specs and steering only. | The README names a budget, a credit allocation and the contest tier. The revision steering says no file may name a prize or a budget. |
| 2026-11-16 | `plans/hauntmap-implementation-plan.md` is the 3 Nov plan, kept out of git with `.git/info/exclude`. | The older specs point to that path. PLAN-REVISION section 5 asks for this. |
| 2026-11-16 | Kiro runs from the CLI only (no IDE). Tasks that need the IDE stay open. | The lane runs without the owner at the screen. |
| 2026-11-16 | Kiro owned folders: added tests/analysis, tests/workers, tests/analysis*.test.ts and root config to analysis-core; src/contracts/validate.ts may be created by kiro-integration task 4a. | Kiro's analysis-core review found these unowned or cross-owned paths. |
| 2026-11-16 | Ownership exceptions for kiro-integration added to .kiro/steering/ownership.md (its extra paths, root config entries, App.tsx and Playwright lines). | Kiro's kiro-integration review asked for them; without them tasks 1a and 1c stop. |
| 2026-11-16 | My first start of the kiro-integration review looked dead (ps from Git Bash does not list it) and I started a second one. Both ran; the second saw the first writing and changed nothing. Process list now read with Get-CimInstance Win32_Process. | Lesson for later runs. |
