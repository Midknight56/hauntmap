# Requirements: url-imports

An import whose specifier is an `http://` or `https://` URL, such as `import { x } from "https://cdn.example.com/lib.js"`, names a module on a remote host. The resolver now reports it as an unconfigured path alias (`unresolved`, reason `alias-not-configured`) and writes an `unresolved` diagnostic, because the colon fails the package name test. The message then says the import "looks like a path alias", which is wrong for a URL. A URL import is a boundary of the analyzed folder in the same way as a package name, so it is external. `.kiro/steering/analysis.md` and `.kiro/steering/revision-2026-11-16.md` apply, and the spec `node-builtins` is the model for the shape of the change.

The analysis never fetches, executes or evaluates a URL. This change classifies the specifier text only.

## 1. A URL import is external

1.1 WHEN a specifier starts with the lower case text `http://` or `https://` and is followed by a non-empty host, with no whitespace character anywhere in the specifier, THE SYSTEM SHALL resolve it as `{ resolution: "external", to: null }`, the same result as `react`.
1.2 `https://cdn.example.com/lib.js`, `http://cdn.example.com/lib.js`, `https://cdn.example.com`, `https://cdn.example.com:8443/a/b.mjs`, `https://cdn.example.com/lib.js?v=2#top` and `https://user@cdn.example.com/lib.js` each resolve as external, with no `reason`.
1.3 WHEN a URL specifier is resolved, THE SYSTEM SHALL return external whether or not a local module has a path that looks like the URL, and a URL import SHALL never become a local room.
1.4 The specifier is not parsed with `URL`, normalized, lower-cased, shortened or checked against a list of hosts. The resolution depends on the text only, so `https://cdn.example.com/lib.js` and `https://CDN.example.com/lib.js` are two different specifiers.

## 2. Malformed and other schemes stay unresolved

2.1 WHEN a specifier is exactly `https://` or `http://`, or its host is empty as in `https:///lib.js`, `https://?x` or `https://#x`, THE SYSTEM SHALL resolve it as `{ resolution: "unresolved", to: null, reason: "alias-not-configured" }`.
2.2 WHEN a specifier starts with `http://` or `https://` and contains a whitespace character, as in `https://cdn.example.com/my lib.js`, THE SYSTEM SHALL resolve it as unresolved with reason `alias-not-configured`.
2.3 WHEN the scheme is not exactly lower case `http` or `https`, as in `HTTPS://cdn.example.com/lib.js`, `Http://cdn.example.com/lib.js` or `https:/cdn.example.com/lib.js`, THE SYSTEM SHALL resolve it as unresolved with reason `alias-not-configured`.
2.4 WHEN a specifier uses another URL scheme (`file:`, `data:`, `blob:`, `ftp:`, `ws:`, `wss:`, `jsr:`, `npm:`), THE SYSTEM SHALL resolve it as unresolved with reason `alias-not-configured`, as before this change. `file:` points into the analyzed machine, and `data:` carries code inline; neither is a remote dependency this change claims to understand. Other schemes are a later change.
2.5 WHEN a specifier starts with `//`, as in `//cdn.example.com/lib.js`, THE SYSTEM SHALL return `absent-file`, as before this change, because a leading `/` is an absolute path.

## 3. Other specifiers do not change

3.1 WHEN a specifier is relative, starts with `/`, `#`, `@/` or `~/`, is a valid npm package name or is a `node:` built-in, THE SYSTEM SHALL return the same resolution as before this change.
3.2 `isValidPackageName` SHALL keep its result for every input: `isValidPackageName("https://cdn.example.com/lib.js")` is `false`, because a URL is not a package name.
3.3 `ResolutionKind`, the `reason` values and the contract in `src/contracts/types.ts` SHALL stay as they are. `schemaVersion` stays `1`. No new `reason`, no new diagnostic code, and no new field on an import or a module.

## 4. What the user sees

