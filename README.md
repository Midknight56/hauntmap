# HauntMap

HauntMap turns the imports of a TypeScript or JavaScript project into a haunted manor you can walk through. Folders are wings, files are rooms, imports are doors, and a dependency loop is a glowing corridor that a ghost walks round and round. It reads source text only and never runs it.

Category: Costume Contest.

Live app: https://hauntmap.midknight-ent-llc.workers.dev

## Judging criteria at a glance

**Potential Impact.** Circular imports and tangled modules are a daily problem in JavaScript and TypeScript projects, and they are hard to see in a file tree. HauntMap finds every dependency loop and shows the exact import line behind each door, with the source excerpt. Compare two versions and it shows which import was removed or added and whether the loop closed, while every room stays where it was. Everything on the map is also in the Evidence view as plain lists, the whole journey runs with the keyboard alone (`tests/e2e/keyboard-journey.spec.ts`), and it follows reduced motion (`tests/e2e/reduced-motion.spec.ts`). No account, no server, nothing uploaded.

**Technological Implementation.** Kiro wrote the code from four specs (43 requirements, 66 tasks), each reviewed by Kiro before any code. Six steering files hold the rules. HauntMap ships its own MCP server with four tools (`analyze`, `cycles`, `who_imports`, `compare`), and Kiro calls them while it edits: in a recorded session Kiro called `cycles`, removed one import, called `compare`, and reported 1 removed relation and loops 1 to 0. A `Stop` hook then wrote a live snapshot that the app opens. 49 property tests run with fast check. 26 Kiro CLI runs, each logged in `docs/kiro-log.md`.

**Design.** A complete product, not a proof of concept: a guided three step tour, search, a loop panel, an inspector with the source line, an Evidence view, a minimap, a comparison of two versions and a live snapshot. The look serves the function: the loop glows and a ghost walks it in step order, a removed door becomes a dashed ghost passage and an added door a green arch. A display face for headings, and every text on the map at least 11 px on screen, measured by a browser test.

**Innovation/Idea.** The manor is not decoration: it is the data model. A file is a room you can enter, an import is a door with its line number, and a cycle is a corridor that returns to where it began. Rooms keep their place across two versions, so a change reads as one door closing. The same analysis runs in the browser and in the MCP server, so the agent that edits the code and the person who reads the map see the same facts.

**Presentation.** The demo video (under three minutes, VIDEO_LINK) shows the whole journey in the release build: the tour, the loop and its ghost, the evidence behind a door, search, the Evidence view, the comparison and the live snapshot. The live app opens with no account and no install. This README and `docs/write-up.md` give a source for each figure.

## Try it

Open the live app and choose `Explore the manor`. Then:

1. `Dependency loops`, then choose the loop. The corridor glows and the ghost walks it.
2. Choose a step in the evidence trail to see the import line in the source.
3. `Compare revisions`, then `Revised manor`. One door closes and the loop is gone.
4. `Open live snapshot` opens the file the Kiro hook wrote after the recorded session.

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
| unit, component and property tests (`pnpm verify`) | 1,206 | pass |
| browser tests, headless Chromium (`pnpm verify:e2e`) | 130 | pass |

The MCP server and the command line tool:

```bash
pnpm build:mcp
pnpm hauntmap analyze haunts/manor --out public/demo/live.json
```

`.kiro/settings/mcp.json` registers the server for Kiro. `docs/DEPLOY.md` says how to host the static build.

## How Kiro was used

`docs/write-up.md` has the full account with a source for every figure. In short:

| Kiro feature | What we did |
| --- | --- |
| Specs | Five specs in `.kiro/specs`. Four were built: `analysis-core`, `kiro-integration`, `investigation-ui`, `snapshot-comparison`. Kiro reviewed each spec first and fixed what it found before writing code. `intake` was planned and not built. |
| Steering | Six files in `.kiro/steering`: analysis rules, accessibility and motion, claims policy, ownership of folders, a refactoring rule that makes Kiro call `cycles` before an import change and `compare` after, and the revision note of 16 Nov 2026. |
| Hooks | Three hook files in `.kiro/hooks`. The `Stop` hook `analyze-live` runs `pnpm demo:live`, which writes `public/demo/live.json`; it was seen working in headless CLI sessions. |
| MCP | Our own server `packages/hauntmap-mcp` with four tools over stdio. Kiro used it in recorded sessions (`docs/acceptance/mcp-first-use.md`, `docs/acceptance/h9-session/`). |
| Property tests | 49 fast check properties in 8 files. The Kiro CLI has no spec correctness button, so the analysis properties were written from the acceptance criteria. |
| CLI | All work ran in the Kiro CLI with no person at the keyboard, one written prompt per batch of tasks, test first. Every run is a row in `docs/kiro-log.md`. |

## What it does not do

It reads a documented subset of the import rules of Node and TypeScript, not all of them. It shows the shape of static imports, not runtime behaviour, correctness, risk or test coverage. Comparison works on the bundled manor pair and the live snapshot, not on two folders you pick. More in `docs/limitations.md`.

## Licence

MIT, see `LICENSE`. Third party notices: `docs/third-party-notices.md`.
