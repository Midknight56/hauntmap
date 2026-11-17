# tests/compare

Tests, fixtures, generators and browser specs of the `snapshot-comparison` spec. The readings below were taken on `main` on 2026-11-17 (task 1a) and settle the *verify* marks of `requirements.md` and `design.md`.

## Readings on `main`

Analysis (`src/analysis`):

- `src/analysis/index.ts` exports `DEFAULT_ANALYSIS_OPTIONS`, `findCycles`, `occurrenceId`, `relationId`, `trace`, `analyze`, `selectSources` and the types `HashFn` and `SelectResult`. It is not changed by this spec (`tests/analysis-boundary.test.ts` asserts its key list), so consumers import `compareInvestigations` from `src/analysis/graph/compare`.
- `relationId(from, targetKey: [string, string], syntaxKind, dependencyKind)` and `occurrenceId(from, line, column, specifier)` come from `src/analysis/graph/ids.ts`.
- `findCycles(investigation, preset): CycleReport` is in `src/analysis/graph/cycles.ts`. `presetRelations(investigation, preset)` and `includesRelation(preset, { syntaxKind, dependencyKind, resolution })` are in `src/analysis/graph/presets.ts`; `compare.ts` may import both as siblings.
- `selectSources(files, rootLabel, options): { ok: true; sourceSet; diagnostics } | { ok: false; diagnostics }` and `analyze(sourceSet, options, hash, onProgress?, selectionDiagnostics?)`. There is no `analyzeSourceSet`. `HashFn` is `(text) => Promise<string>`.
- `DEFAULT_ANALYSIS_OPTIONS` is in `src/contracts/options.ts` and is re-exported by the index.

Workers and store:

- `createAnalysisClient(createWorker)` in `src/workers/client.ts` returns `{ analyze({ files, rootLabel, options }, onProgress?), cancel(), currentRevision, lastInvestigation }`. `analyze` rejects with `AnalysisFailed` or `AnalysisCancelled`.
- The layout client is `LayoutClient` of `src/features/investigation/layoutClient.ts`: `request(payload, revision): Promise<LayoutResult>`, `cancel()`, `lastResult`.
- Store actions used by this spec: `openInvestigation(inv, source, { expandWing?, demo })`, `applyLayout(result)`, `replaceInvestigation(inv, sourceText, { keepLayout: true })`, `setLayoutRequestBuilder(builder | null)`, `retryLayout()`, `select(sel, { from })`, `setStatus(message)`, `restart()`, `expandWing`, `collapseWing`, `setPreset`. `replaceInvestigation` keeps `layout`, `camera`, `expandedWings`, `preset`, `activeView` and `selection`, drops a route filter holding an ID absent from the new investigation, recomputes an open loops or who-imports panel and sends no request. `applyLayout` sets `layout`, `layoutStatus: "idle"` and increments `layoutRevision`.
- `loadSample(id, base, fetchImpl?)` returns `{ ok: true, sourceSet } | { ok: false, message }` with no status field. The message reads `The <manor|annex> sample could not be loaded (<detail>). Reload the page.`
- Registry (`src/features/investigation/registry.ts`): `registerControl(slot, component)`, `registerHandoff("compare", fn)`, `unregisterHandoff`, `registerLegendEntries(provider)`, `getControl`, `getHandoff`, `legendEntries`. `Slot` is `"export" | "compare" | "live-snapshot"`. A control component takes `{ store }` only. The compare handoff takes `{ before, after: Investigation | { sample: "manor/after" }, layoutKey }`.
- `tests/ui/feature-boundary.test.ts` (10.6) fails when a file under `src/features/compare` imports anything from `src/components/**` or `src/features/investigation/**`, types included. So the compare store takes the fleet's types structurally (`CompareDeps`), the control component takes its props structurally, `wingOf` is written once in `src/features/compare/` and the source excerpt is written in `src/features/compare/excerpt.ts`. Imports from `src/analysis`, `src/contracts`, `src/scene` and `src/features/samples` are allowed.
- `src/scene/layout/doorsPlacement.ts` exports `placeDoors({ rooms: ReadonlyMap<string, Rect>, relations, boundaries }): { doors, sealed }` and `sideFacing`. `src/scene/layout/key.ts` exports `layoutKey(req, engine)` and `canonicalRequest`; `src/scene/layout/badges.ts` exports `placeBadges`.

Scene and styles:

- `TOKENS` has no `changed`, `removed` or `added` yet. `STATE_STYLES` already has the three `comparison-*` entries (lamp `\u25C8`, dashed-less outline of 2, `+`); `StateStyle` has no `outlineStyle`. `StyleState` is `{ selection, routeFilter, comparison?: unknown }`. `SceneDebug` has no `states` map. `MapView` takes `{ store, createScene, forceFailure? }` and calls `setStyleState({ selection, routeFilter })`.
- `playwright.config.ts` (read at task 1c): `testDir` is `tests/e2e`; project `prod` matches the three `PROD_SPECS`; project `dev` matches `**/*.spec.ts` except those. `pnpm verify:e2e` is `pnpm build && pnpm build:devhook && playwright test --pass-with-no-tests`. Read in task 1c: `pnpm verify:e2e <file>` and `--grep` are forwarded; with the extra `--` of the task text (`pnpm verify:e2e -- <file>`) pnpm 12.3.4 passes it on and Playwright runs every spec, so this spec writes the command without `--`. Since task 1c the `dev` project has `testDir: "tests"` and matches `tests/e2e/**` and `tests/compare/e2e/**` (G1); `tests/pending/**` is not collected.
- `tests/e2e/helpers.ts` exports `openManor`, `openFixture`, `focusedName`, `tabTo`, `assertFocusVisibleAndUnobscured`, `readStatus`, `inspectorHeading`, `sceneDebug`, `expected`, `clickDoor`, `expandAllWings`, `shot`, `snapshot`, `storeAction`, `settled`, `roomPoint`, `offsetFromMapCenter`, `wingOfId`, `inStaticValue`, `relationKeyOf`.
- `public/demo/manor/{before,after}/expected.json` fields: `modules`, `wings`, `receiptToCheckout`, `imports`, `diagnostics`, `cycles`. Both list 40 modules and 72 imports with 72 distinct relation IDs; `receipt.ts` has 4 and `checkout.ts` has 6 import records on both sides.

Pinned versions (`package.json`): vitest 5.1.0, vite 8.3.8, typescript 6.0.3, fast-check 4.10.2, @playwright/test 1.65.1, jsdom 31.0.1, @testing-library/react 16.3.3, react 19.3.1, pixi.js 8.23.0, @dagrejs/dagre 3.1.3, @babel/parser 8.1.2, Node 24 or later, pnpm 12.3.4.

## Fixtures

`fixtures/<name>/` holds `before.json`, `after.json` and `expected.json` (hand-authored; `expectedVersion: 1`). `comment-shift`, `duplicate-occurrence`, `rename` and `escaped` also hold `src/before` and `src/after` folders with the exact texts of `design.md`. Each file carries a `.txt` suffix on top of its module path (`src/a.ts.txt` is the module `src/a.ts`), so that the repository's typecheck and lint never read a fixture as code; `loadFolder.ts` strips the suffix. `manor-pair/expected.json` was written by hand from the two sample `expected.json` files and the receipt sources, never from `compare.ts`.

Helpers: `ids.ts` (relation and occurrence IDs), `loadFolder.ts` (`readFolder`, `readSourcesJson`, `analyzeFiles`, `analyzeFolder`, `nodeSha256`).
