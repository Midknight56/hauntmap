# Requirements Document

## Introduction

`intake` is the pair of routes by which a person brings their own code into HauntMap.

- Local folder analysis lives in `src/features/import`. It covers a folder input, a review of what will be read and skipped before any file content is read, reading in a worker with real progress and a cancel control, the 1,000 file and 25 MiB caps as errors rather than partial results, a coverage summary, `Save investigation on this device` and graph file import.
- Loading a public GitHub repository by URL through jsDelivr lives in `src/features/github`. It covers the URL grammar, the privacy note before the first request, the listing with the include rules applied before any file request, the 400 file cap, at most six requests in flight, progress and cancel.

Both dialogs also run in `after` mode, which supplies the newer snapshot of a comparison. The spec implements "Local source analysis", "Public GitHub repository by URL" and the intake parts of "Storage and privacy" of `plans/hauntmap-implementation-plan.md` (revision 3), as changed by `.kiro/steering/revision-2026-11-16.md`. The owner asked for it on 19 November 2026.

Who builds it: Kiro does every task, in this checkout, one task after another, on the branch the person creates for this spec. No other agent writes, integrates or reviews. The person runs git and merges into `main` when `pnpm verify` passes.

What it builds on, as it is on `main` (read on 2026-11-19):

- `src/contracts/types.ts`: `SourceFile`, `SourceSet`, `AnalysisOptions`, `Investigation`, `Preset`.
- `src/contracts/options.ts`: `DEFAULT_ANALYSIS_OPTIONS: AnalysisOptions`, a full options object whose `preset` is `"static-value"` and whose caps are `maxFiles: 1000`, `maxFileBytes: 1048576`, `maxTotalBytes: 26214400`.
- `src/contracts/validate.ts`: `validateInvestigation(value): ValidationResult` with `{ ok: true } | { ok: false; errors: string[] }`.
- `src/analysis/index.ts`: `selectSources(files, rootLabel, options)`, the classification the analysis worker and the Node loader both use.
- `src/workers/client.ts`: `createAnalysisClient(createWorker)` returning `AnalysisClient` with `analyze(request: { files: SourceFile[]; rootLabel: string; options: AnalysisOptions }, onProgress?: (done, total) => void): Promise<Investigation>` and `cancel()`. A cancel rejects with `AnalysisCancelled`, a worker failure with `AnalysisFailed`.
- `packages/hauntmap-mcp/src/loader.ts`: `loadSourceSet(root, options)`, the Node loader whose classification the browser must match.
- `src/features/investigation/store.ts`: `InvestigationStore` with `getState()` (`ViewState`) and the actions `openInvestigation(inv, source, { demo })`, `setStatus(message)`. `openInvestigation` resets `status` to `""`, so a message is written after it.
- `src/components/Landing.tsx`: `Landing({ onSample })` with the buttons `Explore the manor` (class `primary`) and `Explore the annex` inside `<div className="landing-actions">`.
- `src/components/App.tsx`: `createServices()` and `App`. It creates the analysis client, the store, the comparison services and the live snapshot control, and installs the development hook.
- `src/features/compare/`: `createCompareStore` with `actions.compareWith(after: AfterSource, layoutKey, before?)`, where `AfterSource` includes `{ kind: "investigation"; snapshot: { label, investigation, sourceText } }`, and `ComparePanel`, whose idle body offers `Revised manor` or `Bundled manor pair`.
- `src/components/devHook.ts`: `window.__hauntmap` in development builds and in the build of `pnpm build:devhook`.
- The candlelit manor theme: `src/styles/tokens.css` (written from `src/styles/theme.ts`), `src/styles/app.css` with the faces Almendra SC (`--font-display`), Spectral (`--font-ui`) and Spline Sans Mono (`--font-mono`) loaded from `src/styles/fonts`.

What `main` does not have, and this spec creates: any `intake` handoff (the registry has only `compare` and `export`, and `tests/ui/registry.test.ts` asserts that no `intake` handoff exists), the landing buttons for intake (`investigation-ui` 1.5 was withdrawn under the revision), any `GraphExport` envelope (the export feature is not built), and any dialog component.

Terms used below.

- **Included file**: a file that `selectSources` keeps under `DEFAULT_ANALYSIS_OPTIONS`. Its path has no directory segment in `excludeDirectories`, its name matches no `excludeFilePatterns` entry, its extension is in `includeExtensions`, its size is at most `maxFileBytes`, and its first 8,192 characters contain no NUL. The NUL condition is known only once the file is read.
- **Review**: the screen of the local dialog that lists included and skipped files before `Analyze`.
- **Root label**: `Investigation.sourceLabel`, either `local:<folder name>` or `gh:<owner>/<repo>@<ref>`.
- **Intake service**: the object `createIntake(deps)` of `src/features/import/intake.ts` returns. `App.tsx` creates it and hands it to the landing and to the comparison feature.
- **Read worker**: `src/features/import/readFiles.worker.ts`, this spec's worker that reads `File` objects.
- **Mode**: `open` (the result opens in the store) or `after` (the result goes back to the caller, which is the comparison, and no investigation is opened).
- **Status region**: the one `role="status"` element, written only through `store.actions.setStatus`.
- **Development build**: a build in which `window.__hauntmap` exists.
- **This PC**: the machine named in `docs/performance.md` under `Machine`. Every figure is measured there by a test and is a figure for this PC only.
- **Sizes** are shown as `<n> KB` (1,024 bytes, rounded up) below 1 MiB and as `<n.n> MiB` from 1 MiB.
- **Words rule**: no text a user sees joins two words with a hyphen or dash. Skip reasons are shown in words, not as the `SourceSet` reason codes.

