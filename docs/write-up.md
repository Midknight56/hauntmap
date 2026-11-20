# Write up

## How Kiro was used

Every figure in this section comes from a row of `docs/kiro-log.md`, from `docs/performance.md`, or from a file under `docs/acceptance/`. The source sits in brackets after the figure. A figure that has no source here is not claimed.

### What the surface was

HauntMap was built by Kiro in single Kiro CLI sessions, one spec at a time, in one checkout. The log names the surface of every row as Kiro CLI, version 3.3.0 on 16 November 2026 and version 3.4.0 on 17 November 2026, with the model setting `auto`. The Kiro Crew was not used: the revision of 16 November 2026 in `.kiro/steering/revision-2026-11-16.md` removed it, and the Crew tasks of the specs are logged as not done.

Three kinds of work in the log were started by the person who owns the machine, not by an agent: the headless Kiro CLI sessions of 16 November (MCP registration, steering observation, the live hook observation) and the recorded H9 session of 17 November, 10:48 AM. The log rows and the files under `docs/acceptance/` say so, and Kiro read the saved transcripts afterwards.

### The MCP server and the command line tool

The product has a second front door for the same analysis code that the app runs. The package `packages/hauntmap-mcp` holds an MCP server over stdio and a command line tool named `hauntmap`. The server has four tools: `analyze`, `cycles`, `who_imports` and `compare`. The command line tool has two commands, `analyze` and `compare`; it has no `cycles` command [`packages/hauntmap-mcp/src/cli.ts`].

Measured results, each from the log or an acceptance file:

- `analyze` on the sample folder `haunts/manor` returns 40 modules, 72 relations and 1 diagnostic [log, `kiro-integration, task 4c`].
- One `analyze` call over stdio answered in 59 ms, one run, with the server already started, on one machine [`docs/performance.md`]. This says nothing about other folders or other machines.
- In a headless session on 16 November, Kiro called `cycles` on `haunts/manor` with the default relation preset. It returned one component with the three modules `src/notifications/receipt.ts`, `src/orders/checkout.ts` and `src/payments/charge.ts` [log, `kiro-integration, task 6`; `docs/acceptance/mcp-first-use.md`].
- In the recorded session on 17 November, Kiro removed one import and the one statement that used it from `haunts/manor/src/notifications/receipt.ts`, then called `compare`. The result: 1 removed relation, 0 added relations, 1 changed module, relations 72 to 71, cyclic components 1 to 0 [`docs/acceptance/h9-session/app-comparison.json`; `docs/acceptance/h9-session/transcript.md`].
- The app then opened the live snapshot that the hook had written, and the closing corridor was recorded in a headless browser [`docs/acceptance/h9-session/app-recording.webm`; log, `kiro-integration, task 12`].

How the session artifacts were made: the headless output shows tool names but not raw tool results. The files `mcp-cycles.json` and `mcp-compare.json` in `docs/acceptance/h9-session/` were therefore written afterwards from the same tool code on the same inputs. They are not cuts from the transcript, and `recording.md` in that folder says so. The recorded app files were made before the last change to text sizes on the map and were not recorded again [`docs/acceptance/h9-session/recording.md`].

### What the comparison claim means

A removed or added relation is a structural fact about static imports under the default relation preset, which counts value imports and value re exports. It is not a statement about runtime behaviour, correctness, safety, test coverage or performance. A cycle count of 1 to 0 means that one strongly connected component of those imports no longer exists in the analyzed files. The resolver reads a documented subset of import syntax and is not TypeScript, Node or a bundler [`docs/limitations.md`].

### The hooks

Hook files are standalone files under `.kiro/hooks/`. The trigger names `Stop` and `PostFileSave` are fixed by the revision of 16 November 2026, which this write up does not reopen.

