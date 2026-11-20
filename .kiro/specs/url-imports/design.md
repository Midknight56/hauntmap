# Design: url-imports

## The change

One function changes: `resolveSpecifier` in `src/analysis/parser/resolve.ts`. After the relative and absolute path checks it returns `external` for a `node:` built-in, `external` for a valid package name, and `alias-not-configured` for everything else. A URL falls into the last case because `:` and `//` are not in `PACKAGE_NAME`.

Add one module constant beside `NODE_BUILTIN`:

```
const REMOTE_URL = /^https?:\/\/[^\s/?#]+(?:[/?#]\S*)?$/;
```

and one line in `resolveSpecifier` after the `node:` line:

```
if (REMOTE_URL.test(specifier)) return { resolution: "external", to: null };
```

How the expression gives each case of the requirements:

- `^https?:\/\/` is case sensitive and has two slashes, so `HTTPS://x`, `Http://x` and `https:/x` fail (2.3).
- `[^\s/?#]+` is the host part: at least one character that is not whitespace, `/`, `?` or `#`. `https://`, `https:///lib.js`, `https://?x` and `https://#x` fail (2.1). A port and a `user@` part are characters of this group, so they pass (1.2).
- `(?:[/?#]\S*)?$` allows a path, query or hash and nothing else. `\S*` and the `[^\s...]` group reject any whitespace, including inside the path (2.2). Host alone passes (`https://cdn.example.com`).
- Other schemes do not start with `http`, so they reach the alias line as before (2.4). `//cdn...` and `/x` return earlier through the absolute path line (2.5).
- The line sits after the relative and absolute checks, and the local index is read only inside the relative branch. A URL never reaches a candidate lookup, so the result is external whatever module paths exist (1.3).

Where the new line goes relative to `isValidPackageName` does not matter, since no URL is a valid package name; it is placed before it so that the three external rules read in order.

## Why this shape

- No new file and no new package. The constant lives in `resolve.ts` beside `PACKAGE_NAME` and `NODE_BUILTIN`, as in `node-builtins`.
- A regular expression and not `new URL(...)`. `URL` is a DOM and Node global that parses and normalizes, and it accepts forms this resolver should not rule on (`https:/x` parses as a host `x`). The analysis module may not use a DOM API (`tests/analysis-boundary.test.ts`), and normalizing would make the specifier in the relation ID differ from the source text.
- Only `http` and `https`. They are what the request names, and a remote dependency is the one case where "external" is certain. `file:` and `data:` do not name a remote dependency; `jsr:` and `npm:` name packages, and treating them as external is a separate decision about registry specifiers. Each is listed in requirement 2.4 so that a later change can pick them up with its own tests.
- Lower case scheme only. It matches how `node:` is handled and keeps one rule for prefixes. Source code written with `HTTPS://` is rare, and a reader of the log sees `alias-not-configured` and not a wrong guess.
- No change to `isValidPackageName`. It has other callers' tests (`isValidPackageName("a//b")` is `false`), and a URL is not a package name.
- No change to the contract. `external` with `to: null` and no `reason` is an existing state, so `src/contracts/types.ts`, `src/contracts/validate.ts`, the JSON of existing investigations and `schemaVersion` stay as they are. A reader of an old file still validates it, and an old file that has a URL import as `unresolved` is still shown as it was written; a new analysis of the same folder gives the new result. This is an intended change of output for those folders and is stated in the log row.
- The diagnostic goes away without code in `analyze.ts`. `analyze.ts` pushes a diagnostic only when `resolution === "unresolved"`, so an `external` URL import produces none (4.2). The relation ID is already built as `[resolution, specifier]` for non-local results, which gives `["external", "https://cdn.example.com/lib.js"]` (4.1).
- The user-facing places need no code. The inspector shows `Reason:` only when `record.reason` is set; the sealed doorway tooltip prints `record.resolution`; the Evidence view, the command line tool and the MCP server read the same `ImportRecord`; comparison keys on `relationId`. The Legend wording `Unresolved or external import: sealed doorway with ?` already covers both states. The task that checks this runs the existing UI, Kiro and comparison suites and edits none of them.

## What the change does not do

- It does not fetch a URL, pin a version, read import maps, check that a host exists or look at a lockfile. The rule in `.kiro/steering/analysis.md` that analyzed source is never executed or fetched still holds, and a test pins that `resolveSpecifier` is a pure function of its arguments.
- It does not claim the remote code is safe or unchanged. A changed `sourceHash` of the importing module is the only change signal, and it is not a behavior claim.
- It does not add a `url` field or a new legend entry. A UI that wanted to show the host would be a separate spec owned by `investigation-ui`.

## Files

| Path | Change |
| --- | --- |
| `src/analysis/parser/resolve.ts` | The constant, one line in `resolveSpecifier`, the doc comment of `resolveSpecifier`. |
| `tests/analysis/resolve.test.ts` | New cases for requirements 1 to 3; remove `"http://example.com/x.js"` from the alias list (requirement 5.1). |
| `tests/analysis/analyze.test.ts` | One case that analyzes in-memory files and checks the record, the relation ID and the absence of a diagnostic (requirement 4). |
| `docs/limitations.md` | One bullet in the `Resolver` section. |
| `docs/kiro-log.md` | One row for each finished task. |

Owner: `analysis-core`. The files above are all inside the folders that spec owns (`src/analysis/**`, `tests/analysis/**`) or are documents the spec before this one also edited. No other folder changes, and no fixture or `expected.json` is edited or added. `.kiro/steering/analysis.md` and `.kiro/specs/analysis-core/requirements.md` are named in requirement 5.3 and left alone.

## Verification

- `pnpm exec vitest run tests/analysis/resolve.test.ts tests/analysis/analyze.test.ts` for the new cases.
- `pnpm exec vitest run tests/analysis tests/fixtures` to confirm that no fixture count changes (requirement 5.5).
- `pnpm typecheck` and `pnpm lint`.
- `pnpm verify` before the branch is merged, as `.kiro/steering/ownership.md` says. If it was not run, the log row says so.