## Requirements

### Requirement 1: The intake service, the two dialogs and the two modes

**User Story:** As the landing screen and the comparison panel, I want one intake service that opens the right dialog in the right mode and resolves a typed result, so that the intake flows plug into the app without the shell or the comparison feature knowing their internals.

#### Acceptance Criteria

1. THE SYSTEM SHALL provide `createIntake(deps)` in `src/features/import/intake.ts`, returning an `IntakeService` with `kinds` (`["local"]` when no GitHub opener is wired, `["local", "github"]` when `deps.github` is set), `open(args)`, `getState()` and `subscribe(listener)`. `App.tsx` SHALL create it once in `createServices()` and render `<IntakeHost service={...} />` next to `<StatusRegion>`, outside the landing and investigation screens, so that a dialog stays mounted when the screen changes. `tests/intake/intake.test.ts` asserts `kinds` for both wirings.
2. WHEN `open({ purpose, kind: "local" })` is called THEN THE SYSTEM SHALL show `<section role="dialog" aria-modal="true" aria-labelledby>` headed `Analyze a local folder`; with `kind: "github"` the heading SHALL be `Load a GitHub repository`. In `after` mode the headings SHALL read `Analyze a local folder as the newer snapshot` and `Load a GitHub repository as the newer snapshot`. Focus SHALL move to the dialog's first control, Tab and Shift+Tab SHALL stay inside the dialog, and Escape or `Close` SHALL close it, resolve `{ ok: false, reason: "cancelled" }` and return focus to the element focused before the call.
3. WHEN a dialog produces an investigation in `open` mode THEN THE SYSTEM SHALL call `store.actions.openInvestigation(investigation, sourceText, { demo: false })`, then write the summary message of 3.5, 6.3 or 8.5 with `setStatus`, and resolve `{ ok: true, investigation, sourceText, label }`. The local dialog then shows its result screen (5.1); the graph file, saved record and GitHub routes close the dialog. WHEN a dialog closes after `openInvestigation` THEN focus SHALL go to the opener if it is still in the document, otherwise to the map wrapper (`role="application"`, `Haunted map`). In `after` mode THE SYSTEM SHALL call no store action other than `setStatus`, close the dialog and resolve the same result. `tests/intake/after-mode.test.tsx` asserts that `openInvestigation`, `restart`, `select` and `setPreset` are never called in `after` mode.
4. WHEN `open` is called while a dialog is open THEN THE SYSTEM SHALL return the pending promise of the open dialog and open nothing.
5. THE SYSTEM SHALL write every message of this spec through `store.actions.setStatus` and SHALL show progress as visible text inside the dialog, with `aria-busy="true"` on the dialog while work runs. The status region receives one message when reading or fetching starts and one at completion, cancellation or failure, never one per progress step.
6. THE SYSTEM SHALL render every folder name, path, specifier, label, URL and message as a React text node. `dangerouslySetInnerHTML`, `innerHTML` and `insertAdjacentHTML` SHALL not appear in `src/features/import/**` or `src/features/github/**` (`tests/intake/no-html-injection.test.ts`). A chosen folder named `a&b<img src=x onerror=alert(1)>` SHALL appear verbatim in the review, and `document.querySelector("img")` SHALL be null.
7. WHILE the renderer is unavailable THE SYSTEM SHALL keep both dialogs fully working; they never call the scene.
8. THE SYSTEM SHALL keep `src/features/import/**` and `src/features/github/**` free of imports from `src/components/**` and `src/features/investigation/**`, types included. They reach the store and the analysis client through structural types, as `src/features/liveSnapshot` does (`tests/intake/boundary.test.ts`).

### Requirement 2: Local folder selection and the review before any content is read

**User Story:** As a developer choosing a folder, I want to see what will be read and what will be skipped before any file content is touched, so that I know exactly which files the analysis covers and that nothing outside them is opened.

#### Acceptance Criteria

1. THE SYSTEM SHALL offer `<input type="file" webkitdirectory>` labelled `Choose a folder` as the first control of the local dialog. IF `webkitdirectory` is not a property of a new `<input type="file">` THEN THE SYSTEM SHALL render no folder input, show `Folder selection is not available in this browser. Import a graph file instead.`, and make the graph file input of Requirement 6 the first control.
2. WHEN files are chosen THEN THE SYSTEM SHALL classify them from `File.webkitRelativePath`, `File.name` and `File.size` only. `text()`, `arrayBuffer()`, `stream()` and `slice()` SHALL not be called before `Analyze` is activated (`tests/intake/review.test.ts` passes `File`-like objects whose read methods throw). The first path segment, which is the chosen folder's name, is removed, so that paths are relative to the root with forward slashes and no leading `./`. The root label is `local:<folder name>`.
3. THE SYSTEM SHALL classify by calling `selectSources` of `src/analysis/index.ts` on the candidates as `{ path, text: "", bytes: size }` with `DEFAULT_ANALYSIS_OPTIONS` and both caps raised to `Number.MAX_SAFE_INTEGER`, so that the rules and their order are the analysis's own and no value is copied. It SHALL then group every `excluded-dir` entry under one `<dir>/` entry per excluded directory path, up to and including the first excluded segment, as `loadSourceSet` does. A file that would be `binary` is still included here; that reason is decided when the file is read (3.1).
4. WHEN the classification is done THEN THE SYSTEM SHALL show the review:
   - `Folder: <name>`;
   - `Included: <n> files, <size>`;
   - `Skipped: <k>`, followed by the lines `<a> in excluded directories (.git, node_modules, dist, build, out, .next, coverage)`, `<b> secret or environment files`, `<c> other file types` and `<d> over 1 MiB`, each omitted when its count is 0;
   - the lists `Included files (<n>)` and `Skipped files (<k>)`, sorted in code unit order. Each shows its first 200 entries, followed by `… and <m> more` when it is longer. A skipped entry reads `<path> · <reason in words>`, where the words are `excluded directory`, `secret or environment file`, `other file type`, `over 1 MiB` and `binary`;
   - the sentence `Included files are read in this browser and kept in memory.`;
   - the buttons `Analyze` (class `primary`), `Back` (returns to the first screen) and `Close`. When the review appears, focus moves to `Analyze`.
