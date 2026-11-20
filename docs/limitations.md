# Limitations

## Comparison (snapshot-comparison)

Comparison accepts the bundled manor pair, the live snapshot, a local folder or a public GitHub repository as the newer snapshot; the earlier side is always the investigation that is open, and a second folder or repository is loaded through the same dialogs as the first.

The export feature is not built.

A comparison is a structural comparison of relation IDs and source hashes under the documented resolver subset. A removed or added relation is a change in the import graph found in the source; it is not a claim about behaviour, safety or correctness.

## Kiro integration (kiro-integration)

Every `*verify*` mark of the `kiro-integration` spec, `.kiro/hooks/README.md` and `packages/hauntmap-mcp/README.md` is either settled in a log row or an acceptance file, or listed here with its consequence. Settled: the SDK class and request handler names, the error flag and `structuredContent` (`packages/hauntmap-mcp/README.md`, task 4b); the `--filter` syntax of `build:mcp` (the script runs); the headless trust flags of Kiro CLI 3.3.0 (`docs/acceptance/mcp-first-use.md`); the `Stop` trigger and the `analyze-live` side effect (`docs/acceptance/hook-analyze-live.md`).

Not settled:

- The hook field `version: "v1"`, the `timeout` unit (seconds is assumed) and the `matcher` form with Windows path separators were not observed. Consequence: the hook files follow the standalone format the revision of 2026-11-16 states; if Kiro reads a field differently, a hook may not fire, and nothing in this repository depends on it firing except the recorded demo.
- The order of the two `Stop` hooks (`verify-on-stop`, `analyze-live`) was not observed. Consequence: none for correctness, because neither reads what the other writes.
- The shell that runs a hook command and whether it starts in the workspace root were not read from output. Consequence: the commands are plain `pnpm <script>` and the `analyze:` line of the hook was not seen; the command itself was run by hand from PowerShell.
- The save trigger (`PostFileSave`) was not observed to fire from an agent write, and its entry was removed from `analyze-live.json`. Consequence: the live snapshot is written only when a turn ends.
- The Kiro IDE was observed on 20 November 2026, in one window and one run. Its Agent Hooks panel listed all three files of `.kiro/hooks/`. A save by the agent in a new chat session ran `typecheck-on-save`. A Ctrl+S in the editor did not start `pnpm typecheck` in the 25 seconds watched. Consequence: nothing is claimed about other versions or about a longer wait. Record: `docs/acceptance/ide-session/README.md`.
- Whether `compare` prompts for approval in an interactive session was not observed (the headless runs trusted all tools). Consequence: the per-call approval is configured, not observed.
- The `analyze:` line and the duration of the hook in the recorded H9 session are not in the headless transcript. Consequence: the committed `public/demo/live.json` is byte-equal to `docs/acceptance/h9-session/live.json`, and `tests/kiro/live-json.test.ts` checks it; the hook's own output is not shown.
- The raw results of `cycles` and `compare` in the H9 session are not in the headless transcript. Consequence: `mcp-cycles.json` and `mcp-compare.json` were regenerated from the same tool code on the same inputs and are labelled so in `docs/acceptance/h9-session/recording.md`.
- The final headless turn of tasks 12 and 14 (the `identical` skip line) is run by the person. Consequence: until it is logged, the skip rule is checked by `tests/kiro/demo-live.test.ts` and by a manual run of the command, not by a Kiro turn.
- No deployed URL exists in this checkout, so the fetch of `<deployed URL>/demo/live.json` was not run.
## Intake

Local lines, read on 2026-11-19. The GitHub lines below were observed on 2026-11-19 (about 9:25 PM AST) from this PC with `curl`, and the listing, the resolve answers, the 404 cases, the old form and the file URL were requested again at 11:29 PM AST the same night and answered the same. They describe what jsDelivr answered then, not a promise about later.