| Hook | Trigger | Observed | Surface and date | What was seen |
| --- | --- | --- | --- | --- |
| Live snapshot, file `.kiro/hooks/analyze-live.json` | `Stop` | Yes, by its side effect | Headless Kiro CLI 3.3.0, 16 November 2026 | `public/demo/live.json` did not exist before the session and existed after it, and the session ran no command itself. The hook's own `analyze:` output line was not seen [log, `kiro-integration, task 7`; `docs/acceptance/hook-analyze-live.md`]. |
| Verify on stop, file `.kiro/hooks/verify-on-stop.json` | `Stop` | Yes, 20 November 2026 (first try on 16 November: not observed) | Headless Kiro CLI 3.5.0, agent `haunt-reviewer`, one word prompt | `pnpm verify` started 3.6 s after the session did, seen by a process poll, and its output came back to the session, where the agent quoted its first line. The hook run failed (5 failing cases of a test file that the later tasks satisfied). The process that started it was not identified [log, `kiro-extensions, task 4`; `docs/acceptance/hook-verify-on-stop.md`]. The 26.5 s figure of 16 November is a manual run, not hook output [log, `kiro-integration, task 2`]. |
| Typecheck on save | `PostFileSave` | Not observed | Headless Kiro CLI 3.3.0, 16 November 2026 | One attempt, no hook output reached the session [log, row `Setup: hook observation typecheck-on-save`]. |

A second entry of the live hook, on `PostFileSave`, was deleted because it was never observed. The hook command is `pnpm demo:live`. Its skip rule: when `haunts/manor` is identical to `public/demo/manor/before`, or when the built command line tool is missing, it prints a line that starts with `demo:live: skipped` and exits 0, so the committed `public/demo/live.json` stays as it is. The skip line was seen when the command was run by hand [`.kiro/hooks/README.md`]. The final headless turn that would show it in a Kiro session is left to the person and is not yet in the log [log, `kiro-integration, task 14`].

No hook has been observed in the Kiro IDE. `typecheck-on-save` has the trigger `PostFileSave`, a file save in an editor; it was not seen in any CLI session and is not claimed to run.

### The power, the custom agent and the hook proof

These three were added on 20 November 2026 by the spec `.kiro/specs/kiro-extensions`, in Kiro CLI 3.5.0, model `auto`, with each test file written first and seen failing [log, `kiro-extensions, tasks 1 to 5`]. The Kiro pages they follow were saved on 20 November 2026 (powers, custom agents, the agent harness).

- **Power.** `power/hauntmap` in the Agent Plugins format: `plugin.json`, `mcp.json` and the skill `refactor-loops`. It was installed with `kiro-cli powers install`, one headless session in a throwaway copy of `haunts/manor` called its `cycles` tool and listed the loop of three files, and it was uninstalled with `kiro-cli powers uninstall hauntmap` [`docs/acceptance/power-session/`]. The first two attempts failed: the tool was not trusted in a headless run, and Kiro starts the power's server in the power's own folder, so it could not see the session folder. `mcp.json` now reads the server file and the workspace from two environment variables, which the power's README names. No power from the Kiro registry was used. Not shown: the other three tools, the skill being followed, the IDE route.
- **Custom agent.** `.kiro/agents/haunt-reviewer.json` has file reads and the four HauntMap tools. It passed `kiro-cli agent validate`. One headless run on `public/demo/manor/before` and `after` called `cycles` twice and `compare` once and reported the removed relation, the added relation and loops 1 to 0 with the import line. A second run, with every tool trusted, was asked to write a file and run a shell command and refused both [`docs/acceptance/haunt-reviewer-session/`]. One review of one pair of folders.
- **Hook.** See the table above.

None of these results is a claim that the analyzed code is correct or safe. A loop or a relation is a structural fact about static imports under the `static-value` preset.

### The steering file

`.kiro/steering/refactoring.md` is always included. It tells an agent to call `cycles` before it changes imports, to call `compare` after, and to end its final message with the removed and added relation IDs and the cycle counts, or with the words `compare was not run`. One headless session on 16 November showed the calls in that order: `cycles`, the edit, `compare` (which failed then, because the tool was still a placeholder), and `cycles`. The final message said `compare was not run`. This is one session with one prompt, and no run without the steering file exists, so the log does not claim that the file caused the behaviour [log, `kiro-integration, task 8`; `docs/acceptance/steering-observation.md`].

### Who wrote what

All code, tests and documents in the repository were written by Kiro CLI, version 3.3.0 or 3.4.0, model setting `auto`, under the rules in `.kiro/steering/`. The table names the spec that owned each folder (`.kiro/steering/ownership.md`) and the log rows that record the work.