5. IF more than 1,000 files are included THEN `Analyze` SHALL be rendered with `aria-disabled="true"` and the text `This folder has <n> included files; the limit is 1,000. Choose a subfolder.` IF the included sizes add up to more than 26,214,400 bytes THEN the same applies, with the text `This folder has <size> of included text; the limit is 25 MiB. Choose a subfolder.` IF no file is included THEN the same applies, with the text `No JavaScript or TypeScript files were found in <folder> (<k> files skipped).` THE SYSTEM SHALL never analyze a subset of the included files.
6. WHEN the fixture folder `sample-local` of `tests/intake/fixtures/folder/manifest.json` is chosen THEN the review SHALL show the following. The folder holds `src/a.ts`, `src/b.ts`, `src/c.tsx`, `bin.ts`, `big.ts`, `README.md`, `.env`, `secret.pem`, `node_modules/pkg/index.js` and `dist/out.js`.
   - `Included: 4 files, 1 KB`, listing `bin.ts`, `src/a.ts`, `src/b.ts` and `src/c.tsx`. The four sizes add up to 133 bytes, and `bin.ts` is skipped only when it is read.
   - `Skipped: 6`, with the lines `2 in excluded directories (…)`, `2 secret or environment files`, `1 other file types` and `1 over 1 MiB`.
   - `Skipped files (6)`, listing `.env · secret or environment file`, `README.md · other file type`, `big.ts · over 1 MiB`, `dist/ · excluded directory`, `node_modules/ · excluded directory` and `secret.pem · secret or environment file`.

### Requirement 3: Reading in a worker, progress, cancel, analysis and the coverage summary

**User Story:** As a developer analyzing a large folder, I want reading and parsing to happen off the main thread with real progress and a cancel that leaves my previous investigation intact, so that the dialog never freezes and a wrong selection costs nothing.

#### Acceptance Criteria

1. WHEN `Analyze` is activated THEN THE SYSTEM SHALL post the included `File` objects to the read worker as one request `{ requestId, revision, kind: "read", payload: { files, delayMs } }`, the message envelope of `.kiro/steering/analysis.md`. The worker SHALL read each file with `file.text()`, which removes a leading byte order mark as the Node loader's `TextDecoder("utf-8")` does. A file whose first 8,192 characters contain a NUL SHALL be skipped with reason `binary`. `bytes` SHALL be `File.size`. The worker SHALL post `{ requestId, revision, kind: "progress", payload: { done, total } }` at most every 100 ms and on the last file, and then `{ requestId, revision, kind: "done", payload: { files, binary } }` with `files` sorted by path in code unit order. A reply with an older revision is dropped. `delayMs` is 0 except when the development hook sets it (design, Development hook).
2. WHILE reading runs THE SYSTEM SHALL show `Reading <done> of <total> files` in the dialog. WHILE the analysis client runs it SHALL show `Analyzing <done> of <total> files` from the client's `onProgress`. `Cancel` SHALL be enabled throughout and every other control `aria-disabled="true"`.
3. WHEN `Cancel` is activated during reading THEN THE SYSTEM SHALL call `terminate()` on the read worker and create a fresh one on the next read. WHEN it is activated during analysis THEN THE SYSTEM SHALL call `analysisClient.cancel()`. In both cases `ViewState.investigation`, `selection`, `routeFilter`, `camera`, `expandedWings` and `layout` SHALL stay deep equal to their values before `Analyze`. THE SYSTEM SHALL show `Analysis cancelled. <label> is still open.`, or `Analysis cancelled.` when no investigation is open, and return the dialog to the review with `Analyze` enabled and focused.
4. WHEN reading completes THEN THE SYSTEM SHALL call `analysisClient.analyze({ files, rootLabel, options }, onProgress)`. `files` holds the read files plus one `{ path, text: "", bytes }` entry for every `over 1 MiB` file of the review, so that the investigation carries the same `oversized` diagnostics as `loadSourceSet` gives for the same folder. `rootLabel` is `local:<folder name>`, and `options` is `{ ...DEFAULT_ANALYSIS_OPTIONS, preset: store.getState().preset }`. THE SYSTEM SHALL then build `sourceText` as `new Map(files.map(f => [f.path, f.text]))` over the read files only, and proceed per 1.3.
5. WHEN the analysis resolves THEN THE SYSTEM SHALL show, in the status region and on the result screen, `Analyzed <folder>: <m> modules, <r> relations, <d> diagnostics; <k> files skipped before reading, <b> binary files skipped, <f> files failed to parse.`, with every part whose count is 0 left out (Requirement 13). Here `<r>` counts distinct relation IDs and `<f>` counts modules with `parseStatus: "failed"`. A count of exactly 1 uses the singular noun (`1 relation`, `1 diagnostic`, `1 binary file skipped`, `1 file failed to parse`). For the fixture of 2.6 the message SHALL be `Analyzed sample-local: 3 modules, 1 relation, 1 diagnostic; 6 files skipped before reading, 1 binary file skipped.` The one diagnostic is the `oversized` diagnostic of `big.ts`.
6. IF the read worker posts an error or fails, or the analysis client rejects with `AnalysisFailed`, THEN THE SYSTEM SHALL show `The folder could not be analyzed (<message>). The previous investigation is unchanged.` It SHALL preserve the state of 3.3 and return the dialog to the review. In `after` mode the result is `{ ok: false, reason: "failed", message: "The folder could not be analyzed (<message>)." }` and no status message is written (9.2).
7. THE SYSTEM SHALL measure, in `tests/intake/e2e/local.spec.ts`, the time from activating `Analyze` until the store reports the investigation open with `layoutStatus` `"idle"` and a layout. The measurement uses a generated folder of 200 files and 2 MiB on this PC. The figure goes into the log row of the task and into `docs/performance.md` under `Intake`. The plan's target is 3,000 ms. The figure is a figure for this PC only, and the test does not fail on it.

