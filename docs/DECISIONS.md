# Decisions

Picks made while building without the owner. Newest at the bottom.

| Date | Decision | Why |
| --- | --- | --- |
| 2026-11-16 | The planning README of the Kiro package and the log examples sit in `plans/`, which git never sees. `.kiro/` holds hooks, settings, specs and steering only. | The README names a budget, a credit allocation and the contest tier. The revision steering says no file may name a prize or a budget. |
| 2026-11-16 | `plans/hauntmap-implementation-plan.md` is the 3 Nov plan, kept out of git with `.git/info/exclude`. | The older specs point to that path. PLAN-REVISION section 5 asks for this. |
| 2026-11-16 | Kiro runs from the CLI only (no IDE). Tasks that need the IDE stay open. | The lane runs without the owner at the screen. |
