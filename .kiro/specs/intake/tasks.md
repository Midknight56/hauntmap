# Implementation Plan

Fleet-owned spec, reviewed by Kiro. Window November 10–18 (work packages H13 and H10, the November 18 gate), fixes to the November 27 freeze. Two writers: the import writer in `../HauntMap-import` on `fleet/import` (tasks 1a–5, the local half of 9, 10 and the shared files of 12) and the GitHub writer in `../HauntMap-github` on `fleet/github` (tasks 6–8, the GitHub half of 9, 11); each touches only its folders (`src/features/import/**` and `tests/intake/**` except the GitHub files; `src/features/github/**` and the GitHub test files). Wiring into `src/components/App.tsx` (`registerIntake({ …, github: githubOpener(deps) })`), the Vitest and Playwright configuration and `.kiro/steering/ownership.md` goes through the integrator on a one-line request in the task's log entry. Preconditions on `main`: `src/contracts/` with `DEFAULT_ANALYSIS_OPTIONS`, `src/workers/client.ts` (`analyze`, `cancel`), the fleet store, the registry with the `intake` overload (`investigation-ui` task 2b) and `Landing.tsx` (`investigation-ui` task 6a); `src/contracts/validate.ts` before task 5 (`kiro-integration` task 4a). The client shapes are the ones `investigation-ui` task 1a records. A task is done only after `pnpm verify` and, where named, `pnpm verify:e2e` pass on its branch; the integrator merges only when both pass on the merge result, then requests the Kiro review (task 12). Two repair passes against the same observed defect, then stop and hand the reproducer to the builder. Kiro review credits for this spec and `investigation-ui` together total at most 250 (the 220 rule of `investigation-ui` 12.7); implementation rows in `docs/kiro-log.md` name the fleet agent, never Kiro. If the November 18 gate reduces scope, the local route stays and the GitHub route ships disabled (11.5).

- [ ] 1a. Fixtures, generators and the materializer (November 10)
  - Record at the top of `tests/intake/README.md` what was read on `main`: the `DEFAULT_ANALYSIS_OPTIONS` name, the analysis client shape from `tests/ui/README.md`, the registry's `intake` overload and types, the `validateInvestigation` export, the pinned versions of Vitest, jsdom, React Testing Library, fast-check and Playwright, and whether the pinned Playwright's `setInputFiles` accepts a directory (*verify*; record `yes` or `no, hook fallback`).
  - Write `tests/intake/fixtures/folder/manifest.json` and `folder-exec/manifest.json` with the exact entries of the `design.md` fixture table, `tests/intake/materialize.ts` (manifest → temp directory named `sample-local`; manifest → `File` objects with `webkitRelativePath` defined through `Object.defineProperty`), `tests/intake/fixtures/gh/listing-small.json` (the shape of the table; its field names are re-checked in task 6) and `gh/files/**`, `tests/intake/fixtures/graph/{export-sample,bare-investigation,export-with-source,malformed}.json` and `not-json.txt`, and `tests/intake/generators.ts` (`folderOf(n, opts)`, `listingOf(n)`, `arbTree`, `arbUrl`, `arbListing`, `arbRecord`).
  - Fill `tests/intake/fixtures.test.ts` (materialization, the `src/m99.ts` derivation for `listingOf(401)`, the graph fixtures parse).
  - Verify: `pnpm verify` collects `tests/intake/fixtures.test.ts` and it passes.
  - _Requirements: 2.6, 6.4, 7.5_
  - _Owner: fleet_