### Requirement 4: Privacy of local analysis

**User Story:** As a developer analyzing private code, I want proof that the local flow sends nothing about my folder anywhere, so that any statement about local analysis rests on a recorded check and not on a promise.

#### Acceptance Criteria

1. THE SYSTEM SHALL make no network request as part of the local flow. `tests/intake/e2e/local.spec.ts` records every request of the page and its workers from the moment the dialog opens until the map is open. It asserts that every request goes to the app's own origin and has the extension `.js`, `.css`, `.ttf`, `.png`, `.svg` or `.json`. It also asserts that no request URL, header or post body contains the folder name `sample-local`, any fixture path or the content sentinel `SENTINEL-LOCAL-4e2b17` that `src/a.ts` of the fixture carries.
2. THE SYSTEM SHALL keep the record of 4.1 as evidence. Run with `HAUNTMAP_SHOTS=1`, the same test writes the recorded request list (method and URL, no bodies) to `docs/acceptance/intake/local-requests.json`, and screenshots of the review and of the opened map to `docs/acceptance/img/intake-local-review.png` and `intake-local-map.png`. A statement in `README.md` or `docs/write-up.md` that local analysis sends no code anywhere SHALL cite this test and these files. Requests for the app's own files are ordinary page loads and are named as such.
3. THE SYSTEM SHALL keep source text in the store's in-memory map only. The local flow SHALL write nothing to `localStorage`, `sessionStorage` or IndexedDB except through the explicit save of Requirement 5 (`tests/intake/local-intake.test.tsx` spies on the three storages).
4. THE SYSTEM SHALL log no folder name, path, specifier or content to the console or to any endpoint. A failure logs the error name only, as the store's `logFailure` does (`tests/intake/local-intake.test.tsx` spies on `console.error`). No telemetry exists in this build.
5. THE SYSTEM SHALL pass file text to the analysis client as data only. It SHALL never execute, `import()`, evaluate or render as active content any chosen file, and SHALL never fetch an import that a chosen file names. `tests/intake/no-execution.test.tsx` uses a folder whose `index.html` sets a cookie if rendered and whose `postinstall.js` sets a global marker if run, and asserts that neither happened and that no request was made.

### Requirement 5: Save investigation on this device

**User Story:** As a developer who analyzes the same folder repeatedly, I want to save an investigation on my own machine by an explicit action, with source text included only when I say so, so that nothing is persisted by accident and the saved copy can be forgotten.

#### Acceptance Criteria

1. WHEN a local analysis has completed in `open` mode THEN the result screen SHALL show the summary, the button `Save investigation on this device`, the checkbox `Include source text` (unchecked each time the screen appears), the sentence `Saved investigations stay in this browser's storage until you forget them.` and `Close`. Nothing is saved without the button (`tests/intake/saved.test.ts`).
2. WHEN the button is activated THEN THE SYSTEM SHALL write one record to the IndexedDB database `hauntmap`, object store `investigations`, keyed by the root label: `{ savedVersion: 1, label, savedAt: <ISO 8601 UTC>, investigation, sourceText: Record<path, text> | null }`. `sourceText` is non-null only when the checkbox is checked. A record with the same label is replaced. THE SYSTEM SHALL show `Saved <label> on this device (<size>, source text included).` or `(<size>, source text left out).`
3. THE SYSTEM SHALL list, on the local dialog's first screen, `Saved on this device (<n>)`, sorted by `savedAt` from newest to oldest. Each item reads `<label> · <m> modules · saved <YYYY-MM-DD> · source text <included|left out>` and has the buttons `Open <label>` and `Forget <label>`.
   - WHEN `Open` is activated THEN THE SYSTEM SHALL validate the record's investigation with `validateInvestigation` and proceed per 1.3 with the record's source map (or `null`), showing `Opened <label> from this device.`
   - IF validation fails THEN THE SYSTEM SHALL delete the record and show `The saved investigation <label> is not valid (<first error>) and was removed.`
   - WHEN `Forget` is activated THEN THE SYSTEM SHALL delete the record and show `Forgot <label>.`
4. IF IndexedDB is unavailable (`indexedDB` undefined, `open` throwing or its request failing) THEN the save button SHALL be rendered with `aria-disabled="true"` next to the text `Saving is not available in this browser.`, and the saved list SHALL be absent. IF a write fails (quota or any other error) THEN THE SYSTEM SHALL show `The investigation could not be saved (<error name>).` and keep the dialog open.
5. THE SYSTEM SHALL keep saved records across `Restart demo`, which clears `localStorage` except the preferences and does not touch IndexedDB (`tests/e2e/landing.spec.ts` 1.7). Only `Forget` removes a record.
6. THE SYSTEM SHALL implement the store behind the interface `SavedStore` of `design.md` with an injected adapter. `tests/intake/saved.test.ts` runs against `createMemorySavedStore()`, so no new dependency is needed, and `tests/intake/e2e/local.spec.ts` exercises the browser adapter once: save, reload the page, open, forget.