4.1 WHEN an import of a URL is analyzed, THE SYSTEM SHALL record its `ImportRecord` with `resolution: "external"`, `to: null`, no `reason` and `relationId` `JSON.stringify([from, ["external", specifier], syntaxKind, dependencyKind])`, with the full specifier text in the second place.
4.2 WHEN an import of a URL is analyzed, THE SYSTEM SHALL add no diagnostic for it. In particular it adds no `unresolved` diagnostic and no message that says "looks like a path alias". The diagnostic count of an investigation with URL imports falls by one for each such occurrence, and no other diagnostic changes.
4.3 WHEN the inspector, the Evidence view, the tooltip of a sealed doorway or the command line tool and the MCP server show a URL import, THE SYSTEM SHALL show it exactly as it shows an external package: `resolution` `external`, no `Reason:` line, and the full specifier as a text node. No code under `src/components`, `src/features` or `src/scene` changes for this.
4.4 WHEN a URL import is added, removed or changed between two snapshots, THE SYSTEM SHALL report it through the existing relation ID rules of `ComparisonResult`, as it does for a package import. Two occurrences of the same URL with the same kinds in one module share one relation ID, as two imports of one package do.
4.5 A URL import SHALL never be an edge of the cycle graph under any preset, because only `local` edges count.
4.6 The inspector and the tooltip say `external`. They do not say that the URL is reachable, safe, pinned, current or the code that ran. The documents say the same (requirement 6).

## 5. Existing tests and documents the change makes wrong

5.1 `tests/analysis/resolve.test.ts`, test `records alias-not-configured for a bare specifier that is not a valid package name`, line 172: the list contains `"http://example.com/x.js"`. After this change that specifier resolves as external, so the test fails. The task that fixes it removes that one string from the list and puts the case under requirement 1 in the new test. The other six strings stay.
5.2 `src/analysis/parser/resolve.ts`, the doc comment above `resolveSpecifier`: it says "any other bare specifier ... is an unconfigured alias". After this change a URL is a second exception, so the comment is wrong until it names URLs.
5.3 `.kiro/steering/analysis.md`, the line "A bare specifier that is not a valid package name (`@/lib/format`, `~/config/env`) is `unresolved` with reason `alias-not-configured`" and `.kiro/specs/analysis-core/requirements.md`, requirement 5 of the resolver section (line 38): both say every bare specifier that is not a valid package name is an unconfigured alias. A `node:` built-in already broke this sentence in the same way, and `node-builtins` did not edit them. This spec does not edit them either, because a steering file and another spec are outside its folder. Until their owner edits them, `.kiro/steering/revision-2026-11-16.md` says that a later spec wins, and `docs/limitations.md` carries the current rule.
5.4 `docs/limitations.md` has no line that is wrong. Its `Resolver` section covers `node:` only, so it is incomplete until the new line of requirement 6 is added.
5.5 No fixture, no `expected.json` and no file under `public/demo` is wrong. A search of `tests/fixtures`, `public/demo` and `tests/ui/fixtures` found no import whose specifier starts with `http:` or `https:`; the only URLs there are string literals in `public/demo/annex/config/settings.js` (`baseUrl`), which are not imports and stay unextracted. The task that runs the whole analysis suite confirms this. If a count of externals or diagnostics in a fixture changes, stop and report it; do not edit the fixture.

## 6. Documents and records

6.1 `docs/limitations.md` SHALL state, in the `Resolver` section, that an import of an `http://` or `https://` URL is recorded as external with no target; that the URL is not fetched, parsed or checked; that other schemes (`file:`, `data:`, `jsr:`, `npm:` and so on) and malformed or upper case forms stay unresolved with reason `alias-not-configured`; and that external is a statement about the syntax of the specifier and not about the remote code.
6.2 `docs/kiro-log.md` SHALL get one row for each finished task of this spec, on the same day, with the credits used.
6.3 No statement about performance, privacy, security or accessibility is added. A URL import being external is a structural fact about static imports under the documented resolver subset, not a claim about the safety of the code behind the URL.
