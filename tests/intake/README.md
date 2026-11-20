# Intake tests

Tests of `.kiro/specs/intake`. Unit and property tests run in the Vitest `node` project (`*.test.ts`), component tests in the `jsdom` project (`*.test.tsx`). Browser specs live in `tests/intake/e2e` and run in the `dev` Playwright project once task 6 adds gate I3.

## What was read on `main` before task 1

Read on 2026-11-19, from the files themselves.

- `DEFAULT_ANALYSIS_OPTIONS` in `src/contracts/options.ts`: preset `static-value`, six extensions, seven excluded directories, five secret patterns, `maxFiles` 1000, `maxFileBytes` 1048576, `maxTotalBytes` 26214400, `jsToTsFallback: true`.
- `AnalysisClient` in `src/workers/client.ts`: `analyze(request, onProgress?)`, `cancel()`, `currentRevision`, `lastInvestigation`. The error classes are `AnalysisCancelled` (name `AnalysisCancelled`) and `AnalysisFailed` (name `AnalysisFailed`, with `diagnostics`). Messages are `{ requestId, revision, kind, payload }` for requests; replies echo `requestId` and `revision`.
- `selectSources(files, rootLabel, options)` in `src/analysis/index.ts` (defined in `src/analysis/parser/select.ts`): the reason order is excluded directory, secret pattern, extension, size, binary. The file cap is checked before the byte cap. A cap returns `ok: false` with one `cap-reached` diagnostic.
- `validateInvestigation(value)` in `src/contracts/validate.ts`: `{ ok: true } | { ok: false; errors: string[] }`.
- `runRequest(request, post, hash?)` in `src/workers/analysis.worker.ts`: runs `selectSources`, then `analyze`; it never throws. It registers its entry only inside a `WorkerGlobalScope`.
- `analyzeRoot(ctx, root, preset)` and `createContext(workspaceRoot)` in `packages/hauntmap-mcp/src/tools.ts`: the Node route. The loader (`loadSourceSet` in `packages/hauntmap-mcp/src/loader.ts`) labels the root `live:<root>`, groups excluded directories as `<dir>/` and reads only files that may be included.
- Pinned versions in `package.json`: Vitest 5.1.0, jsdom 31.0.1, @testing-library/react 16.3.3, fast-check 4.10.2, @playwright/test 1.65.1.

## Fixtures

- `fixtures/folder/manifest.json` and `fixtures/folder-exec/manifest.json` describe folders that cannot live as source files. `materialize.ts` writes a manifest to a temporary folder with a given name, and builds `File` objects from it with `webkitRelativePath` defined through `Object.defineProperty`.
- `fixtures/graph/malformed.json` and `fixtures/graph/not-json.txt` feed the graph file tests of task 7.
- `generators.ts` holds `folderOf`, `listingOf`, `arbTree`, `arbUrl`, `arbListing` and `arbRecord`.
- `fakes.ts` holds the guarded `File`, the fake `fetch` and, from task 3, the inline read worker.

## Open questions recorded by later tasks

- Task 6: whether Playwright 1.65.1 `setInputFiles` selects a folder on a `webkitdirectory` input. Not yet recorded.
