# HauntMap

HauntMap is our Costume Contest entry: a haunting user interface that is polished and unforgettable, where the spooky design elements enhance the app's function. It turns the imports of a TypeScript or JavaScript project into a haunted manor you can walk through. Folders are wings, files are rooms, imports are doors, and a dependency loop is a glowing corridor that a ghost walks round and round. Kiro built it with spec driven development: five specs, each with requirements, design and tasks, carried out in the Kiro CLI. It reads source text only and never runs it.

Category: Costume Contest.

Live app: https://hauntmap.midknight-ent-llc.workers.dev

## Judging criteria at a glance

**Potential Impact.** Circular imports and tangled modules are a daily problem in JavaScript and TypeScript projects, and they are hard to see in a file tree. HauntMap finds every dependency loop and shows the exact import line behind each door, with the source excerpt. Compare two versions and it shows which import was removed or added and whether the loop closed, while every room stays where it was. Everything on the map is also in the Evidence view as plain lists, the whole journey runs with the keyboard alone (`tests/e2e/keyboard-journey.spec.ts`), and it follows reduced motion (`tests/e2e/reduced-motion.spec.ts`). No account and no server. Local folder analysis sends nothing anywhere; the GitHub route sends the repository name, the ref and the file paths to the jsDelivr CDN (see `docs/limitations.md`).

**Technological Implementation.** Kiro wrote the code from five specs (56 requirements, 81 done tasks), each reviewed by Kiro before any code. Six steering files hold the rules. HauntMap ships its own MCP server with four tools (`analyze`, `cycles`, `who_imports`, `compare`), and Kiro calls them while it edits: in a recorded session Kiro called `cycles`, removed one import, called `compare`, and reported 1 removed relation and loops 1 to 0. A `Stop` hook then wrote a live snapshot that the app opens. 61 `fc.assert` property checks run with fast check. 109 rows in `docs/kiro-log.md`, one for each task or pass.

**Design.** A complete product, not a proof of concept: a guided three step tour, search, a loop panel, an inspector with the source line, an Evidence view, a minimap, a comparison of two versions and a live snapshot. The look serves the function: the loop glows and a ghost walks it in step order, a removed door becomes a dashed ghost passage and an added door a green arch. It fits a 360 by 640 phone and a 1920 by 1080 screen, checked by a browser test that fails on any control under 44 px, any overlap and any clipped text. Every text is at least 12 px on screen. The ghost walks, the glow breathes and the doors swing, and with reduced motion all of it stops.

**Innovation/Idea.** The manor is not decoration: it is the data model. A file is a room you can enter, an import is a door with its line number, and a cycle is a corridor that returns to where it began. Rooms keep their place across two versions, so a change reads as one door closing. The same analysis runs in the browser and in the MCP server, so the agent that edits the code and the person who reads the map see the same facts.

