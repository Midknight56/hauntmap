# Implementation Plan: accessibility-scan

Rules: tests first and seen running before any fix; one log row per task in `docs/kiro-log.md`; never weaken a scan; no commit or branch command; `.kiro/steering/revision-2026-11-16.md` wins. Headless only. The preview ports are not changed.

- [x] 1. Package and spec : write this spec; add `@axe-core/playwright` 4.14.0 with `pnpm add -D -E @axe-core/playwright@4.14.0`; add its licence row (MPL-2.0, tests only) to `docs/third-party-notices.md`. Read the axe-core version from `node_modules`.
- [x] 2. The scan, tests first : write `tests/e2e/axe.ts` and `tests/e2e/accessibility.spec.ts` for requirements 2 to 7. Run it once before any fix in report-only mode and write `docs/acceptance/accessibility/axe-before.json` (rule id, impact, number of nodes, one target selector, for each screen).
- [x] 3. Strict assertion : remove the report-only switch from the helper, so that the spec fails on any serious or critical violation. Run it and see it fail on the findings of task 2.
- [x] 4. Fixes : fix every serious or critical violation in `src/`, and every minor or moderate one that costs under 20 lines. Do not weaken a scan, disable a rule or exclude an element, except the canvas for `color-contrast`. Keep the candlelit manor tokens and fonts; text stays at least 12 px; a colour moves by the smallest step that passes.
- [x] 5. Final run : run the spec until it passes; write `docs/acceptance/accessibility/axe-after.json`. Run `pnpm typecheck`, `pnpm lint` and the vitest suites that the fixes touch.
- [x] 6. Documents : write `docs/acceptance/accessibility/README.md` (axe-core version from `node_modules`, the table of screens with violations before and after by impact, the fixes, what axe cannot check) and the log rows.
