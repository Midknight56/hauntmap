# The same spec on three models

Date: 20 November 2026. Kiro CLI 3.5.0. The task: build the `url-imports` spec (`.kiro/specs/url-imports/`, seven tasks) in a clean worktree from commit `07b99f9`, with the same prompt each time. Models: Auto, `claude-opus-5.5` and `claude-haiku-5.5`, named in the call (`--model`). The costs against Auto are the `rate_multiplier` of `kiro-cli chat --list-models` on the same day.

The spec file came with the boxes already ticked from the Auto run; the Haiku run said so in its report and reset them before it started.

| | Auto | Claude Opus 5.5 | Claude Haiku 5.5 |
| --- | --- | --- | --- |
| Rate against Auto | 1.0 | 2.0 | 0.06 |
| Credits for the run | 4.38 | 11.61 | 0.50 |
| Minutes | 8.8 | 17.3 | 11.3 |
| Tool calls | 30 | 47 | 41 |
| Tests added | 5 | 5 | 6 |
| `pnpm verify` of the run | exit 0 | exit 0 | exit 0 |
| Acceptance cases passed (22) | 20 | 20 | 20 |
| Code change in `resolve.ts` | one regular expression, one line | the same | the same |

The three builds wrote the same regular expression and the same one line in `resolveSpecifier`. They differ in the words of the doc comment and of the `limitations.md` line, and in the number of extra tests. Each left the two steering and spec lines for their owner, as requirement 5.3 says.

Reading: for a task this size the result did not change with the model. Haiku cost 0.50 credits against 4.38 for Auto and 11.61 for Opus. Opus was the slowest. The kept build is the Auto build, because it came from the same chain as the spec itself.

Sources: `runs.json`; the acceptance file is `../vibe-vs-spec/acceptance-url-imports.test.ts.txt`.
