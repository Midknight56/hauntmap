# Implementation Plan

Kiro does every task, in this checkout, on the branch the person creates for this spec. No task creates a worktree or switches, creates, commits or merges a branch. The person runs git and merges into `main` when `pnpm verify` passes. `.kiro/steering/revision-2026-11-16.md` wins over this file.

Rules for every task:

- **Tests first.** Write the task's tests, run them, and see them fail for the reason the task removes (a missing module, or an assertion on behaviour not built yet). Then write the code. A test that passed at its first run is reported as such in the log row.
- **Green at the end.** The task ends with `pnpm verify` exiting 0, and with `pnpm verify:e2e` exiting 0 where the task names it. A task never leaves a failing or skipped test behind. The only exception is `github-live.spec.ts`, which skips itself without `HAUNTMAP_LIVE_NETWORK=1`.
- **One log row.** Each finished task adds one row to `docs/kiro-log.md` on the same day, with seven cells:
  - date, `Kiro CLI <version> / <model>`, task cell `intake, task <n>`;
  - the files, the verify commands and their results, including the first failing run;
  - an empty Credits cell unless the CLI shows a figure;
  - `none`, or what changed because of a failure.

  A row that uses a gate of `design.md` names it (`gate I2`).
- **Two repairs.** After two repairs against the same observed failure, stop, keep the reproducer, and report it in the log row. Never weaken a test to make it pass.
- **Folders.** A task touches only `src/features/import/**`, `src/features/github/**`, `tests/intake/**`, `docs/acceptance/intake/**`, `docs/acceptance/img/intake-*.png`, `docs/kiro-log.md`, and the files of the gates it names.
- **Fixtures.** Never edit `public/demo/**` or `tests/fixtures/**`; they are read only here.

The tasks run in five batches. One Kiro session runs one batch, in order. Every task leaves `pnpm verify` passing, so a batch can stop after any task.

## Batch A: test base and the pure local pieces

- [x] 1. Ownership, fixtures, generators, materializer and fakes
  - Gate I6: add to `.kiro/steering/ownership.md` the row `src/features/import/**`, `src/features/github/**`, `tests/intake/**`, `docs/acceptance/intake/**` → `intake`, and a section `Exceptions for intake` that lists the gates I1 to I5 of `design.md` in one line each.
  - Write `tests/intake/README.md` with what was read on `main` before this task: `DEFAULT_ANALYSIS_OPTIONS` in `src/contracts/options.ts`, the `AnalysisClient` shape and the error names `AnalysisCancelled` and `AnalysisFailed` in `src/workers/client.ts`, `selectSources` in `src/analysis/index.ts`, `validateInvestigation` in `src/contracts/validate.ts`, `runRequest` in `src/workers/analysis.worker.ts`, `analyzeRoot` and `createContext` in `packages/hauntmap-mcp/src/tools.ts`, and the pinned versions of Vitest, jsdom, React Testing Library, fast-check and Playwright from `package.json`.
  - Tests first: `tests/intake/fixtures.test.ts` and `tests/intake/fakes.test.ts` with the cases of `design.md`.
  - Then write:
    - `tests/intake/fixtures/folder/manifest.json` and `folder-exec/manifest.json` with the exact entries of the `design.md` fixture table;
    - `tests/intake/materialize.ts`, which writes a manifest to a temporary folder with a given name and builds `File` objects from a manifest with `webkitRelativePath` defined through `Object.defineProperty`;
    - `tests/intake/fixtures/graph/malformed.json` and `not-json.txt`;
    - `tests/intake/generators.ts` with `folderOf`, `listingOf`, `arbTree`, `arbUrl`, `arbListing` and `arbRecord`;
    - `tests/intake/fakes.ts`, with a `File` whose read methods throw until `allowRead()`, a fake `fetch` that records URL, headers and `credentials`, answers from a routing table with controllable timing and counts pending requests, and a fake read worker that runs `readAll` inline. The fake read worker is added in task 3, once `readAll` exists.
  - Verify: `pnpm verify` exits 0, and `fixtures.test.ts` and `fakes.test.ts` are collected and pass.
  - _Requirements: 2.6, 6.4, 7.5_

