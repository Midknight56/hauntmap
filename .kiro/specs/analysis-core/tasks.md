# Implementation Plan

Ownership: this spec creates the files named in `design.md`. Besides the folders of its row in `.kiro/steering/ownership.md`, it creates the root configuration files (task 1), `docs/kiro-log.md` rows, `tests/analysis/`, `tests/workers/`, `tests/analysis.properties.test.ts`, `tests/analysis.spec-properties.test.ts` and `tests/analysis-boundary.test.ts`. None of these belongs to another spec. It writes nothing under `samples/`, `packages/`, `.kiro/hooks/`, `src/scene/`, `src/features/` or `src/components/`.

Each task ends with `pnpm verify` green. A task writes its tests first, sees them fail, then implements.

- [x] 1. Scaffold the repository and the contracts
  - Create the pnpm workspace with the folder structure of the plan: TypeScript with `strict` on, Vite, Vitest (with `passWithNoTests` until task 2), fast-check, ESLint and a TypeScript script runner for `scripts/*.ts` (*verify* the choice). Pin each version, the Babel parser included, and write each licence in `docs/kiro-log.md`.
  - Add the root scripts `typecheck`, `test`, `verify` and `pack:samples`. `pack:samples` prints `not built yet` and exits 0 until task 13.
  - Create `src/contracts/types.ts` with the contracts from the design, unchanged, including `RelationRef` and `ComparisonResult`, and `src/contracts/options.ts` with `DEFAULT_ANALYSIS_OPTIONS`. 25 MiB is 26,214,400 bytes.
  - Add `LICENSE` (MIT) and a three line `README.md`. `.gitignore` and `docs/kiro-log.md` already exist: extend the first only if a needed entry is missing, and append to the second without changing its header. Do not ignore `.kiro`.
  - Verify: `pnpm verify` exits 0. Save one TypeScript file and write one log row, task cell `Setup: hook observation typecheck-on-save`, in the format of step 5 of `.kiro/hooks/README.md`, saying whether the hook fired. The observation of `verify-on-stop` belongs to `kiro-integration` task 2; do not write it here.
  - _Requirements: 9.1_

- [x] 2. Unit fixtures with hand written facts
  - Create the fifteen fixture folders of the design's table under `tests/fixtures/`. Write each `expected.json` by reading the fixture's source files line by line, with the sections `modules`, `imports`, `diagnostics`, `cycles` (for each preset) and `trace` where the design table gives facts. Use the trace table of the design as the expected values. Do not run any analyzer to produce them.
  - Write `tests/fixtures/fixtures.test.ts` with a structure test only: every fixture folder has a parseable `expected.json` with the sections its row needs, and every source file of the folder is accounted for in `modules`.
  - Verify: `pnpm verify` passes, and a copy of one fixture with a deleted source file makes the structure test fail.
  - _Requirements: 8.4_

- [x] 3. Paths and source selection
  - Write `tests/analysis/select.test.ts` and `tests/analysis/paths.test.ts` first, with one test for each acceptance criterion of requirement 1, including the NUL rule of 1.1, the first path over the limit of 1.4 and keeping both files in 1.6. See them fail.
  - Implement `paths.ts` and `select.ts`, using `DEFAULT_ANALYSIS_OPTIONS`.
  - Verify: `pnpm verify` passes. The `case` fixture's `case-collision` diagnostics equal its `expected.json`.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

- [x] 4. Extraction
  - Read the import and export kind fields of the pinned Babel parser version in its own documentation and write their names in the log. Confirm that the pinned version parses `export type * from`.
  - Write `tests/analysis/extract.test.ts` first. For each fixture it compares `extractImports` with the `specifier`, `syntaxKind`, `dependencyKind`, `line` and `column` of that fixture's `expected.json`, for `kinds`, `parse-fail` and the others that have static imports. Add the test that a file whose top level sets a global flag and throws leaves the flag unset (requirement 2.5). See them fail.
  - Implement `extract.ts` for static imports, side effect imports, `export ... from` and `export * from`, with one based line and column of the declaration's first character, the two kinds and the parser mode of the design.
  - Verify: `pnpm verify` passes with `extract.test.ts` green.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 5. Resolution
  - Write `tests/analysis/resolve.test.ts` first. For `resolve-order`, `js-to-ts`, `absent`, `alias`, `external`, `case` and `same-names` it compares `to`, `resolution` and `reason` with `expected.json`. See it fail.
  - Implement `resolve.ts` with the candidate order, the JS to TS fallback (not used when the exact file exists), the bare specifier rule, the ambiguity rule of the design and the reasons.
  - Verify: `pnpm verify` passes with `resolve.test.ts` green.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [ ] 6. Identifiers and the investigation
  - Write the `modules`, `imports` and `diagnostics` sections of `fixtures.test.ts` for every fixture except `dynamic`, calling `selectSources` and then `analyze` with the selection diagnostics. Add the determinism test of the design (shuffled file order, Web Crypto hash and `node:crypto` hash, no source text in the JSON). See them fail.
  - Implement `ids.ts` and `analyze.ts`: records, hashes through the passed hash function, sorting by code unit order, diagnostics, progress calls.
  - Verify: `pnpm verify` passes, and the same input gives equal JSON text twice.
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 9.2_