**Presentation.** The demo video (under three minutes, https://youtu.be/7Larlko9x4M) shows the whole journey in the release build: the tour, the loop and its ghost, the evidence behind a door, search, the Evidence view, the comparison and the live snapshot. The live app opens with no account and no install. This README and `docs/write-up.md` give a source for each figure.

## Try it

Open the live app and choose `Explore the manor`. Then:

1. `Dependency loops`, then choose the loop. The corridor glows and the ghost walks it.
2. Choose a step in the evidence trail to see the import line in the source.
3. `Compare revisions`, then `Revised manor`. One door closes and the loop is gone.
4. `Open live snapshot` opens the file the Kiro hook wrote after the recorded session.
5. `Analyze a local folder` opens a dialog that lists what will be read before it reads anything, then analyzes the folder in your browser. `Load a GitHub repository` takes the address of a public repository (`https://github.com/owner/repo`, optionally with `/tree/<branch or tag>`) and fetches its files through jsDelivr. In `Compare revisions`, `Local folder as the newer snapshot` and `GitHub repository as the newer snapshot` use the same dialogs to supply the newer side.

## Run it on your machine

Needs Node 24 and pnpm 12.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

The checks:

```bash
pnpm verify
pnpm verify:e2e
```

| Suite | Count | Result |
| --- | --- | --- |
| unit, component and property tests (`pnpm verify`) | 1,715 | pass |
| browser tests, headless Chromium (`pnpm verify:e2e`) | 243 (1 more is skipped unless `HAUNTMAP_LIVE_NETWORK=1`) | pass |

Both totals are from the runs of 19 November 2026 on one Windows PC (`docs/kiro-log.md`, `intake, task 15`).

The MCP server and the command line tool:

```bash
pnpm build:mcp
pnpm hauntmap analyze haunts/manor --out public/demo/live.json
```

`.kiro/settings/mcp.json` registers the server for Kiro. `docs/DEPLOY.md` says how to host the static build.

## How Kiro was used

`docs/write-up.md` has the full account with a source for every figure. In short:

### Kiro IDE, CLI, Web, Crew

We used the Kiro CLI only: version 3.3.0 on 16 November 2026, 3.4.0 on 17 November and 3.5.0 on 19 November, model `auto`, one written prompt per batch of tasks, 109 rows in the log. Every task is a row in `docs/kiro-log.md`. The Kiro IDE, Web and Crew were not used in this build.

### Custom agents

Not used in this build.

### Agent hooks

Three hook files sit in `.kiro/hooks`. The `Stop` hook `analyze-live` runs `pnpm demo:live`, which writes the live snapshot `public/demo/live.json` that the app opens with `Open live snapshot`. It was seen working in a headless CLI session: the file did not exist before the session and existed after it (`docs/acceptance/hook-analyze-live.md`). The `verify-on-stop` and `typecheck-on-save` hooks are set up, but their output was not seen in a session, and the log says so.

### Spec driven development

Five specs in `.kiro/specs`, all built: `analysis-core`, `kiro-integration`, `investigation-ui`, `snapshot-comparison` and `intake`, with 56 requirements and 81 done tasks (counted from the headings and the ticked boxes on 19 November 2026; a few tasks of the first four were dropped by the revision of 16 November and stay open). Each spec has `requirements.md` (numbered acceptance criteria), `design.md` (contracts, data shapes, the tests that prove each criterion) and `tasks.md` (small steps, each naming the requirements it covers and the check that must pass). Kiro reviewed each spec before any code, and every task wrote its test first, saw it fail, then wrote the code. Compared with vibe coding, the review is where it paid off: Kiro's review of `kiro-integration` found functions and files the spec named that did not exist in the code, and fixed the spec before a line was written.

### Steering docs

Six files in `.kiro/steering`: the analysis rules, accessibility and motion (contrast, text size, reduced motion), the claims policy, folder ownership, the revision note of 16 November 2026, and a refactoring rule that makes Kiro call the `cycles` tool before an import change and `compare` after. In one headless session Kiro made the calls in that order (`docs/acceptance/steering-observation.md`).

### MCP

Our own MCP server, `packages/hauntmap-mcp`, gives Kiro four tools over stdio: `analyze`, `cycles`, `who_imports` and `compare`. In a recorded session Kiro called `cycles`, removed one import, called `compare`, and reported 1 removed relation and loops 1 to 0 (`docs/acceptance/h9-session/`). The same analysis code runs in the browser, so the agent and the person see the same facts.

### Property based testing (PBT)

61 `fc.assert` calls in 10 files (counted on 19 November 2026). The Kiro CLI has no button that derives properties from a spec, so the analysis properties were written from the acceptance criteria. One property found a real bug: it generated the Windows path `link/C:`, which the MCP loader read wrongly, and the fix went into the loader with that path kept as a fixed example.

### Kiro powers

Not used in this build.

## What it does not do

It reads a documented subset of the import rules of Node and TypeScript, not all of them. It shows the shape of static imports, not runtime behaviour, correctness, risk or test coverage. Comparison takes the open investigation as the earlier side and the bundled revised manor, the live snapshot, a local folder or a public GitHub repository as the newer side; a repository is loaded whole, so subfolders and private repositories are not supported. Folders are limited to 1,000 files and 25 MiB, and GitHub repositories to 400 files. The local route sends nothing (`tests/intake/e2e/local.spec.ts`, `docs/acceptance/intake/local-requests.json`); the GitHub route sends the repository name, the ref and the file paths to jsDelivr. One real load of `reduxjs/redux@5.0.1` (197 included files) took 25,307 ms on this PC, above the target of 10,000 ms (`docs/performance.md`). The tool was not tested with users. More in `docs/limitations.md`.

## Licence

MIT, see `LICENSE`. Third party notices: `docs/third-party-notices.md`.