- [x] 2. Classification, the local messages and the boundary checks
  - Tests first:
    - `tests/intake/review.test.ts`;
    - `tests/intake/messages.test.ts` (local file only for now);
    - `tests/intake/boundary.test.ts`;
    - the source scan of `tests/intake/no-html-injection.test.ts`;
    - `tests/intake/properties.test.ts` with P1 and P2. P2 writes `arbTree` folders to temporary folders and runs `loadSourceSet` of `packages/hauntmap-mcp/src/loader.ts`, read only.
  - Then create `src/features/import/review.ts` (`stripRoot`, `classify` through `selectSources` with both caps raised to `Number.MAX_SAFE_INTEGER` and the `<dir>/` grouping, `capMessage`, `formatSize`, `reasonWords`, `plural`) and `src/features/import/messages.ts` with every local string of `design.md`.
  - Verify: `pnpm verify` exits 0 with the new files, P1 and P2 green; the fixture folder gives the review of 2.6 exactly.
  - _Requirements: 1.6, 1.8, 2.2, 2.3, 2.5, 2.6, 10.7_

- [x] 3. The read worker and the parity with the command line tool
  - Tests first: `tests/intake/readFiles.test.ts` and `tests/intake/parity.test.ts`.
  - Then create `src/features/import/readFiles.ts`, with `readAll` and `createReadClient` using the `{ requestId, revision, kind, payload }` envelope, the NUL check, progress at most every 100 ms and on the last file, `delayMs`, a cancel that terminates the worker and creates a new one, and dropping of replies with an older revision. Also create `src/features/import/readFiles.worker.ts`, which registers its entry only inside a worker, as `src/workers/analysis.worker.ts` does. Add the fake read worker to `tests/intake/fakes.ts`.
  - Verify: `pnpm verify` exits 0. The parity test shows that the investigation of the fixture folder from the browser pipeline and from `analyzeRoot` have the same JSON text except `sourceLabel`.
  - _Requirements: 3.1, 3.4_

## Batch B: the local dialog in the app

- [x] 4. The intake service, the dialog frame, the first screen and the review
  - Tests first:
    - `tests/intake/intake.test.ts`;
    - `tests/intake/styles.test.ts`;
    - the 1.2, 1.4, 2.1, 2.4, 2.5 and 10.2 (first screen and review) cases of `tests/intake/local-intake.test.tsx`;
    - the rendering case of `no-html-injection.test.ts` (folder `a&b<img src=x onerror=alert(1)>`).
  - Then create:
    - `src/features/import/types.ts`;
    - `intake.ts` (`createIntake` with `kinds`, `open`, the pending promise, `getState`, `subscribe`, `close`; `hasDirectoryInput`);
    - `DialogFrame.tsx`, with roles, heading, Tab trap, Escape, `aria-busy`, and focus on open and close per 1.3;
    - `IntakeHost.tsx`;
    - the `choose` and `review` screens of `LocalFolderDialog.tsx`, with the folder input or the 2.1 text, an empty `Import a graph file` section and saved list that task 7 fills, the 2.4 lines and lists as named scrollable regions, and `Analyze` with the three disabled cases, `Back` and `Close`;
    - `intake.css`, using only the tokens and faces named in 10.4.

    Nothing is wired into the app yet.
  - Verify: `pnpm verify` exits 0 with the new cases green.
  - _Requirements: 1.1, 1.2, 1.4, 1.6, 1.7, 2.1, 2.2, 2.4, 2.5, 10.2, 10.4, 10.5, 10.6_

- [x] 5. Reading, analyzing, cancel, failure and the summary
  - Tests first: the 1.3, 1.5, 3.2, 3.3, 3.5, 3.6, 4.3 and 4.4 cases of `local-intake.test.tsx`, `tests/intake/no-execution.test.tsx`, and P5 (local dialog) in `properties.test.ts`.
  - Then add to `LocalFolderDialog.tsx` the following:
    - the `reading`, `analyzing` and `result` screens, with progress text from the read client and from the analysis client's `onProgress`, `Cancel` (`readClient.cancel()` or `analysisClient.cancel()`), and the summary through `summaryMessage`;
    - the analysis request with the oversized entries of 3.4 and `{ ...defaults, preset: store.getState().preset }`;
    - `openInvestigation`, then `setStatus`, in `open` mode, with one status message at the start and one at the end;
    - the cancel message when the analysis client rejects with `AnalysisCancelled`, and the failure message with the preservation sentence for `AnalysisFailed` or a read error.

    The save controls come in task 7.
  - Verify: `pnpm verify` exits 0 with these cases and P5 green.
  - _Requirements: 1.3, 1.5, 3.2, 3.3, 3.4, 3.5, 3.6, 4.3, 4.4, 4.5_