### Requirement 6: Graph file import

**User Story:** As a person in a browser without folder selection, or a developer who wrote a graph with the command line tool, I want to open a graph JSON file directly, so that the investigation is reachable without analyzing again.

#### Acceptance Criteria

1. THE SYSTEM SHALL offer, on the local dialog's first screen, the section `Import a graph file` with `<input type="file" accept=".json,application/json">` labelled `Choose a graph file`. It SHALL accept a bare `Investigation`, which is what `pnpm hauntmap analyze <root> --out <file>` writes and what `public/demo/live.json` holds. No export envelope exists in this build, and none is read.
2. IF the file is larger than 26,214,400 bytes THEN THE SYSTEM SHALL show `The graph file is larger than 25 MiB.` without reading it. IF the text is not JSON THEN it SHALL show `The graph file is not JSON (<SyntaxError message>).` IF `validateInvestigation` fails THEN it SHALL show `The graph file is not valid: <first error>.` After any of these failures the dialog stays open, focus stays on `Choose a graph file` and the state of 3.3 is preserved.
3. WHEN the file is valid THEN THE SYSTEM SHALL proceed per 1.3 with `sourceText` `null`, so that the inspector shows its existing text `Source not included in this snapshot; evidence is path, line and specifier.` It SHALL keep `investigation.sourceLabel` as the label and show `Imported <label>: <m> modules, <r> relations. A graph file holds no source text.`
4. WHEN `public/demo/live.json` (read only, never edited), `tests/intake/fixtures/graph/malformed.json` (`{"schemaVersion": 2}`) and `tests/intake/fixtures/graph/not-json.txt` (`{"schemaVersion": 1,`) are imported THEN the first SHALL open with `Imported live:haunts/manor: <m> modules, <r> relations. A graph file holds no source text.`, where the test computes `<m>` and `<r>` from the file. The second SHALL show `The graph file is not valid: schemaVersion must be 1 (found 2).` The third SHALL show a message that starts with `The graph file is not JSON (`.

### Requirement 7: GitHub URL, privacy note, listing and the include rules

**User Story:** As a person trying HauntMap on a public project, I want to paste a repository URL and have the listing filtered by the same rules as a local folder before a single file is fetched, with a plain statement of what leaves my browser, so that the GitHub route is as predictable as the local one.

#### Acceptance Criteria

1. THE SYSTEM SHALL offer, in this DOM and Tab order, the text field `Repository URL`, the field `Branch or tag` (rendered only per 7.3), the button `Load` (class `primary`) and `Close`. The privacy note `The repository name and file paths are sent to the jsDelivr CDN to fetch the files. Local folder analysis sends nothing.` SHALL be visible as text above `Load` from the dialog's first render, before any request.
2. THE SYSTEM SHALL accept `https://github.com/{owner}/{repo}`, with an optional trailing `/` or `.git` and an optional `/tree/{ref}`, where `owner`, `repo` and `ref` match `[A-Za-z0-9_.-]+` (`parseGithubUrl` of `src/features/github/url.ts`, pure). These inputs SHALL be rejected with `Subfolders are not supported yet. Paste the address of the repository itself.`:
   - a path after `/tree/{ref}`;
   - any other path after the repository;
   - a `ref` containing `/`, because it cannot be told from a subfolder. For this case the `Branch or tag` field is also shown, so that the ref can be typed there.

   Any other string SHALL be rejected with `Enter an address like https://github.com/owner/repo or https://github.com/owner/repo/tree/branch.` A rejection makes no request.
3. WHEN no ref is given THEN THE SYSTEM SHALL ask jsDelivr which version the repository resolves to (`https://data.jsdelivr.com/v1/packages/gh/{owner}/{repo}/resolved`, observed 2026-11-19). The answer is the newest tag, so a repository with tags loads its newest tag and not its default branch. THE SYSTEM SHALL then use that version for the listing and for every file, so that the listing and the files come from one version. IF the answer has `"version": null` (the repository has no tags or releases) THEN THE SYSTEM SHALL request the listing at `main`, and when that answers 404 at `master`. IF both answer 404 THEN THE SYSTEM SHALL show the `Branch or tag` field filled with `main`, together with the text `Type the branch or tag to load.`, and make no further request until `Load` is activated again. The result line names the ref that was used (7.7). Task 9 observed on 2026-11-19, from this PC with curl, and wrote into `docs/limitations.md`: the listing accepts a branch name, a tag and a short commit id as `{ref}`; a request without a ref resolves to the newest tag, or to `null`; and a listing is served with `Cache-Control: public, max-age=31536000, stale-while-revalidate=86400, stale-if-error=86400`.
4. WHEN `Load` is activated with a valid URL THEN THE SYSTEM SHALL request the listing with `credentials: "omit"` and no header beyond the browser defaults. It SHALL read each entry's path and size (`files[].name` with a leading `/` and `files[].size`, observed 2026-11-19; `tests/intake/fixtures/gh/listing-small.json` copies the observed shape), remove one leading `/` from each path, and classify the entries as in 2.3 with the listed size standing in for `File.size`. The `binary` check runs on the fetched body.
5. IF more than 400 files are included THEN THE SYSTEM SHALL fetch no file and show `<owner>/<repo>@<ref> has <n> included files; the limit is 400. First excluded: <path>.` Here `<path>` is the 401st included path in code unit order; for the generated listing of 401 entries `src/m<i>.ts`, the test derives it from the sorted list as `src/m99.ts`. IF no file is included THEN THE SYSTEM SHALL show `No JavaScript or TypeScript files were found in <owner>/<repo>@<ref>.` The 25 MiB cap of 2.5 applies to the listed sizes with the message `<owner>/<repo>@<ref> has <size> of included text; the limit is 25 MiB.`
6. IF the listing or resolve response status is not 200, or the request rejects, THEN THE SYSTEM SHALL show `Could not list <owner>/<repo>@<ref>: <status or error name>. Only public repositories are supported.` It SHALL fetch nothing and preserve the state of 3.3. Task 9 records in `docs/limitations.md` the statuses jsDelivr returns for a missing repository and a missing ref.
7. THE SYSTEM SHALL use the root label `gh:<owner>/<repo>@<ref>`, where `<ref>` is the ref as entered or typed, or the version jsDelivr resolved when none was given.

