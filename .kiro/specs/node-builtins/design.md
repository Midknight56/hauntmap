# Design: node-builtins

## The change

One function changes: `resolveSpecifier` in `src/analysis/parser/resolve.ts`. It already returns `external` for a valid package name and `alias-not-configured` for every other bare specifier. A `node:` specifier falls into the second case because `:` is not in `PACKAGE_NAME`.

Add one test next to the package name test, before it: a module constant `NODE_BUILTIN = /^node:[A-Za-z0-9_/-]+$/`, and in `resolveSpecifier` after the absolute path line:

```
if (NODE_BUILTIN.test(specifier)) return { resolution: "external", to: null };
```

The anchored expression gives every case of the requirements: `node:` has no name, `node: fs` has a space, `Node:fs` has a capital N, and all three fail the test and reach the alias line unchanged. Relative, `#` and `@/` specifiers never match, because none starts with `node:`.

## Why this shape

- No new file and no new package. The constant lives in `resolve.ts` beside `PACKAGE_NAME`.
- No list of built-in names. A list goes out of date with each Node release and would turn a new module into a false alias diagnostic. The cost is that `node:nothing` is reported external; requirement 3.3 states it.
- `isValidPackageName` is not changed, so its other callers keep their behavior.

## Files

| Path | Change |
| --- | --- |
| `src/analysis/parser/resolve.ts` | The constant, one line in `resolveSpecifier`, its doc comment. |
| `tests/analysis/resolve.test.ts` | New cases for requirements 1 and 2. |
| `docs/limitations.md` | One line. |
| `docs/kiro-log.md` | One row for each finished task. |

Owner: `analysis-core`. No other folder changes. No fixture or `expected.json` is edited. If a fixture count of externals changes after the fix, stop and report it; do not edit the fixture.
