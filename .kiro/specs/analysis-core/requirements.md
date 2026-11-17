# Requirements Document

## Introduction

The analysis core turns a set of source files into an `Investigation`: the modules, every import with its exact place in the source, and honest diagnostics for what could not be resolved. From an `Investigation` it computes dependency cycles and reverse traces. It also defines the worker protocol and owns the two bundled samples, `manor` and `annex`, with their hand written expected facts. One analysis module serves the app, the worker, the command line tool and the MCP server. Every other HauntMap spec depends on this one. It implements "Main contracts", "Parser and resolver scope" and "Analysis rules" of the HauntMap plan. The contracts in the design are copied from that plan and must not be changed.

## Requirements

### Requirement 1: Source selection
**User Story:** As a developer, I want to see which files are analyzed and which are skipped, so that I trust the coverage.

#### Acceptance Criteria
1. WHEN `selectSources(files, rootLabel, options)` is called THEN THE SYSTEM SHALL keep files whose extension is in `includeExtensions` and SHALL list every other file in `skipped` with one reason: `excluded-dir`, `extension`, `oversized`, `secret-pattern` or `binary`. A file is `binary` when its text contains a NUL character in its first 8,192 characters.
2. THE SYSTEM SHALL skip a file inside any directory named in `excludeDirectories` and a file whose name matches `excludeFilePatterns`, before its text is read by the analysis.
3. IF a file is larger than `maxFileBytes` THEN THE SYSTEM SHALL skip it with reason `oversized` and add an `oversized` diagnostic.
4. IF the kept files exceed `maxFiles` or `maxTotalBytes` THEN THE SYSTEM SHALL return no source set, and SHALL return one `cap-reached` diagnostic that states the limit, the count found and the first path over the limit. The first path over the limit is found in code unit order of the normalized paths: the file after the `maxFiles`-th for the file cap, and the first file whose running byte total passes `maxTotalBytes` for the byte cap.
5. THE SYSTEM SHALL normalize every path to forward slashes, relative to the root, with no leading `./`.
6. IF two paths differ only in letter case THEN THE SYSTEM SHALL add a `case-collision` diagnostic for both and keep both files in the source set. IF two inputs normalize to the same path THEN THE SYSTEM SHALL reject the second with a `duplicate-path` diagnostic.

### Requirement 2: Extraction
**User Story:** As a developer, I want every import found with its line and column, so that a door on the map can show me the exact code.

#### Acceptance Criteria
1. THE SYSTEM SHALL parse `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs` and `.mts` files with the Babel parser in the mode that fits each extension.
2. THE SYSTEM SHALL extract static import declarations, side effect imports, `export ... from` and `export * from`, each with its specifier text, its line and its column, both one based. The line and column are those of the first character of the declaration, which is the `import` or `export` keyword.
3. THE SYSTEM SHALL classify `syntaxKind` and `dependencyKind` separately: a declaration with only type specifiers is `type`, a declaration with value and type specifiers is `mixed`, a side effect import and `export * from` are `value`, and `export type * from` is `type`.
4. IF a file cannot be parsed THEN THE SYSTEM SHALL record the module with `parseStatus` `failed` and no imports, add one `parse-failed` diagnostic with the line and column of the parse error, and SHALL still analyze every other file.
5. THE SYSTEM SHALL never execute, import, evaluate or fetch analyzed source.

### Requirement 3: Resolution
**User Story:** As a developer, I want each import resolved by a small documented rule set, so that the map never shows an edge that is a guess.

