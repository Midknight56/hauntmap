# Pending tests

Task 1c of `kiro-integration` wrote these files before the code they test existed. Each one still fails only because a module of a later task, or a module of another spec, is absent. They were moved here on 2026-11-16, after task 5, so that `pnpm verify` runs green on the tasks that are done. `tsconfig.json`, `eslint.config.js` and `vitest.config.ts` exclude `tests/pending/**`.

The files were moved byte for byte. Their relative imports (`./appPath`, `../../src/...`) resolve only at the original path, so a file is moved back to that path unchanged, and it is not run from here. Whoever moves a file back runs it, sees it pass, and deletes its row. When the table is empty, this folder and the three exclusions are removed.

| File (original path) | Task that must move it back first | Why it fails now |
| --- | --- | --- |
| `tests/kiro/compare-tool.test.ts` | `kiro-integration` task 9 | It imports `compareInvestigations` from `src/analysis/graph/compare.ts`, which `snapshot-comparison` creates. The real `compareTool` is task 9. |
| `tests/kiro/cli.test.ts` | `kiro-integration` task 9 | Case `5.3 compare` needs `hauntmap compare`, which is task 9 and needs `compare.ts`. Every other case passed at task 4c (17 passed). |
| `tests/mcp-agreement.test.ts` | `kiro-integration` task 9 | Case `row 27 programmatic` needs the MCP `compare` tool of task 9 and `compare.ts`. Case `row 26` passed at task 4c. |
| `tests/kiro/live-json.test.ts` | `kiro-integration` task 7 | Its Verify line names this file. The file imports `compare.ts` (from `snapshot-comparison`) at the top, and checks `public/demo/live.json`, which task 7 writes. Task 7 comes before `snapshot-comparison` in the revision order, so task 7 cannot make the file load unless `compare.ts` exists by then. Task 7 must report that, and must not change the test. Case `9.5` belongs to task 12. |
| `tests/kiro/properties.test.ts` | `kiro-integration` task 10 | P6 imports `compare.ts` (from `snapshot-comparison`). P8 and the top-level `import type { LiveDeps }` need `src/features/liveSnapshot/openLiveSnapshot.ts` (task 10). P1 to P5 and P7 passed at tasks 3 to 5. P1 and P2 take 4 to 7 s each on the machine in `docs/performance.md`, longer than Vitest's 5 s default. `vitest.config.ts` now sets `testTimeout: 30_000`, so P1 and P2 no longer fail on time. |
| `tests/kiro/fakes.ts` (helper, not a test) | `kiro-integration` task 10, together with `properties.test.ts` | It imports `LiveDeps` from `openLiveSnapshot.ts` (task 10), so `tsc` fails on it. Only `properties.test.ts` and `live-snapshot.test.tsx` use it. |
| `tests/kiro/live-snapshot.test.tsx` | `kiro-integration` task 10 | It imports `LiveSnapshotControl` and `openLiveSnapshot` from `src/features/liveSnapshot/` (task 10). `tsc` fails on it. |
| `tests/kiro/e2e/live-snapshot.spec.ts` | `kiro-integration` task 11 | It is the browser journey for task 11 and needs task 10's feature and `investigation-ui`'s Playwright setup. `tsc` fails on it. |

While these files are here, `pnpm verify` does not run them. That includes the cases of tasks 3 to 5 inside `cli.test.ts`, `mcp-agreement.test.ts` and `properties.test.ts`, which passed when those tasks were checked (see `docs/kiro-log.md`).
