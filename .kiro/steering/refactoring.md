---
inclusion: always
---
# Refactoring with HauntMap

HauntMap's own analysis is available to you as the MCP server `hauntmap` (tools `analyze`, `cycles`, `who_imports`, `compare`). Roots are directories relative to the repository root, such as `haunts/manor`.

## Before changing imports
- Before you add, remove, change or move any import, re-export or module file in an analyzed root, call `cycles(root, "static-value")` and keep the component list in your notes.
- If you need to know who depends on a module you are about to change, call `who_imports(root, module, "static-value")` and read `direct` and `indirect`.

## After changing imports
- Call `compare(rootBefore, rootAfter)` with the untouched copy as `rootBefore`. For `haunts/manor`, `rootBefore` is `public/demo/manor/before`. For any other root, copy it to `.hauntmap/before/<name>` before your first edit (the folder is git-ignored) and use that copy.
- End your final message with: every `relationId` in `removedRelations` under the heading `Removed relations`, every `relationId` in `addedRelations` under `Added relations`, the two labels, and `cyclicComponentsBefore → cyclicComponentsAfter`, copied from the tool result. If you did not run `compare`, write `compare was not run`.

## What you may edit
- `public/demo/manor/before`, `public/demo/manor/after` and `public/demo/annex` are fixtures owned by `analysis-core`. Never edit them.
- Live edits for a demonstration go to `haunts/manor`; `pnpm demo:reset` restores it from `public/demo/manor/before`.
- Do not run `hauntmap` tools on directories outside this repository.

## What the result means
- A removed or added relation is a structural fact about static imports under the named preset. It is not a correctness, safety or performance claim; say so if you summarize it.
- Report only what the tools returned. The claims policy applies.

## Logging and the recorded session
- If Kiro does not list the `hauntmap` server, run `pnpm build:mcp` once and reconnect. If it still fails, use the CLI (`pnpm hauntmap analyze <root> --out <file>`, `pnpm hauntmap compare <before> <after> --out <file>`), say so, and never describe a CLI run as an MCP call.
- If `compare` reports a relation you did not intend to change, stop, revert the edit and report the unexpected relation IDs instead of explaining them away.
- Append a `docs/kiro-log.md` row the same day listing each tool called, its arguments, the result counts and the credits used; an unlogged call is cited nowhere.