#### Acceptance Criteria
1. WHEN a specifier is relative THEN THE SYSTEM SHALL try, inside the root only and in this order: the exact file, then the suffixes `.ts`, `.tsx`, `.mts`, `.js`, `.jsx`, `.mjs`, then `index.ts`, `index.tsx`, `index.js`, `index.jsx` inside a directory of that name.
2. WHEN the exact file of a `.js` or `.mjs` specifier is absent THEN THE SYSTEM SHALL try `.ts` then `.tsx` for `.js`, and `.mts` for `.mjs`. WHEN the exact file exists THEN THE SYSTEM SHALL use it and not the fallback.
3. IF no candidate exists THEN THE SYSTEM SHALL record resolution `unresolved` with reason `absent-file`. IF the step that finds a candidate matches two or more paths that differ only in letter case THEN it SHALL record `unresolved` with reason `ambiguous-candidate`.
4. WHEN a specifier is bare and is a valid npm package name, with an optional scope and an optional subpath, THEN THE SYSTEM SHALL record resolution `external` with `to` null.
5. WHEN a specifier is bare and is not a valid npm package name, such as `@/lib/format` or `~/config/env`, THEN THE SYSTEM SHALL record `unresolved` with reason `alias-not-configured`.
6. THE SYSTEM SHALL keep every unresolved, ambiguous or unsupported import in `diagnostics` with its module, line, column and specifier.

### Requirement 4: Records and identifiers
**User Story:** As another part of the app, I want stable identifiers, so that selection, comparison and evidence never depend on layout.

#### Acceptance Criteria
1. THE SYSTEM SHALL build `occurrenceId` as `JSON.stringify([from, line, column, specifier])` and `relationId` as `JSON.stringify([from, targetKey, syntaxKind, dependencyKind])`, where `targetKey` is `["local", to]` for a resolved local import and `[resolution, specifier]` otherwise.
2. THE SYSTEM SHALL set each module's `sourceHash` to the SHA-256 hex of its UTF-8 text, using the hash function passed in by the caller.
3. THE SYSTEM SHALL return an `Investigation` with `schemaVersion` 1 and `resolverMode` `documented-source-subset`, and SHALL never put source text into it.
4. THE SYSTEM SHALL sort `modules` by id, `imports` by `occurrenceId` and `diagnostics` by module, line, column and code, comparing strings by UTF-16 code unit order and never by locale, so that the same input gives the same bytes.

### Requirement 5: Cycles
**User Story:** As a developer, I want each dependency loop shown once with a real path, so that I can follow it room by room.

#### Acceptance Criteria
1. WHEN `findCycles(investigation, preset)` is called THEN THE SYSTEM SHALL compute strongly connected components over the resolved local imports that the preset includes.
2. THE SYSTEM SHALL report a component of size one only when the module imports itself.
3. THE SYSTEM SHALL return, for each component, its members sorted, and exactly one witness: a closed walk that starts at the smallest member and names the relation id of each step. The witness lists each module of the walk once, so `modules` and `relationIds` have the same length, and step `i` is the relation from `modules[i]` to `modules[(i + 1) % modules.length]`.
4. THE SYSTEM SHALL include `import` and `re-export` syntax with `value` or `mixed` kind under `static-value`, add `type` relations under `type-inclusive`, and add `dynamic-literal` syntax under `dynamic-inclusive`. `type-inclusive` and `dynamic-inclusive` each extend `static-value` and neither includes the other's addition.

### Requirement 6: Trace
**User Story:** As a developer, I want to know what is affected when a module changes, so that I can judge a refactor.

#### Acceptance Criteria
1. WHEN `trace(investigation, origin, direction, preset)` is called THEN THE SYSTEM SHALL return the modules reachable from the origin in that direction, split into `direct` (one relation away) and `indirect`, both sorted and neither containing the origin. Direction `imports` follows the importer to the imported module, and `imported-by` follows the reverse.
2. THE SYSTEM SHALL return `visited` (the origin and every reached module, sorted), and `predecessor` and `distance` for every visited module, so that a shortest path to the origin can be read from them. `distance` of the origin is 0, and `predecessor` has no entry for the origin.
3. IF the origin is not a module of the investigation THEN THE SYSTEM SHALL throw an error that names the origin.

### Requirement 7: Worker protocol
**User Story:** As a user, I want the app to stay responsive and never show a half finished analysis, so that I trust what is on screen.