- [ ] 7. Presets and cycles
  - Write `tests/analysis/cycles.test.ts` first for the `self-loop`, `two-cycles` and `type-cycle` fixtures, and add the `cycles` section of `fixtures.test.ts`. See them fail.
  - Implement `presets.ts` and `cycles.ts` with Tarjan's algorithm and the witness walk from the design.
  - Verify: `pnpm verify` passes.
  - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [ ] 8. Trace
  - Write `tests/analysis/trace.test.ts` first, with every row of the design's trace table (`chain`, `diamond`, `two-cycles`) and the unknown origin case, and add the `trace` section of `fixtures.test.ts`. See it fail.
  - Implement `trace.ts`.
  - Verify: `pnpm verify` passes.
  - _Requirements: 6.1, 6.2, 6.3_

- [ ] 9. Properties
  - Write `tests/analysis.properties.test.ts` with the seven properties from the design, using fast-check generators that write small sets of files with known imports.
  - Fix every failure in the code, never in the property.
  - Verify: `pnpm verify` passes, and the properties file runs in under 90 seconds.
  - _Requirements: 2.2, 3.1, 4.4, 5.1, 5.3, 5.4, 6.2_

- [ ] 10. Literal dynamic imports
  - Write the `dynamic` fixture tests first: the `modules`, `imports`, `diagnostics` and `cycles` sections, with the three presets. See them fail. Run this task after tasks 4 to 9 pass.
  - Extend `extract.ts` for `import("...")` and for the non literal case, and `presets.ts` for `dynamic-inclusive`.
  - Verify: the `dynamic` fixture passes and `pnpm verify` passes.
  - _Requirements: 10.1, 10.2_

- [ ] 11. Property tests from the spec
  - In the Kiro IDE, open this spec and use the spec correctness feature to generate property tests from the acceptance criteria. If the installed version does not offer it, write the properties by hand from the acceptance criteria, and say so in the log.
  - Keep each generated property that checks something new in `tests/analysis.spec-properties.test.ts`. Remove none of the seven.
  - Write in the log which properties were added and any failure they found.
  - Verify: `pnpm verify` passes.
  - _Requirements: 4.4, 5.3, 6.2_

- [ ] 12. The manor sample pair
  - Write 40 modules of original TypeScript under `public/demo/manor/before` for a small shop back end with the folders `orders`, `payments`, `notifications`, `catalog`, `shared` and `config` under `src`. Build in every fact of requirement 8.1: the three member cycle through `receipt.ts`, `checkout.ts` and `charge.ts`, the one external import, the one absent file, the type only re-export cycle, the one mixed import, the one literal dynamic import, `receipt.ts` importing one binding from `checkout.ts` in one statement used in one deletable statement, and `src/orders/summary.ts` with no import path to `receipt.ts`. Write no other external, unresolved or unsupported import.
  - Copy it to `public/demo/manor/after` and make the three changes of requirement 8.2 and nothing else: remove the import of `checkout.ts` and its use in `receipt.ts`, add an import of `src/orders/summary.ts` to `receipt.ts`, and insert one comment line above the first import of `checkout.ts`.
  - Write `expected.json` for both by reading the files. List every module and every import with its line, column, kinds and resolution, the wings with their module counts, the cyclic components for each preset, the diagnostics, and for `before` the specifier and the two lines of the `receipt.ts` to `checkout.ts` relation. For `after`, list the one removed relation, the one added relation and the changed modules.
  - Write `tests/fixtures/samples.test.ts` for the pair: the analysis equals `expected.json`, `findCycles` gives one component for `before` and none for `after` under `static-value`, and the removed, added and changed sets equal requirement 8.2.
  - Do not create `samples/manor`. `kiro-integration` task 1a copies it from `before`.
  - Verify: `pnpm verify` passes with the pair's tests green.
  - _Requirements: 8.1, 8.2, 8.4_

- [ ] 13. The annex sample and the packer
  - Write the `annex` sample under `public/demo/annex`: about 18 modules of original older style code with exactly three disjoint cyclic components, of sizes 2 and 3 and one self-loop, and exactly two alias imports, `@/lib/format` and `~/config/env`. Write its `expected.json` by hand and add it to `samples.test.ts`.
  - Implement `scripts/pack-samples.ts` that writes `sources.json` beside each sample (`manor/before`, `manor/after`, `annex`), and its `--check` mode. Run it once and keep the three files. Replace the root `pack:samples` script and add `pack:samples --check` to `verify`.
  - Implement `scripts/check-expected.mjs` with the line rule of requirement 8.5 and add it to `verify`.
  - Verify: `pnpm verify` passes, and removing one import line from a copy makes `check-expected` fail.
  - _Requirements: 8.3, 8.4, 8.5_

- [ ] 14. Worker and client
  - Write `tests/workers/client.test.ts` first with a fake worker: the revision guard, cancel by terminate and recreate within 500 ms, cancel of a worker that never answers, the `AnalysisCancelled` rejection, and an error that keeps the last investigation. See it fail.
  - Implement `src/workers/analysis.worker.ts` and `src/workers/client.ts` with the message types and the client interface from the design.
  - Verify: `pnpm verify` passes.
  - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [ ] 15. Boundary test, export file and log
  - Create `src/analysis/index.ts` as the only export file, re-exporting `DEFAULT_ANALYSIS_OPTIONS`, and `tests/analysis-boundary.test.ts` with both checks of the design.
  - Add the log rows for this spec with the credits used.
  - Verify: `pnpm verify` passes.
  - _Requirements: 9.1, 9.3_