### Requirement 8: GitHub fetching with bounded concurrency, progress, cancel, caps and the result

**User Story:** As a person loading a repository of about 200 files, I want it on the map quickly, with visible progress and a cancel that aborts the requests in flight, so that the GitHub route is usable live.

#### Acceptance Criteria

1. THE SYSTEM SHALL fetch each included file from `https://cdn.jsdelivr.net/gh/{owner}/{repo}@{ref}/{path}` with `credentials: "omit"`, with at most 6 requests in flight at any moment and one `AbortController` for the whole batch. A request is in flight from the moment it is sent until it settles. `tests/intake/jsdelivr.test.ts`, with a fake `fetch`, asserts that the pending count never exceeds 6 and that the number of file requests equals the included count (P4).
2. WHILE files are fetched THE SYSTEM SHALL show `Fetched <done> of <total> files` in the dialog, updated each time a file settles, and then `Analyzing <done> of <total> files`. `Cancel` SHALL be enabled throughout and the other controls `aria-disabled="true"`.
3. WHEN `Cancel` is activated THEN THE SYSTEM SHALL abort the controller, so that requests in flight reject with `AbortError`, and call `analysisClient.cancel()` if analysis has started. It SHALL discard every received body, preserve the state of 3.3, show `Loading cancelled. <label> is still open.` (or `Loading cancelled.`) and return the dialog to the URL field. `tests/intake/e2e/github.spec.ts` cancels at 50 of 200 routed files and asserts that no file request is sent afterwards.
4. IF a file response status is not 200, or a file request rejects for a reason other than the abort, THEN THE SYSTEM SHALL abort the rest and show `Could not fetch <path> from <owner>/<repo>@<ref> (<status or error name>). Nothing was loaded.`, with the state of 3.3 preserved. A body whose first 8,192 characters contain a NUL SHALL be skipped as `binary`. A file whose listed size exceeds 1,048,576 bytes is never fetched (7.4).
5. WHEN the last file has arrived THEN THE SYSTEM SHALL call `analysisClient.analyze({ files, rootLabel, options })`.
   - `files` holds the fetched files sorted by path, with `bytes` set to the body's byte length, plus an empty text entry for every listed `over 1 MiB` file (as in 3.4).
   - `rootLabel` is the label of 7.7.
   - `options` is `{ ...DEFAULT_ANALYSIS_OPTIONS, preset: store.getState().preset, maxFiles: 400 }`.

   THE SYSTEM SHALL then build the source map, proceed per 1.3 and show `Loaded <owner>/<repo>@<ref>: <n> files, <m> modules, <r> relations, <d> diagnostics.`, with the singular rule of 3.5 and with every part whose count is 0 left out (Requirement 13). The recorded `options.maxFiles` of 400 is what tells a GitHub snapshot from a local one.
6. THE SYSTEM SHALL measure a real load once, on this PC, with `tests/intake/e2e/github-live.spec.ts`. The spec runs only when `HAUNTMAP_LIVE_NETWORK=1` and is skipped otherwise, so `pnpm verify:e2e` never depends on the network. It loads the public repository named in the task 13 log row, which must have between 150 and 400 included files. It measures the time from activating `Load` until the map is open, saves the request list (method and URL) to `docs/acceptance/intake/github-live-requests.json`, and saves a screenshot of the progress text to `docs/acceptance/img/intake-github-progress.png`. The figure, the repository, the ref, the included count and the date go under `Intake` in `docs/performance.md`. The plan's target is 10,000 ms. The figure is one run over this PC's connection and is a figure for this PC only.
7. WHEN `tests/intake/e2e/github.spec.ts` routes the listing to 404 and to 403 THEN both SHALL show the 7.6 message with that status, and no file request SHALL be sent. WHEN it routes the generated listing of 401 entries THEN the 7.5 message SHALL appear with `src/m99.ts` and no file request. WHEN it routes `listing-small.json` and its bodies with the ref `main` THEN the map SHALL open with `Loaded <owner>/<repo>@main: 3 files, 3 modules, 1 relation, 1 diagnostic.`
8. THE SYSTEM SHALL send jsDelivr the repository name, the ref and the file paths, and nothing else: no cookie, no custom header and no query parameter beyond the URL forms of design, jsDelivr. `tests/intake/jsdelivr.test.ts` inspects every request the fake `fetch` receives.

### Requirement 9: The newer snapshot of a comparison (`after` mode)

**User Story:** As a person comparing versions, I want to pick a second local folder or GitHub ref as the newer snapshot without the current investigation being replaced first, so that `Local folder as the newer snapshot` and `GitHub repository as the newer snapshot` work through the same dialogs.

