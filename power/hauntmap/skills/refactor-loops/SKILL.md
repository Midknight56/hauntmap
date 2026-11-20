---
name: refactor-loops
description: Check dependency loops before and after you change imports in a JavaScript or TypeScript folder, with HauntMap's cycles, who_imports and compare tools.
---

# Check import loops around a change

Use this when you add, remove, change or move an import, a re-export or a module file in a folder, or when someone asks for the dependency loops, circular imports or importers of a module.

The HauntMap tools take a folder inside the current workspace, written relative to it, such as `src` or `haunts/manor`. A folder outside the workspace is refused. The default preset is `static-value`: static imports and re-exports of values. A type only re-export does not close a loop under it.

## Before the change

1. Call `cycles(root, "static-value")` and keep the list of loops in your notes. Each loop has its members and one witness walk.
2. If you need to know who depends on a module you are about to change, call `who_imports(root, module, "static-value")` and read `direct` and `indirect`.
3. Copy the folder to a place that is not analyzed, for example `.hauntmap/before/<name>`, before the first edit. That copy is the "before" folder for `compare`. If the project already has a clean copy, use it.

## After the change

1. Call `cycles(root, "static-value")` again.
2. Call `compare(rootBefore, rootAfter)` with the untouched copy as `rootBefore`.
3. Report, copied from the tool result: every `relationId` in `removedRelations`, every `relationId` in `addedRelations`, and the cyclic component count before and after.
4. For each loop that is new or closed, name the members and the import line that opened or closed it (module, line and the specifier).

## If a relation you did not mean to change appears

Stop. Revert the edit and report the unexpected relation IDs. Do not explain them away.

## What the result means

A removed or added relation is a structural fact about static imports under the named preset. It is not a correctness, safety or performance claim, and a graph shape is not a risk signal. Say so when you summarize. Report only what the tools returned. If a tool is not available, say that, and do not describe another command as a tool call.