| Folders | Spec | Written by | Log rows |
| --- | --- | --- | --- |
| `src/analysis`, `src/contracts`, `src/workers`, `tests/fixtures`, `public/demo/manor`, `public/demo/annex`, `tests/analysis` | `analysis-core` | Kiro CLI | `analysis-core, task 1` to `task 15` |
| `packages/hauntmap-mcp`, `haunts`, `scripts/demo-reset.ts`, `scripts/demo-live.ts`, `public/demo/live.json`, `src/features/liveSnapshot`, `tests/kiro`, `.kiro/hooks`, `.kiro/steering/refactoring.md`, `docs/demo`, `docs/acceptance/h9-session` | `kiro-integration` | Kiro CLI. The H9 headless session was started by the person, and `public/demo/live.json` is the file that session's hook wrote | `kiro-integration, task 1a` to `task 15` |
| `src/scene`, `src/features/investigation`, `src/components`, `src/styles`, `tests/ui`, `tests/e2e` | `investigation-ui` | Kiro CLI | `investigation-ui, task 1a` to `task 14`, the theme pass, and its follow up of 17 November |
| `src/analysis/graph/compare.ts`, `src/features/compare`, `src/scene/compare`, `tests/compare` | `snapshot-comparison` | Kiro CLI | `snapshot-comparison/1a` to `/15` |

The `intake` spec (`src/features/import`, `src/features/github`, `tests/intake`, `docs/acceptance/intake`) was built by Kiro CLI 3.5.0, model setting `auto`, on 19 November 2026 at the owner's request; its rows are `intake, task 1` onward in `docs/kiro-log.md`. The `kiro-extensions` spec (`power`, `.kiro/agents`, `tests/kiro/extensions.test.ts`, `docs/acceptance/power-session`, `docs/acceptance/haunt-reviewer-session`) was built by Kiro CLI 3.5.0, model setting `auto`, on 20 November 2026; its rows are `kiro-extensions, task 1` to `task 5` in `docs/kiro-log.md`. The export feature of `snapshot-comparison` was not built, by decision of the revision of 16 November 2026. The Crew definitions of `kiro-integration` were not built either.

### Evidence and credits

Final test runs on 17 November 2026: `pnpm verify` passed with 100 test files and 1,206 tests [log, `kiro-integration, finish of task 12`]. A run of `pnpm verify` took 48 s on an AMD Ryzen 9 9950X under Windows 11 Pro with Node 24.19.0, and the browser suite `pnpm verify:e2e` took 34 s with 117 cases passing on the same machine [log, `snapshot-comparison/15`]. These are times on one named machine, not general performance claims.

The Credits column of `docs/kiro-log.md` is empty in every row. Headless output does not show credits, so the log records no credit figure for any task [`docs/acceptance/h9-session/credits.md`]. Nothing in this write up states a credit total.

### Your own code: local folder and GitHub

A person can analyze a local folder or load a public GitHub repository, and can use either as the newer snapshot of a comparison.

- Local folder: the files are read in the browser and kept in memory. Local analysis sends nothing: `tests/intake/e2e/local.spec.ts` recorded every request of the page and its workers from the moment the dialog opened until the map was open, and none carried the folder name, a path or the file text; the list of requests is `docs/acceptance/intake/local-requests.json`. The record is one run in one headless Chromium on this PC.
- GitHub repository: the repository name, the ref and the file paths are sent to the jsDelivr CDN, at most six requests at a time, with no cookie and no custom header. One real load of `reduxjs/redux@5.0.1` (197 included files) took 25,307 ms on this PC against a target of 10,000 ms [`tests/intake/e2e/github-live.spec.ts`, `docs/performance.md`, `docs/acceptance/intake/github-live-requests.json`]. It is one run and says nothing about other repositories or connections.
- The caps are 1,000 files and 25 MiB locally and 400 files on GitHub. Above a cap nothing is analyzed [`docs/limitations.md`].

### What was not tested

HauntMap was not tested with outside users. No session with an outside developer is in the log. The browser checks run in headless Chromium on one Windows PC; they show that the checked cases pass there and say nothing about other browsers, screen readers or devices. The map shows the shape of the import graph and has no signal about quality, risk, coverage or churn.