- [x] 6. Wire the local route into the app (gates I1, I2, I3)
  - Tests first:
    - change `tests/ui/landing.test.tsx` and `tests/e2e/landing.spec.ts` 1.1 so that the button list and the Tab order are `Explore the manor`, `Explore the annex`, `Analyze a local folder` (gate I1);
    - add a case to `landing.test.tsx` that `onIntake("local")` is called and that the button is absent when `intakeKinds` is empty;
    - write the first cases of `tests/intake/e2e/local.spec.ts` (2.1 the dialog opens from the landing button; 2.6 the review of the fixture folder; 3.5 the summary and `local:sample-local` in the breadcrumb; 1.5 one status message at the start and one at the end);
    - write `tests/intake/e2e/helpers.ts`.

    Run the unit cases and see them fail on the missing button.
  - Then make these changes:
    - gate I1: in `Landing.tsx`, the optional props `intakeKinds` and `onIntake`, and the button `Analyze a local folder` after `Explore the annex` inside `.landing-actions`, without the class `primary`. Update criterion 1.5 of `.kiro/specs/investigation-ui/requirements.md` to say that the intake buttons are built by `intake` (I1);
    - gate I2: in `App.tsx`, create the intake service in `createServices()` from the full analysis client, `DEFAULT_ANALYSIS_OPTIONS`, `validateInvestigation`, `saved: null` (task 7 sets it) and the read worker factory; add the optional `intake` to `AppServices`; render `<IntakeHost>` next to `<StatusRegion>`; pass `intakeKinds` and `onIntake` to `Landing`; call `installIntakeHook` from the new `src/features/import/devHook.ts` inside `if (DEVHOOK_ENABLED)`;
    - gate I3: add `"**/tests/intake/e2e/**/*.spec.ts"` to the `dev` project of `playwright.config.ts`.
  - Find out whether Playwright 1.65.1 `setInputFiles` selects a folder on the `webkitdirectory` input. Record `yes`, or `no, hook fallback`, in `tests/intake/README.md`. On `no`, add `selectFiles` to the hook and use it in `chooseFolder`.
  - Verify: `pnpm verify` exits 0; `pnpm verify:e2e` exits 0, including the new local cases and the changed landing cases in both `prod` and `dev`.
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 2.1, 2.6, 3.5, 10.1, 11.1_

## Batch C: saving, graph files and the local evidence

- [x] 7. Saved investigations and graph file import
  - Tests first: `tests/intake/saved.test.ts` (memory store), `tests/intake/graphFile.test.ts`, the 5.x and 6.x cases of `local-intake.test.tsx`, and P8 in `properties.test.ts`.
  - Then create:
    - `src/features/import/saved.ts`, with `SavedStore`, `createSavedStore` over IndexedDB `hauntmap` / `investigations`, `createMemorySavedStore` and `recordSize`;
    - `src/features/import/graphFile.ts`, with `readGraphFile` for a bare investigation;
    - on the `choose` screen, the graph file input and the `Saved on this device (<n>)` list with `Open <label>` and `Forget <label>`;
    - on the `result` screen, `Save investigation on this device`, `Include source text` and the sentence of 5.1, all absent in `after` mode.

    In `App.tsx` (gate I2), set `saved: createSavedStore(globalThis.indexedDB)`.
  - Verify: `pnpm verify` exits 0 with these files and P8 green.
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.4_

- [x] 8. Local browser journeys, the privacy record and the timing (gate I5, performance and limitations)
  - Tests first: fill `tests/intake/e2e/local.spec.ts` with every remaining case of the `design.md` table:
    - 3.2 and 3.3, the cancel near 100 of 400 with `setReadDelay(20)` and the six fields read from `window.__hauntmap.store`;
    - 3.7, the timing;
    - 4.1 and 4.2, the request recording, the request list and the two screenshots;
    - 5.2 and 5.3, save, reload, `Open`, `Forget`;
    - 6.4, the graph files;
    - 10.3, the keyboard only journey with `assertFocusVisibleAndUnobscured` after every Tab;
    - 10.5, the four viewports.

    Run them against the current build and record which fail first.
  - Fix any defect in `src/features/import/**` found by these cases.
  - Run `pnpm verify:e2e -- tests/intake/e2e/local.spec.ts` once with `HAUNTMAP_SHOTS=1`, so that the run writes `docs/acceptance/intake/local-requests.json`, `docs/acceptance/img/intake-local-review.png` and `intake-local-map.png`. Look at both screenshots. Gate I5: add `## Intake` to `docs/performance.md` with the 3.7 figure for this PC, the test name, the date and the 3,000 ms target. Add `## Intake` to `docs/limitations.md` with the local lines of 11.4.
  - Verify: `pnpm verify` exits 0; `pnpm verify:e2e` exits 0; the request list and both screenshots exist and were written by the test.
  - _Requirements: 1.5, 2.6, 3.2, 3.3, 3.5, 3.7, 4.1, 4.2, 5.2, 5.3, 6.4, 10.3, 10.5, 11.3, 11.4_

