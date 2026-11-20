# Implementation Plan: kiro-extensions

Rules: tests first and seen failing; one log row per task in `docs/kiro-log.md`; never weaken a test; no commit or branch command; `.kiro/steering/revision-2026-11-16.md` wins.

- [x] 1. Spec and the failing test file
  - Write the three spec files and `tests/kiro/extensions.test.ts`. Run it and see it fail because the files are absent.
- [x] 2. The power
  - Build `power/hauntmap/`, run the power part of the tests, then `kiro-cli powers install`, the headless session in `D:/Projects/kiroween/hauntmap-logs/power-run/`, the proof in `docs/acceptance/power-session/`, then `kiro-cli powers uninstall`.
- [x] 3. The custom agent
  - Build `.kiro/agents/haunt-reviewer.json`, `kiro-cli agent validate`, the headless run, the proof in `docs/acceptance/haunt-reviewer-session/`.
- [x] 4. The hook proof
  - Fire `verify-on-stop` in one headless session and write `docs/acceptance/hook-verify-on-stop.md`.
- [x] 5. Documents
  - README (Custom agents, Kiro powers, Agent hooks, Judging criteria), `docs/write-up.md`, the claims test, `pnpm verify` and `pnpm verify:e2e`.
