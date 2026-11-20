# Implementation Plan: node-builtins

Rules: tests first and seen failing; one log row per task in `docs/kiro-log.md`; never weaken a test; no commit or branch command; `.kiro/steering/revision-2026-11-16.md` wins.

- [x] 1. Failing tests : add cases to tests/analysis/resolve.test.ts for node:fs, node:fs/promises, node:test (external), and node:, "node: fs", Node:fs (alias-not-configured). Run `pnpm exec vitest run tests/analysis/resolve.test.ts` and see the new external cases fail.
- [x] 2. The fix : change src/analysis/parser/resolve.ts so the node: cases resolve as external. Run the same test file until it passes, then `pnpm typecheck`.
- [x] 3. Docs : add one line to docs/limitations.md (the Intake or a new "Resolver" heading, your choice) saying what node: specifiers do now, and the doc comment above resolveSpecifier.