#### Acceptance Criteria
1. THE SYSTEM SHALL carry `requestId`, `revision`, `kind` and `payload` on every worker message, and every result, progress and error message SHALL echo the `requestId` and the `revision`.
2. WHEN a result arrives with a revision older than the current one THEN `src/workers/client.ts` SHALL discard it.
3. WHEN an analysis is cancelled or replaced THEN THE SYSTEM SHALL terminate the busy worker, create a new one, and reject the cancelled request with an `AnalysisCancelled` error.
4. IF an analysis fails THEN THE SYSTEM SHALL reject that request with the diagnostics and keep the last finished investigation unchanged.

### Requirement 8: Samples and expected facts
**User Story:** As a judge, I want two honest samples, so that I can see the tool on clean code and on messy code.

#### Acceptance Criteria
1. THE SYSTEM SHALL include the `manor` sample under `public/demo/manor/before` with exactly 40 modules of original code and these facts: under `static-value` exactly one cyclic component with members `src/notifications/receipt.ts`, `src/orders/checkout.ts` and `src/payments/charge.ts`; one external import; one import of an absent file; one type only re-export cycle that shows only under `type-inclusive`; one mixed import; one literal dynamic import; and no other external, unresolved or unsupported import. The module `src/notifications/receipt.ts` SHALL import exactly one binding from `src/orders/checkout.ts`, in one import statement, and use it in one statement that can be deleted alone. The module `src/orders/summary.ts` SHALL exist and SHALL NOT reach `src/notifications/receipt.ts` through any import.
2. THE SYSTEM SHALL include `public/demo/manor/after`, which has the same 40 module ids and differs from `before` by exactly: one removed relation, `src/notifications/receipt.ts` to `src/orders/checkout.ts`; one added relation, `src/notifications/receipt.ts` to `src/orders/summary.ts`; and one comment inserted in `src/orders/checkout.ts`. THE SYSTEM SHALL give `after` no cyclic component under `static-value`, and the modules whose `sourceHash` differs between the two SHALL be exactly `src/notifications/receipt.ts` and `src/orders/checkout.ts`.
3. THE SYSTEM SHALL include the `annex` sample under `public/demo/annex` with original code, exactly three cyclic components under `static-value` (two with 2 and 3 members, and one self-loop) that share no module, and exactly two `alias-not-configured` diagnostics, for `@/lib/format` and `~/config/env`.
4. THE SYSTEM SHALL keep an `expected.json` beside each sample and each unit fixture, written by hand from the source files. It SHALL never be produced or refreshed by the analyzer. The `expected.json` of `manor/before` SHALL also list the wings with their module counts, and the specifier and the two line numbers (the import and its use) of the `receipt.ts` to `checkout.ts` relation.
5. THE SYSTEM SHALL keep a script `scripts/check-expected.mjs` that counts the statements that end in a module specifier in each sample with a plain text scan and fails when a count differs from `expected.json`. A statement is counted on the line that matches `from\s+["']`, `^\s*import\s+["']` or `\bimport\(\s*["']`.

### Requirement 9: One module, same bytes
**User Story:** As a maker, I want the app, the tool and the server to agree, so that an agent sees exactly what a person sees.

#### Acceptance Criteria
1. THE SYSTEM SHALL expose the analysis from `src/analysis/index.ts` only, with no import from the DOM, React, the scene or a worker global.
2. THE SYSTEM SHALL give byte identical JSON for the same source set and options on every run, and for a hash function built on Web Crypto and one built on `node:crypto`.
3. THE SYSTEM SHALL keep `tests/analysis-boundary.test.ts`, which fails when a file outside `src/analysis` and `src/contracts` implements extraction, resolution, cycles or trace again.

### Requirement 10: Literal dynamic imports
**User Story:** As a developer, I want lazy imports shown when I ask for them, so that the default map stays simple.

#### Acceptance Criteria
1. WHEN the static extraction fixtures all pass THEN THE SYSTEM SHALL also extract `import("...")` with a string literal as `syntaxKind` `dynamic-literal` and `dependencyKind` `value`.
2. THE SYSTEM SHALL record `import()` with a non literal argument as resolution `unsupported` with reason `nonliteral-dynamic`, with the source text of the argument as its specifier, and add an `unsupported` diagnostic with its module, line and column.
