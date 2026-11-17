---
inclusion: always
---
# Ownership

- Kiro does every task. There is one writer at a time in this checkout.
- One spec is in work at a time, on its own branch. Merge the branch into `main` only when `pnpm verify` passes.
- One task changes the folders its spec names. If a task needs a folder that belongs to another spec, stop and say so.

| Folder | Spec that owns it |
| --- | --- |
| `src/analysis/**`, `src/contracts/**`, `src/workers/analysis.worker.ts`, `src/workers/client.ts`, `tests/fixtures/**`, `public/demo/manor/**`, `public/demo/annex/**`, `scripts/pack-samples.ts`, `scripts/check-expected.mjs`, `tests/analysis/**`, `tests/workers/**`, `tests/analysis*.test.ts`, root configuration files | `analysis-core` |
| `packages/hauntmap-mcp/**`, `samples/**`, `scripts/demo-reset.ts`, `scripts/demo-live.ts`, `public/demo/live.json`, `src/features/liveSnapshot/**`, `tests/kiro/**` | `kiro-integration` |
| `src/scene/**`, `src/features/investigation/**`, `src/features/samples/**`, `src/features/demo/**`, `src/components/**`, `src/styles/**`, `src/workers/layout.worker.ts`, `tests/ui/**`, `tests/e2e/**` | `investigation-ui` |
| `src/analysis/graph/compare.ts`, `src/features/compare/**`, `src/scene/compare/**`, `tests/compare/**` | `snapshot-comparison` |

- `src/contracts/validate.ts` is the one file under `src/contracts` that `kiro-integration` creates (its task 4a).
- `src/analysis/graph/compare.ts` is the one file under `src/analysis` that belongs to `snapshot-comparison`.
- Never edit a file under `public/demo/` or `tests/fixtures/` to make a failing test pass.