- Local analysis reads the files of one chosen folder, in the browser. It supports at most 1,000 included files and 25 MiB of included text; above either cap the review says so and nothing is read. A subset is never analyzed.
- Files over 1 MiB, secret or environment files, other file types and the directories `.git`, `node_modules`, `dist`, `build`, `out`, `.next` and `coverage` are skipped, as the command line tool skips them. A file with a NUL in its first 8,192 characters is skipped as binary when it is read.
- Folder selection needs a browser whose file input has `webkitdirectory`. Without it the dialog offers graph file import only.
- Drag and drop and ZIP intake are not available.
- Graph file import reads a bare investigation (what `pnpm hauntmap analyze <root> --out <file>` writes), up to 25 MiB. It carries no source text.
- `Save investigation on this device` writes to IndexedDB in this browser only, on request, and the record stays until `Forget`. Source text is saved only when `Include source text` is checked. Clearing the browser's site data removes the records.
- The request list in `docs/acceptance/intake/local-requests.json` was made by `tests/intake/e2e/local.spec.ts` on this PC and shows the page's own files only. It is a record of one run in one browser, not a proof for other browsers.
- Subfolders of a repository and private repositories are not supported.
- GitHub route, requests: `https://data.jsdelivr.com/v1/packages/gh/{owner}/{repo}/resolved` for a version, `https://data.jsdelivr.com/v1/packages/gh/{owner}/{repo}@{ref}?structure=flat` for the listing, and `https://cdn.jsdelivr.net/gh/{owner}/{repo}@{ref}/{path}` for each file. The older form `v1/package/gh/{owner}/{repo}@{ref}/flat` also answered 200 and is not used.
- GitHub route, listing shape: JSON `{ type, name, version, default, files }`, where each file is `{ name, hash, size }`. Every `name` starts with `/`. `tests/intake/fixtures/gh/listing-small.json` copies this shape with made up entries.
- GitHub route, refs: the listing answered 200 for a branch (`@main`), a tag (`vitejs/vite@v6.0.0`) and a short commit id (`@0e89edc`). A ref that does not exist answered 404 (`@no-such-branch`), and so did a repository that does not exist. A listing without a ref answered 200 with `tags: {}`, `versions: []` and no files, so a ref is always sent.
- GitHub route, version without a ref: `/resolved` (also with `?specifier=latest` or `?specifier=main`) returned the newest tag, for example `8.3.8` for `vitejs/vite`, and `"version": null` for a repository with no tags or releases. A repository with tags therefore loads its newest tag and not its default branch, and the result line names the ref that was used. For a repository without tags the dialog tries `main`, then `master`, then asks for the branch name.
- GitHub route, caching: the listing was served with `Access-Control-Allow-Origin: *` and `Cache-Control: public, max-age=31536000, stale-while-revalidate=86400, stale-if-error=86400`. A branch listing can therefore be a day or more old, and a push may not show at once. The file URL of `package.json` at `@main` answered 200 with `application/json; charset=utf-8`.
- GitHub route, refs with a slash: a ref typed in `Branch or tag` is sent encoded as one path segment (`feature%2Fx`). jsDelivr was not asked for such a ref, so whether it serves one is not observed.
- GitHub route, errors: jsDelivr answers 404 with a JSON message for a missing repository or ref. Private repositories are not supported. The dialog shows the status or the error name it got and nothing else.
- GitHub route, size: at most 400 included files and 25 MiB of included text; above either cap nothing is fetched and the dialog says so. The 400 file cap and the six requests in flight are this build's choices, not jsDelivr limits.
- GitHub route, speed: one real load of `reduxjs/redux@5.0.1` (197 included files) took 25,307 ms on this PC and its connection on 2026-11-19, above the 10,000 ms target. That is one run (`docs/performance.md`); it says nothing about other repositories, connections or times of day.
- GitHub route, privacy: the repository name, the ref and the file paths go to jsDelivr. Nothing else is sent: requests use `credentials: "omit"` and no custom header.

## Resolver

- A specifier of the form `node:` followed by letters, digits, `_`, `/` or `-` (`node:fs`, `node:fs/promises`) is recorded as external with no target; the name is not checked against a list of real Node modules, so `node:nothing` is external too, and the analysis reports the syntax and not the Node version of the analyzed project. Malformed forms (`node:`, `node: fs`, `Node:fs`) stay unresolved with the reason `alias-not-configured`.
