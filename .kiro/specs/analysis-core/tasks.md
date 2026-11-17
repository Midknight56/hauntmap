# Implementation Plan

- [ ] 1. Scaffold the repository and the contracts
  - Create the pnpm workspace with the folder structure of the plan: TypeScript with `strict` on, Vite, Vitest, fast-check, ESLint. Pin each version, the Babel parser included, and write each licence in `docs/kiro-log.md`.
  - Add the root scripts `typecheck`, `test`, `verify` and `pack:samples`. `pack:samples` prints `not built yet` and exits 0 until task 12.
  - Create `src/contracts/types.ts` with the contracts from the design, unchanged.
  - Add `LICENSE` (MIT), a three line `README.md`, `.gitignore` for `node_modules` and `dist`, and `docs/kiro-log.md` from the log template. Do not ignore `.kiro`.
  - Verify: `pnpm verify` exits 0. Save one TypeScript file and end one turn, and write in the log whether `typecheck-on-save` and `verify-on-stop` fired.
  - _Requirements: 9.1_

- [ ] 2. Unit fixtures with hand written facts
  - Create the twelve fixture folders from the design's table under `tests/fixtures/`. Write each `expected.json` by reading the fixture's source files line by line. Do not run any analyzer to produce it.
  - Write `tests/fixtures/fixtures.test.ts` that loads every fixture and compares the analysis result with `expected.json`. Run it and see it fail because `analyze` does not exist.
  - Verify: `pnpm typecheck` passes and the fixture test fails for that reason only.
  - _Requirements: 8.4_

- [ ] 3. Paths and source selection
  - Write `select.test.ts` and `paths.test.ts` first, with one test for each acceptance criterion of requirement 1. See them fail.
  - Implement `paths.ts` and `select.ts` with `DEFAULT_OPTIONS`.
  - Verify: `pnpm test select paths` passes, and the `case` fixture passes.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

- [ ] 4. Extraction
  - Read the import and export kind fields of the pinned Babel parser version in its own documentation and write their names in the log.
  - Implement `extract.ts` for static imports, side effect imports, `export ... from` and `export * from`, with one based line and column and the two kinds.
  - Verify: the `kinds` and `parse-fail` fixtures pass.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [ ] 5. Resolution
  - Implement `resolve.ts` with the candidate order, the JS to TS fallback, the bare specifier rule and the reasons.
  - Verify: the `resolve-order`, `js-to-ts`, `absent`, `alias` and `external` fixtures pass.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [ ] 6. Identifiers and the investigation
  - Implement `ids.ts` and `analyze.ts`: records, hashes through the passed hash function, sorting, diagnostics.
  - Add the determinism test with shuffled file order.
  - Verify: `pnpm test analyze` passes and the same input gives equal JSON text twice.
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 9.2_

- [ ] 7. Presets and cycles
  - Write `cycles.test.ts` first for the `self-loop`, `two-cycles` and `type-cycle` fixtures. See it fail.
  - Implement `presets.ts` and `cycles.ts` with Tarjan's algorithm and the witness walk from the design.
  - Verify: `pnpm test cycles` passes.
  - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [ ] 8. Trace
  - Write `trace.test.ts` first, with the `two-cycles` case from the design and the unknown origin case. See it fail.
  - Implement `trace.ts`.
  - Verify: `pnpm test trace` passes.
  - _Requirements: 6.1, 6.2, 6.3_

- [ ] 9. Properties
  - Write `tests/analysis.properties.test.ts` with the seven properties from the design, using fast-check generators that write small sets of files with known imports.
  - Fix every failure in the code, never in the property.
  - Verify: `pnpm test properties` passes in under 90 seconds.
  - _Requirements: 2.2, 3.1, 4.4, 5.1, 5.3, 5.4, 6.2_

- [ ] 10. Property tests from the spec
  - In the Kiro IDE, open this spec and use the spec correctness feature to generate property tests from the acceptance criteria.
  - Keep each generated property that checks something new in `tests/analysis.spec-properties.test.ts`. Remove none of the seven.
  - Write in the log which properties were added and any failure they found.
  - Verify: `pnpm test` passes.
  - _Requirements: 4.4, 5.3, 6.2_

- [ ] 11. The manor sample pair
  - Write 40 modules of original TypeScript under `public/demo/manor/before` for a small shop back end with the folders `orders`, `payments`, `notifications`, `catalog`, `shared` and `config`. Build in every fact of requirement 8.1.
  - Copy it to `public/demo/manor/after` and remove the one import of requirement 8.2. Change nothing else.
  - Write `expected.json` for both by reading the files. List every module and every import with its line, column, kinds and resolution, the cyclic components for each preset, and the diagnostics.
  - Copy `before` to `samples/manor` as the working copy for live sessions.
  - Verify: the sample test passes for both, and `findCycles` gives one component for `before` and none for `after` under `static-value`.
  - _Requirements: 8.1, 8.2, 8.4_

- [ ] 12. The annex sample and the packer
  - Write the `annex` sample under `public/demo/annex`: about 18 modules of original older style code with exactly three cyclic components and exactly two alias imports. Write its `expected.json` by hand.
  - Implement `scripts/pack-samples.ts` that writes `sources.json` beside each sample, and its `--check` mode. Replace the root `pack:samples` script and add `pack:samples --check` to `verify`.
  - Implement `scripts/check-expected.mjs` and add it to `verify`.
  - Verify: `pnpm verify` passes, and removing one import line from a copy makes `check-expected` fail.
  - _Requirements: 8.3, 8.4, 8.5_

- [ ] 13. Worker and client
  - Write `tests/workers/client.test.ts` first with a fake worker: the revision guard, cancel by terminate and recreate, and an error that keeps the last investigation. See it fail.
  - Implement `src/workers/analysis.worker.ts` and `src/workers/client.ts` with the message types from the design.
  - Verify: `pnpm test client` passes.
  - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [ ] 14. Literal dynamic imports
  - Extend `extract.ts` for `import("...")` and for the non literal case, after tasks 4 to 9 pass.
  - Verify: the `dynamic` fixture passes and the manor facts still hold.
  - _Requirements: 10.1, 10.2_

- [ ] 15. Boundary test, export file and log
  - Create `src/analysis/index.ts` as the only export file and `tests/analysis-boundary.test.ts`.
  - Add the log rows for this spec with the credits used.
  - Verify: `pnpm verify` passes.
  - _Requirements: 9.1, 9.3_