## Batch D: the GitHub route

- [x] 9. jsDelivr observed, URL parsing and the listing (gate I5, limitations)
  - Read jsDelivr's current API documentation. Then request, from this PC, the following URLs for one small public repository and save the trimmed responses as the shape of `tests/intake/fixtures/gh/listing-small.json`:
    - the resolve URL without a ref;
    - the listing with a tag;
    - the listing with a branch name;
    - the listing for a repository that does not exist;
    - the listing for a ref that does not exist;
    - one file URL with and without a ref.

    Record in the log row the URLs, the statuses and the field names for path and size. Record whether a branch is accepted, which version a request without a ref resolves to, and the cache headers. If the documented `v1/packages/gh/...?structure=flat` form does not answer, try the older `v1/package/gh/.../flat` form and use the one that works. Replace each *verify* mark of `requirements.md` and `design.md` with what was observed. Write those lines, with the date, under `## Intake` in `docs/limitations.md`.
  - Tests first: `tests/intake/url.test.ts`, the resolve and listing cases of `tests/intake/jsdelivr.test.ts`, P3 in `properties.test.ts`, and the GitHub file in `messages.test.ts`.
  - Then create `src/features/github/messages.ts`, `url.ts` (`parseGithubUrl`) and the resolve and listing half of `jsdelivr.ts` (`resolveUrl`, `listingUrl`, `resolveVersion`, `listRepository` with `credentials: "omit"`, the status and rejection results, and the removal of the leading `/`).
  - Verify: `pnpm verify` exits 0 with these cases and P3 green.
  - _Requirements: 7.2, 7.3, 7.4, 7.6, 7.7, 10.7, 11.4_

- [x] 10. Fetching with bounded concurrency and the GitHub state machine
  - Tests first: the fetch cases of `jsdelivr.test.ts`, `tests/intake/github-machine.test.ts`, and P4, P6 and P7 in `properties.test.ts`.
  - Then add `fileUrl` and `fetchFiles` to `jsdelivr.ts`, with the pool of 6, one `AbortController`, `credentials: "omit"`, encoded path segments, the NUL check, the per file failure result and `AbortError` propagation. Create `src/features/github/githubIntake.ts` with `runGithubIntake`, which runs the states url → resolving → listing → classification through `classify` of `src/features/import/review.ts` → cap or none → fetching with progress → analysis with `maxFiles: 400` and the oversized entries → done. It includes the cancel and failure paths and `open` and `after` results.
  - Verify: `pnpm verify` exits 0 with these cases and P4, P6, P7 green; the fake `fetch` never reports more than 6 pending requests on `listingOf(200)`.
  - _Requirements: 7.3, 7.5, 7.6, 8.1, 8.3, 8.4, 8.5, 8.8_

- [x] 11. The GitHub dialog in the app (gates I1, I2)
  - Tests first:
    - `tests/intake/github-intake.test.tsx`;
    - the landing case that `Load a GitHub repository` follows `Analyze a local folder` when `kinds` includes `"github"`;
    - the button lists of `landing.test.tsx` and `landing.spec.ts` 1.1, which now include `Load a GitHub repository` (gate I1);
    - `tests/intake/e2e/github.spec.ts` with every case of the `design.md` table, with jsDelivr routed through `page.route`.
  - Then create `src/features/github/GithubDialog.tsx`, with roles, the heading with the mode suffix, the Tab order of 10.2, `PRIVACY_NOTE` above `Load` from the first render, the `Branch or tag` field per 7.2 and 7.3, progress text and `aria-busy`, `Cancel` and `Close`, styled by `intake.css`. In `IntakeHost.tsx`, render it for `kind: "github"`. Gate I1: render the GitHub button in `Landing.tsx`. Gate I2: pass `github: { fetchImpl: (input, init) => fetch(input, init) }` in `App.tsx`.
  - Verify: `pnpm verify` exits 0; `pnpm verify:e2e` exits 0, including `github.spec.ts` and the landing cases.
  - _Requirements: 1.1, 1.2, 7.1, 7.2, 7.3, 7.5, 7.6, 7.7, 8.2, 8.3, 8.5, 8.7, 8.8, 10.1, 10.2, 10.3_

## Batch E: the newer snapshot, the real network record and the docs