#### Acceptance Criteria

1. THE SYSTEM SHALL show in the idle `Compare revisions` panel, after the existing `Revised manor` or `Bundled manor pair` button, the button `Local folder as the newer snapshot` and, when `kinds` includes `"github"`, the button `GitHub repository as the newer snapshot`. Activating one SHALL call the compare store action `compareWithIntake(kind)`. That action SHALL call `intake.open({ purpose: "after", kind })` and, on `{ ok: true }`, call `compareWith({ kind: "investigation", snapshot: { label, investigation, sourceText } }, layoutKey)` with the current layout key.
2. WHEN the dialog is closed or cancelled THEN the intake service SHALL resolve `{ ok: false, reason: "cancelled" }`, and the comparison writes nothing. WHEN a failure of 3.6, 6.2, 7.5, 7.6 or 8.4 occurs THEN it SHALL resolve `{ ok: false, reason: "failed", message }`, where `message` is the failure sentence without `The previous investigation is unchanged.` It SHALL write no status message for it. The comparison writes `<message> The current investigation is unchanged.` (`UNCHANGED` of `src/features/compare/sources.ts`).
3. WHEN `Open` of a saved investigation is activated in `after` mode THEN THE SYSTEM SHALL resolve the record as the result without opening it. The save controls of 5.1 are absent in `after` mode, so a newer snapshot is never saved.
4. THE SYSTEM SHALL keep `ViewState.investigation`, `selection`, `routeFilter`, `camera`, `expandedWings` and `layout` deep equal before and after any `after` mode call, whatever its outcome, until the comparison itself starts (`tests/intake/after-mode.test.tsx`, P5).

### Requirement 10: Look, keyboard, focus, viewport and motion

**User Story:** As a keyboard or screen reader user, and as anyone who sees the screen, I want both dialogs to look like the rest of the candlelit manor and follow the app's dialog rules exactly, so that the intake routes are part of the same journey as the rest of the product.

#### Acceptance Criteria

1. THE SYSTEM SHALL show, on the landing screen, inside the existing `<div className="landing-actions">` and after `Explore the annex`, the buttons `Analyze a local folder` and, when `kinds` includes `"github"`, `Load a GitHub repository`. Neither has the class `primary`, so `Explore the manor` stays the one brass plate of the screen. The DOM and Tab order SHALL be `Explore the manor`, `Explore the annex`, `Analyze a local folder`, `Load a GitHub repository`.
2. THE SYSTEM SHALL give the local dialog this Tab order:
   - first screen: `Choose a folder` (when rendered), `Choose a graph file`, then `Open <label>` and `Forget <label>` for each saved item, then `Close`;
   - review: the list region `Included files (<n>)`, the list region `Skipped files (<k>)`, `Analyze`, `Back`, `Close`;
   - while working: `Cancel`;
   - result screen: `Save investigation on this device`, `Include source text`, `Close`.

   The GitHub dialog's Tab order SHALL be `Repository URL`, `Branch or tag` (when rendered), `Load`, `Close`, and while working `Cancel`.
3. THE SYSTEM SHALL follow the dialog rules of `.kiro/steering/accessibility-and-motion.md`: `role="dialog"`, `aria-modal="true"`, `aria-labelledby` the heading, Tab trapped, Escape closes, focus returned to the opener (1.3), a visible focus ring from `tokens.css` (never removed), and every control named. `tests/intake/e2e/local.spec.ts` and `github.spec.ts` run each dialog's journey with keyboard input only and call `assertFocusVisibleAndUnobscured` of `tests/e2e/helpers.ts` after every Tab.
4. THE SYSTEM SHALL style both dialogs from `src/features/import/intake.css` with the manor theme only:
   - the panel uses `background: var(--panel)` and `border: 1px solid var(--wall-line)`;
   - the heading uses `--font-display` in `var(--focus)`, as the brand does;
   - body text uses `--font-ui` in `var(--ink)` and `var(--ink-muted)`;
   - paths, labels, counts and sizes use `--font-mono`;
   - the backdrop is built from `var(--floor)`;
   - controls use the shared `button`, `button.primary` and `input[type="text"]` rules of `app.css` and are at least `var(--hit)` tall.

   `intake.css` SHALL hold no color literal, no font size under 12 px, no `outline: none`, `outline: 0` or `outline-style: none`, no `animation` and no `transition` (`tests/intake/styles.test.ts`). No new token is added, so the contrast ratios recorded for the palette apply unchanged.
5. WHEN the viewport is 1,024 × 640, 1,280 × 720, 640 × 360 or 360 × 640 CSS px THEN each dialog SHALL fit the viewport width, scroll vertically inside the viewport when it is taller, and cause no horizontal page scroll. The two lists of the review SHALL be scrollable regions with `tabindex="0"` and an `aria-label` equal to their headings.
6. THE SYSTEM SHALL animate nothing in either dialog; changes of progress text are plain re-renders, so reduced motion and the `Motion` toggle need no special case.
7. THE SYSTEM SHALL follow the words rule in every string of both dialogs, the landing buttons and the comparison buttons. Every string lives in `src/features/import/messages.ts` or `src/features/github/messages.ts`, and `tests/intake/messages.test.ts` fails on a hyphen or dash between two letters in any of them. Parts that come from data (folder names, paths, labels, URLs, error names) are exempt.

### Requirement 11: Verification and evidence

**User Story:** As the owner, I want every criterion of this spec backed by a named test, a recorded run or a screenshot made by a test on this PC, so that the README and the write up describe intake only by what was checked.

#### Acceptance Criteria

