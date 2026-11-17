# tests/ui

Unit, component and property tests of the `investigation-ui` spec, with the fixtures and generators they share. Facts below were read from `main` on 2026-11-16 and are checked by `tests/ui/fixtures.test.ts` where a test can check them.

## Facts confirmed against `main`

Exports of `src/analysis/index.ts` used here:

- `findCycles(investigation: Investigation, preset: Preset): CycleReport`
- `trace(investigation, origin: string, direction: "imports" | "imported-by", preset): TraceResult` (throws an `Error` naming the origin when it is not a module)
- `relationId(from, targetKey: [string, string], syntaxKind, dependencyKind): string`
- `occurrenceId(from, line, column, specifier): string`

Not exported from `index.ts`, read by a deep import from `src/analysis/graph/presets.ts`: `includesRelation(preset, { syntaxKind, dependencyKind, resolution }): boolean` and `presetRelations(investigation, preset): ImportRecord[]`.

Analysis client, `src/workers/client.ts`: `createAnalysisClient(createWorker)` returns `{ analyze(request: { files, rootLabel, options }, onProgress?), cancel(), currentRevision, lastInvestigation }`. `analyze` rejects with `AnalysisFailed` or `AnalysisCancelled`. There is no layout client in that file.

`public/demo/<sample>/expected.json` fields: `modules`, `wings` (keys without `src/`, for example `orders`), `imports`, `diagnostics`, `cycles` (keyed by preset), `receiptToCheckout`.

`public/demo/<sample>/sources.json` is `{ files: [{ path, text }] }`. All three exist: `manor/before` (40 files), `manor/after` (40 files) and `annex` (18 files).

Versions already in `package.json`: vitest 5.1.0, vite 8.3.8, typescript 6.0.3, fast-check 4.10.2, Node 24 or later, pnpm 12.3.4.

React, PixiJS, dagre, Playwright, jsdom and React Testing Library were not installed when this file was written. Task 1c pins them and appends their versions below.

## Fixtures and generators

- `ids.ts` re-exports `relationId` and `occurrenceId` and adds `relationIdFor(from, to, syntaxKind, dependencyKind)` for local keys.
- `fixtures/*.json` are the seven hand-authored investigations of `design.md`. Their expected values are written by hand in the tests; the real `trace` and `findCycles` are compared with them in `fixtures.test.ts` as a check of the fixtures.
- `generators.ts` has `makeInvestigation({ wings, relationsPerModule, seed })` (mulberry32; module IDs `<wing>/m<NNN>.ts`), and the three ready-made investigations `wide`, `perf200` and `perf1000`.

## Versions pinned by task 1c (2026-11-16, exact, `pnpm add -E`)

| Package | Version | Licence | Role |
| --- | --- | --- | --- |
| react | 19.3.1 | MIT | UI |
| react-dom | 19.3.1 | MIT | UI |
| pixi.js | 8.23.0 | MIT | scene renderer |
| @dagrejs/dagre | 3.1.3 | MIT | layout engine (the maintained `@dagrejs` fork of dagre; the unscoped `dagre` is not used) |
| @vitejs/plugin-react | 6.3.0 | MIT | Vite and Vitest React transform |
| @types/react | 19.3.0 | MIT | types |
| @types/react-dom | 19.3.0 | MIT | types |
| jsdom | 31.0.1 | MIT | DOM for the `jsdom` Vitest project |
| @testing-library/react | 16.3.3 | MIT | component tests |
| @testing-library/dom | 10.4.2 | MIT | peer dependency of `@testing-library/react` |
| @testing-library/user-event | 14.6.12 | MIT | keyboard and pointer input in component tests |
| @playwright/test | 1.65.1 | Apache-2.0 | browser tests; its Chromium 159.0.8154.6 (revision 1255) was already installed, `playwright install` was not run |

## Test projects

`vitest.config.ts` has two projects. `node` runs `tests/**/*.test.ts`; `jsdom` runs `tests/**/*.test.tsx` and `tests/**/*.dom.test.ts`. A test that needs a DOM but has no JSX is named `*.dom.test.ts`.