- [ ] 1b. Fakes and browser helpers (November 10–11)
  - Write `tests/intake/fakes.ts` (a `File`-like whose read methods throw until `allowRead()`; a fake `fetch` that records every request's URL, headers and `credentials`, answers from a routing table with controllable timing and counts pending requests; a fake `Worker` that runs the read logic inline; `createMemorySavedStore` is the production one) and `tests/intake/e2e/helpers.ts` (`openLocalDialog`, `openGithubDialog`, `selectFixtureFolder` with the directory `setInputFiles` and the `window.__hauntmap.intake.selectFiles` fallback, `routeJsdelivr(page, listing, files)`, `recordedRequests`).
  - Verify: `pnpm verify` passes with a `fakes.test.ts` smoke case (the fake `fetch` counts pending requests and the throwing `File` throws on `text()`).
  - _Requirements: 2.2, 8.1_
  - _Owner: fleet_

- [ ] 1c. Failing test files and the integrator's configuration (November 11)
  - Create every unit, component and property file of the `design.md` tables and both e2e spec files with one test per listed case asserting the contract (they fail until the matching task lands).
  - Integrator: add `tests/intake/**` to the Vitest configuration (jsdom for `*.test.tsx`, node for the rest; `properties.test.ts` P2 imports `packages/hauntmap-mcp/src/loader.ts` read-only), add `tests/intake/e2e/**` to the `dev` Playwright project, and confirm `src/features/import/`, `src/features/github/` and `tests/intake/` are listed in `.kiro/steering/ownership.md` as fleet folders of this spec.
  - Verify: `pnpm verify` collects the `tests/intake` files, `fixtures.test.ts` and `fakes.test.ts` pass and every other new test fails only because the module under test is absent; `pnpm verify:e2e -- tests/intake/e2e/local.spec.ts tests/intake/e2e/github.spec.ts` runs both files in the `dev` project (every case fails on the missing feature, none unmatched).
  - _Requirements: 11.1_
  - _Owner: fleet_

- [ ] 2. Registration, the local dialog shell, modes and focus (November 11–12)
  - In `../HauntMap-import`, create `src/features/import/register.ts` (`registerIntake`, the `IntakeHandoff` with `kinds`, the pending-promise rule, `hasDirectoryInput`, the dev hook object), `messages.ts` (every string of the local route), `localIntake.ts` (the state machine with the `choose` and `result` screens, `open` and `after` behaviour, the before-state snapshot) and `LocalFolderDialog.tsx` (dialog roles, heading with the mode suffix, Tab trap, Escape, focus return, the `choose` screen with the folder input or `NO_DIRECTORY_INPUT`, the graph-file section and saved-list placeholders, `Close`); ask the integrator to call `registerIntake(deps)` from `App.tsx` with `github: null` for now.
  - Fill `tests/intake/register.test.ts` and the 1.2, 1.3, 1.4, 1.6, 10.1 (first screen) cases of `tests/intake/local-intake.test.tsx` and `tests/intake/no-html-injection.test.ts`.
  - Verify: `pnpm verify` passes with those files green; in a development build, `Analyze a local folder` on the landing opens the dialog with focus on `Choose a folder` and Escape returns focus to the button (observed and noted in the log row).
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6, 1.7, 2.1, 10.1, 10.3_
  - _Owner: fleet_

- [ ] 3. Classification and the exclusion review (November 12–13)
  - Create `src/features/import/review.ts` (`stripRoot`, `classify` with the loader's rules and order read from `DEFAULT_ANALYSIS_OPTIONS`, `capMessage`, `formatSize`) and the `review` screen of `LocalFolderDialog.tsx` (the lines of 2.4, the two capped lists with `aria-label`, the sentence, `Analyze` with the three disabled cases, `Back`, `Close`).
  - Fill `tests/intake/review.test.ts`, the 2.4–2.5 cases of `local-intake.test.tsx` and the P1 and P2 runs in `tests/intake/properties.test.ts` (P2 against the Kiro loader on materialized trees).
  - Verify: `pnpm verify` passes with `review.test.ts`, P1 and P2 green; the fixture folder yields the review of 2.6 exactly.
  - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.6, 10.1, 10.4_
  - _Owner: fleet_

- [ ] 4. The read worker, progress, cancel, analysis and the summary (November 13–15)
  - Create `src/features/import/readFiles.worker.ts` and `readFiles.ts` (`createReadClient` with the protocol of `design.md`, the NUL probe, BOM removal through `file.text()`, progress every 100 ms, terminate-and-recreate cancel, stale-message drop) and the `reading`, `analyzing` and `result` screens of `LocalFolderDialog.tsx` (progress text, `aria-busy`, `Cancel`, the summary, the one status message at start and one at the end); wire the analysis client call with `{ ...defaults, preset }`, the source map, `openInvestigation` in `open` mode, the cancel and failure paths with their messages and the preserved state.
  - Fill `tests/intake/readFiles.test.ts`, the 3.2–3.6, 4.3, 4.4 cases of `local-intake.test.tsx`, `tests/intake/no-execution.test.ts` and the P5 run in `properties.test.ts`.
  - Verify: `pnpm verify` passes with those files and P5 green; in a development build the fixture folder opens the map with the breadcrumb `local:sample-local › src` and the summary of 3.5 in the status region; the generated 200-file, 2 MiB folder opens within the 3,000 ms target on the writer's machine (figure and machine noted in the log row; the named-laptop figure is task 10's).
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 4.3, 4.4, 4.5_
  - _Owner: fleet_

- [ ] 5. Graph-file import and saved investigations (November 14–16; after `src/contracts/validate.ts` is on `main`)
  - Create `src/features/import/graphFile.ts` (`readGraphFile` with the size, JSON and validation failures and the envelope's source map) and `saved.ts` (`SavedStore`, `createSavedStore` over IndexedDB `hauntmap` / `investigations`, `createMemorySavedStore`, `recordSize`); finish the `choose` screen's graph-file section and `Saved on this device (<n>)` list with `Open` and `Forget`, and the `result` screen's `Save investigation on this device`, `Include source text` and `SAVE_SENTENCE` (absent in `after` mode); the integrator passes `saved: createSavedStore(globalThis.indexedDB)` and `validate` in `App.tsx`.
  - Fill `tests/intake/graphFile.test.ts`, `tests/intake/saved.test.ts` (against the memory store), the 5.x and 6.x cases of `local-intake.test.tsx` and the P8 run in `properties.test.ts`.
  - Verify: `pnpm verify` passes with those files and P8 green; in a development build, saving the fixture investigation, reloading and opening it from the list shows `Opened local:sample-local from this device.` and `Forget` removes it (observed and noted in the log row; the browser-adapter e2e is task 10's).
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.4_
  - _Owner: fleet_

- [ ] 6. GitHub URL parsing and the jsDelivr listing (November 11–13, after the November 14 *verify* is scheduled; the listing fixture is corrected on November 14)
  - In `../HauntMap-github`, create `src/features/github/messages.ts`, `url.ts` (`parseGithubUrl`), `flags.ts` (`GITHUB_INTAKE_ENABLED = true`) and the listing half of `jsdelivr.ts` (`listingUrl`, `listRepository` with `credentials: "omit"`, the status and rejection results, the leading-`/` removal, `resolvedRef` and `commit` when reported); on November 14 the writer and the builder read the live listing response for the public repository chosen that day (plan open decision), record the field names, the default-branch behaviour, whether branch refs are accepted and how they are cached, and the statuses returned for a missing repository and a missing ref, replace the *verify* marks in `requirements.md` and `design.md`, correct `listing-small.json` to the observed shape, and write the observed behaviours into `docs/limitations.md`.
  - Fill `tests/intake/url.test.ts`, the listing cases of `tests/intake/jsdelivr.test.ts` and the P3 run in `properties.test.ts`.
  - Verify: `pnpm verify` passes with `url.test.ts`, the listing cases and P3 green; the November 14 readings appear in the log row and in `docs/limitations.md`.
  - _Requirements: 7.2, 7.3, 7.4, 7.6, 7.7_
  - _Owner: fleet_

- [ ] 7. Fetching with bounded concurrency, the cap, cancel and analysis (November 13–15)
  - Add to `jsdelivr.ts` `fileUrl` and `fetchFiles` (the pool of 6, one `AbortController`, `credentials: "omit"`, the NUL probe, the per-file failure result, `AbortError` propagation) and create `githubIntake.ts` (`runGithubIntake` with the state machine url → listing → classification through `classify` of `src/features/import/review.ts` (a read-only import across the two fleet folders) → cap or no-files → fetching with progress → analysis with `maxFiles: 400` → `openInvestigation` in `open` mode; the cancel and failure paths; `githubOpener`).
  - Fill the fetch cases of `jsdelivr.test.ts` and the P4, P6 and P7 runs in `properties.test.ts`.
  - Verify: `pnpm verify` passes with `jsdelivr.test.ts` and P4, P6, P7 green; the fake `fetch` never reports more than 6 pending requests on `listingOf(200)`.
  - _Requirements: 7.5, 8.1, 8.3, 8.4, 8.5, 8.8_
  - _Owner: fleet_

- [ ] 8. The GitHub dialog, the privacy note and the error states (November 15–16)
  - Create `GithubDialog.tsx` (dialog roles, heading with the mode suffix, the Tab order of 10.2, `PRIVACY_NOTE` above `Load` from the first render, the `Branch or tag` field per 7.3, progress text and `aria-busy`, `Cancel`, the result line of 7.7, `GITHUB_DISABLED` behind the flag, `Close`); ask the integrator to pass `github: githubOpener(deps)` to `registerIntake` in `App.tsx`.
  - Fill `tests/intake/github-intake.test.tsx`.
  - Verify: `pnpm verify` passes with `github-intake.test.tsx` green; in a development build with jsDelivr routed to `listing-small.json` through the hook's `requests()` check, `Load a GitHub repository` on the landing opens the dialog, the note is visible before `Load`, and the map opens with `gh:<owner>/<repo>@main` in the breadcrumb (observed and noted in the log row).
  - _Requirements: 1.1, 1.2, 7.1, 7.2, 7.3, 7.5, 7.6, 7.7, 8.2, 8.3, 8.5, 10.2, 10.3, 11.5_
  - _Owner: fleet_

- [ ] 9. `after` mode for both dialogs (November 16–17; each writer in its own worktree)
  - Import writer: the `after` behaviour of `runLocalIntake` (heading suffix, no `openInvestigation`, the bare failure message, the saved-record `Open` returning the record, the save controls absent) and `tests/intake/after-mode.test.tsx` for the local dialog; GitHub writer: the same for `runGithubIntake` and the GitHub cases of that file; both confirm with the `snapshot-comparison` writer, through a log row, that `Local folder as the newer snapshot…` and `GitHub repository as the newer snapshot…` resolve as its R3 expects.
  - Verify: `pnpm verify` passes with `after-mode.test.tsx` green and P5 green for both dialogs; in a development build with the comparison panel landed, `Local folder as the newer snapshot…` opens the dialog with the suffixed heading and the chosen folder appears as the newer snapshot without replacing the earlier one (observed and noted in the log row; absent the panel, the hook calls the handoff with `purpose: "after"` and the resolved result is inspected).
  - _Requirements: 9.1, 9.2, 9.3, 9.4_
  - _Owner: fleet_

- [ ] 10. Browser journeys for the local route and the row 30 record (November 16–18)
  - Fill `tests/intake/e2e/local.spec.ts` with every case of the `design.md` e2e table, including the request recording of 4.1, the save/reload/open/forget sequence through the browser adapter, the 200-file timing (recorded in this task's log row with the device) and the keyboard-only journey.
  - Reviewer agent: the network-panel run of 4.2 on the named laptop with `docs/acceptance/img/2026-11-18-network-local.png` and its row in `docs/acceptance/2026-11-18-gate.md`; `docs/acceptance/img/2026-11-18-local-review.png` from the review screen.
  - Fix any defect in `src/features/import/**` under the two-repair rule.
  - Verify: `pnpm verify:e2e -- tests/intake/e2e/local.spec.ts` passes; `pnpm verify` passes; the two screenshots and the gate row exist.
  - _Requirements: 1.5, 2.1, 2.6, 3.2, 3.3, 3.5, 3.7, 4.1, 4.2, 5.2, 5.3, 6.4, 10.3, 10.4_
  - _Owner: fleet_

- [ ] 11. Browser journeys for the GitHub route and the real-network record (November 16–18)
  - Fill `tests/intake/e2e/github.spec.ts` with every case of the `design.md` e2e table (jsDelivr routed through `page.route`; the 404, 403, cap, cancel, progress and loaded cases; the request inspection of 8.8; the keyboard-only journey).
  - Builder, on the named laptop over broadband: load the repository chosen on November 14, record the time from `Load` to the map, the repository, the ref, the included count and the date under the `GitHub load` heading of `docs/performance.md`, and save `docs/acceptance/img/2026-11-18-github-progress.png` from the progress screen; if the figure exceeds 10,000 ms, open a defect naming it.
  - Fix any defect in `src/features/github/**` under the two-repair rule.
  - Verify: `pnpm verify:e2e -- tests/intake/e2e/github.spec.ts` passes; `pnpm verify` passes; the `GitHub load` line and the screenshot exist, or a defect is open naming the figure.
  - _Requirements: 7.1, 7.2, 7.5, 7.6, 8.2, 8.3, 8.6, 8.7, 8.8, 10.3_
  - _Owner: fleet_

- [ ] 12. Integrate, obtain the Kiro reviews and record the evidence (November 18; fixes to November 27)
  - Integrator: confirm `registerIntake({ …, github: githubOpener(deps) })` in `App.tsx`, run `pnpm verify && pnpm verify:e2e && pnpm build` on the merge result, and request the Kiro review for each merged task 2–11 as `investigation-ui` 12.7 describes (rows labelled `intake/<n> review`; the 220 rule applies to the combined review credits); a failed review goes back to the owning writer under the two-repair rule.
  - Check that every task 1a–11 has its implementation row (fleet agent, date, task, files or commit, verify command and result, what changed because of a failure, `none` where nothing failed) and that `docs/limitations.md` carries the lines of 11.4 (subfolders, caps, ZIP, the observed jsDelivr behaviours with their date).
  - For the reviewer's `docs/acceptance/2026-11-18-gate.md`, list the evidence per matrix row: 19 (local and GitHub portion: the two e2e journeys and the reviewer's fresh-browser run of `investigation-ui` 1.8 extended to both dialogs), 21 (the `GitHub load` line and the privacy-note case), 22 (the 404/403, cap and cancel cases), 30 (the request-recording case and the network-panel screenshot).
  - Verify: `pnpm verify` and `pnpm verify:e2e` pass on `main`; `grep -c "intake" docs/kiro-log.md` is at least 23 (13 implementation rows for tasks 1a–1c and 2–11, 10 review rows); the combined review credits of this spec and `investigation-ui` are at most 250; the gate report cites evidence for rows 19, 21, 22 and 30.
  - _Requirements: 11.1, 11.2, 11.3, 11.4_
  - _Owner: fleet_