- [x] 12. `after` mode for both dialogs and the comparison buttons (gates I2, I4)
  - Tests first:
    - `tests/intake/after-mode.test.tsx` for both dialogs, plus P5 for the GitHub dialog;
    - new cases in the comparison tests for `compareWithIntake` (ok, failed, cancelled) and for the two idle panel buttons in the order of 9.1;
    - a new case in `tests/compare/e2e/compare.spec.ts`: after `Explore the manor`, `Compare revisions`, then `Local folder as the newer snapshot` with a fixture folder, gives `Comparison ready:`.

    Run them and see them fail.
  - Then finish the `after` behaviour of the local dialog and of `runGithubIntake`: the heading suffix, no `openInvestigation`, the bare failure message with no status write, the saved record `Open` resolving the record, and no save controls. Gate I4: add `HostIntake` to `src/features/compare/host.ts`, the optional `intake` dependency, `intakeKinds` and the action `compareWithIntake` to `store.ts`, and the buttons to the idle body of `ComparePanel.tsx`. Write the new idle panel order into `.kiro/specs/snapshot-comparison/requirements.md`. Gate I2: pass `intake` to `createCompareServices` in `App.tsx`.
  - Verify: `pnpm verify` exits 0 with `after-mode.test.tsx` and P5 green; `pnpm verify:e2e` exits 0, including the whole of `tests/compare/e2e/compare.spec.ts`.
  - _Requirements: 3.6, 9.1, 9.2, 9.3, 9.4_

- [x] 13. The real GitHub load on this PC, the docs and the closing check (gate I5)
  - Write `tests/intake/e2e/github-live.spec.ts`. It skips unless `HAUNTMAP_LIVE_NETWORK=1`. It loads one public repository with between 150 and 400 included files; check the count from the listing first, and choose another repository if it is outside that range. It measures the time from `Load` to the open map, writes `docs/acceptance/intake/github-live-requests.json` (method and URL) and saves `docs/acceptance/img/intake-github-progress.png` with `HAUNTMAP_SHOTS=1`.
  - Run it once with both variables set, and look at the screenshot. Gate I5: add the figure, the repository, the ref, the included count, the date and the 10,000 ms target under `## Intake` in `docs/performance.md`, as a figure for this PC and its connection. If the run cannot reach jsDelivr, record `not run` and the error in the log row instead of a figure.
  - Gate I5, the other docs:
    - finish `## Intake` of `docs/limitations.md` per 11.4;
    - replace the sentence `Comparison accepts the bundled manor pair and the live snapshot; comparing two arbitrary folders is not available in this build.` with one that names the local folder and the GitHub repository as possible newer snapshots, and update any test that pins the old sentence;
    - correct `What it does not do` and the comparison sentence of `README.md`;
    - describe the GitHub route in `README.md` and `docs/write-up.md` as sending the repository name, the ref and the file paths to jsDelivr, and the local route as sending nothing, citing `tests/intake/e2e/local.spec.ts` and `docs/acceptance/intake/local-requests.json`;
    - state that the tool was not tested with users unless a session with users took place.
  - Check that tasks 1 to 12 each have exactly one `intake, task <n>` row in `docs/kiro-log.md`, and that no `*verify*` mark is left in this spec's three files without a line in `docs/limitations.md`.
  - Verify: `pnpm verify` exits 0; `pnpm verify:e2e` exits 0 (the live spec skipped); `pnpm build` exits 0; `(Select-String -Path docs/kiro-log.md -Pattern "\| intake, task ").Count` is 13.
  - _Requirements: 8.6, 11.1, 11.2, 11.3, 11.4_

## Batch F: polish found after batch E

- [x] 14. Refusals shown inside the dialog (requirement 12)
  - Tests first: the 12.1 and 12.3 cases of `github-intake.test.tsx` and `local-intake.test.tsx`, and `github.spec.ts` 12.1 with jsDelivr routed through `page.route` (a listing of 509 files). Run them and see them fail.
  - Then make `runGithubIntake` write the failure sentence to the dialog's notice as well as to the status (open mode), give the notice `role="alert"`, and add the `problem` alert to `LocalFolderDialog.tsx` for read, analysis and graph file refusals.
  - Verify: the new cases pass; `pnpm verify` and `pnpm verify:e2e` exit 0 at the end of the batch.
  - _Requirements: 12.1, 12.2, 12.3, 12.4_

- [x] 15. Summaries leave out the counts that are 0 (requirement 13)
  - Tests first: change the expected summaries in `messages.test.ts`, `local-intake.test.tsx` and `local.spec.ts`, and add the zero cases to `messages.test.ts`. Run them and see them fail.
  - Then change `summary` of `src/features/import/messages.ts` and `loaded` of `src/features/github/messages.ts`.
  - Verify: the changed cases pass; `pnpm verify` and `pnpm verify:e2e` exit 0 at the end of the batch.
  - _Requirements: 13.1, 13.2, 13.3_