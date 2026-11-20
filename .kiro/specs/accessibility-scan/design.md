# Design: accessibility-scan

## The helper

`tests/e2e/axe.ts` wraps `AxeBuilder` from `@axe-core/playwright` (4.14.0, MPL-2.0, dev dependency, used only by tests). `scanPage(page, name)` runs `new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])` and returns `{ name, violations }`, with each violation reduced to `{ id, impact, help, nodes, targets }`. No `best-practice` tag is passed, so those rules stay off. `withTags` limits the run to rules that carry one of the four tags.

The only exclusion is the WebGL canvas, for the rule `color-contrast` only. axe cannot read pixels drawn by WebGL, so it cannot judge their contrast. `scanPage` therefore makes two passes and merges the violations: pass A runs the four tags with `color-contrast` disabled, on the whole page including the canvas; pass B runs only `color-contrast` and excludes `canvas`. Every other rule still sees the canvas. The reason is in a comment beside the exclusion.

`assertNoSeriousOrCritical` a no-op, and `HAUNTMAP_AXE_REPORT` writes the findings. This switch is used once, for `axe-before.json`, then removed from the helper before the strict run (task 3), so the committed helper has no report-only mode.

## Fixes

Fixes go in `src/` only, by the smallest change: a name, a role, a landmark, a heading level, a contrast token moved by the smallest step that passes 4.5:1 (3:1 for large text), text at least 12 px, the candlelit manor tokens and fonts kept.

## Files

| Path | Change |
| --- | --- |
| `package.json`, `pnpm-lock.yaml` | `@axe-core/playwright` 4.14.0, exact |
| `docs/third-party-notices.md` | one licence row |
| `tests/e2e/axe.ts`, `tests/e2e/accessibility.spec.ts` | new |
| `src/**` | fixes found by the scan |
| `docs/acceptance/accessibility/` | `axe-before.json`, `axe-after.json`, `README.md` |
| `docs/kiro-log.md` | one row for each finished task |

Ownership: the scan touches folders of `investigation-ui` and `intake`. The owner asked for this spec, so it is the one spec in work; the fixes edit existing files for their accessibility only. No fixture, `expected.json` or `public/demo` file is edited.

## Limits

axe finds a part of the accessibility problems that a page can have. It does not read the canvas, does not judge focus order or the meaning of names, and nobody was asked to use the application with a screen reader. The scan is not a claim of conformance.