1. THE SYSTEM SHALL pass `pnpm verify` with every unit, component and property test under `tests/intake/**`, which the existing Vitest projects already collect (`node` for `*.test.ts`, `jsdom` for `*.test.tsx`). It SHALL also pass `pnpm verify:e2e`, with `tests/intake/e2e/**/*.spec.ts` added to the `dev` Playwright project (gate I3 of design). The local route's specs SHALL load the fixture folders with `setInputFiles` on the folder input (Playwright 1.65.1 selects a folder with `setInputFiles`, recorded in `tests/intake/README.md`, so no `selectFiles` hook exists). The GitHub specs SHALL route jsDelivr through `page.route`.
2. THE SYSTEM SHALL add, for each finished task, one row to `docs/kiro-log.md` on the day of the task. The task cell reads `intake, task <n>`, the Credits cell stays empty unless the CLI shows a figure, and the last cell is `none` unless a failure changed the work.
3. THE SYSTEM SHALL keep the evidence of 4.2 and 8.6 under `docs/acceptance/intake/` and `docs/acceptance/img/intake-*.png`, made by Playwright tests on this PC, never by hand. The README and the write up SHALL describe the GitHub route as sending the repository name, the ref and the file paths to jsDelivr. They SHALL describe local analysis as sending nothing only together with a citation of the 4.2 record. They SHALL state that the tool was not tested with users unless a session with users took place.
4. THE SYSTEM SHALL list under `## Intake` in `docs/limitations.md`: subfolders of a repository are not supported; private repositories are not supported; the 400 file GitHub cap and the 1,000 file and 25 MiB local caps; drag and drop and ZIP intake are not available; graph file import reads a bare investigation only; the jsDelivr behaviours observed in task 9 (resolved version, branch refs, caching, error statuses), with the date they were read.

### Requirement 12: A refusal is shown inside the dialog that refused

**User Story:** As a person who activates `Load` or `Analyze`, I want a refusal to appear in the dialog I am looking at, so that I do not think that nothing happened when the only message is in the status region behind the dialog's backdrop. Found on 2026-11-19 in a headless run of the built app: `https://github.com/Midknight56/hauntmap` gave `has 509 included files; the limit is 400` only in the dimmed status bar.

#### Acceptance Criteria

1. WHEN the GitHub dialog refuses a load in `open` mode (the 400 file cap of 7.5, the 25 MiB cap, no included files, a failed resolve or listing of 7.6, a failed file of 8.4, a failed analysis) THEN THE SYSTEM SHALL show the same sentence that it writes to the status region, including `The previous investigation is unchanged.`, as `<p role="alert">` inside the dialog under the field it concerns (`Repository URL`), in addition to the status message. The field's `aria-describedby` SHALL name the alert, focus SHALL stay on `Load` (7.6), and the next `Load` SHALL clear the alert. A bad address (7.2) is shown the same way.
2. IN `after` mode the dialog closes with the bare message (9.2), so it shows no alert and writes no status message for the failure.
3. WHEN the local dialog refuses in `open` mode (a read error or a failed analysis of 3.6, a graph file of 6.2) THEN THE SYSTEM SHALL show the same sentence as `<p role="alert">` in the dialog, in addition to the status message: a read error or a failed analysis above the buttons of the review, with focus on `Analyze` (3.3), and a graph file refusal under `Choose a graph file`, whose `aria-describedby` names it and which keeps focus (6.2). The alert is cleared by the next `Analyze`, `Back`, folder choice or graph file choice. The caps and the empty folder of 2.5 are already in the dialog, next to `Analyze`, which they describe (`aria-describedby`), and need no alert.
4. THE SYSTEM SHALL keep the status region as the one `role="status"` element (`accessibility-and-motion`); the alerts are `role="alert"` and no `aria-live` attribute is added. `tests/intake/github-intake.test.tsx` and `local-intake.test.tsx` (12.1, 12.3) and `tests/intake/e2e/github.spec.ts` 12.1 (a routed listing of 509 files) check this.

### Requirement 13: A summary shows only the counts that are not 0

**User Story:** As a person reading the summary after an analysis, I want only the numbers that change what I do next, so that `0 binary files skipped` and `0 files failed to parse` do not make me look for a problem that is not there. Found on 2026-11-19: the summary of a local analysis read `Analyzed src: 142 modules, 507 relations, 4 diagnostics; 11 files skipped before reading, 0 binary files skipped, 0 files failed to parse.`

#### Acceptance Criteria

1. THE SYSTEM SHALL leave out of the local summary (3.5) every part whose count is 0: `<m> modules`, `<r> relations`, `<d> diagnostics`, `<k> files skipped before reading`, `<b> binary files skipped` and `<f> files failed to parse`. The parts that remain keep their order, the first three are joined by `, ` after the colon, the last three by `, ` after a `; `, and a count of exactly 1 keeps the singular noun. When every part is left out the sentence is `Analyzed <folder>.`; when the first group is left out the second follows the colon without a `;`. Example: `Analyzed src: 142 modules, 507 relations, 4 diagnostics; 11 files skipped before reading.`
2. THE SYSTEM SHALL leave out of the GitHub summary (8.5) every part whose count is 0 in the same way: `Loaded <owner>/<repo>@<ref>: <n> files, <m> modules, <r> relations.` when there are no diagnostics, and `Loaded <owner>/<repo>@<ref>.` when every part is 0.
3. `tests/intake/messages.test.ts` (13.1, 13.2), the summary cases of `local-intake.test.tsx` and `tests/intake/e2e/local.spec.ts` check this. The graph file message of 6.3 is not a summary of a count of problems and is unchanged.