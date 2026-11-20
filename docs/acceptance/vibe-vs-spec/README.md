# A loose prompt against a spec, one real feature

Date: 20 November 2026. Kiro CLI 3.5.0, model Auto. The feature: HauntMap treats URL imports such as `https://cdn.example.com/lib.js` as external dependencies. Before, the resolver recorded them as unresolved path aliases and wrote a diagnostic for each.

## The two ways

- Loose prompt (vibe): one sentence, `vibe-prompt.txt`, in a throwaway worktree. Kiro wrote code, tests and the fix in one run.
- Spec: the same sentence, but Kiro first wrote a spec (`.kiro/specs/url-imports/`: requirements, design, seven tasks), then built it task by task in a second worktree.

Both builds started from the same commit (`07b99f9`). The yardstick is one acceptance file, written by Kiro from a description of the feature that neither build saw (`acceptance-url-imports.test.ts.txt`, 22 cases). On the code before the feature it fails 6 cases (the five external URL cases and the end to end case) and passes 16.

## Numbers

Credits and seconds are read from the `session_usage` and `turn_completion` events of each run (`runs.json`). The pool meter cannot be used, because four other Kiro runs shared the account.

| | Loose prompt | Spec: writing it | Spec: building it | Spec in all |
| --- | --- | --- | --- | --- |
| Credits | 0.72 | 3.20 | 4.38 | 7.58 |
| Minutes | 4.0 | 4.1 | 8.8 | 12.9 |
| Tool calls | 7 | 16 | 30 | 46 |
| Tests the build added | 1 | | 5 | 5 |
| Acceptance cases passed | 20 of 22 | | 20 of 22 | 20 of 22 |
| `pnpm verify` of the run | exit 0 | | exit 0 | |

The two cases both builds fail are the capital letter schemes, `HTTPS://CDN.EXAMPLE.COM/X.JS` and `Http://example.com/a/b.mjs?v=1#top`. The spec states this as a rule (requirement 2.3, lower case schemes only). The loose build has the same behaviour with no stated reason. The acceptance file expects them to be external, so both builds miss the same two cases.

## What each way found

| | Loose prompt | Spec |
| --- | --- | --- |
| The old test that the change makes wrong (`http://example.com/x.js` listed as an alias) | Found and replaced in the list | Found, named in requirement 5.1, removed in task 4 |
| The doc comment above `resolveSpecifier` | Updated | Updated |
| `docs/limitations.md` | Not changed | One line added |
| End to end check through `analyze` (no diagnostic, same relation id) | None | One test |
| Other schemes (`file:`, `data:`, `jsr:`, `npm:`, `blob:`) and malformed forms | `ftp:`, `https://` and `http:///` | 17 forms in one test |
| Steering and spec lines that the change makes wrong (`.kiro/steering/analysis.md`, line 38 of `.kiro/specs/analysis-core/requirements.md`) | Not named | Named, left for their owner |

A full test run of the loose build showed one more failing test than the acceptance file explains; it did not come back in the next run, and its name was not saved.

## Reading

Same feature, same acceptance score. The spec cost about 10 times the credits and 3 times the minutes, and it left a requirement list, a design, an end to end test, a limitations line and a list of three documents that now disagree with the code. The loose prompt left less of that. The spec build was kept; the loose build was deleted.
