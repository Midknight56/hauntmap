# Accessibility scan with axe

Run on 2026-11-20 with `@axe-core/playwright` 4.14.0 and axe-core 4.14.1 (the version read from `node_modules/.pnpm/axe-core@4.14.1/node_modules/axe-core/package.json`). The spec is `tests/e2e/accessibility.spec.ts` and the helper is `tests/e2e/axe.ts` (the `dev` Playwright project, headless Chromium at 1,280 x 720). The plan is `.kiro/specs/accessibility-scan/`.

## What is scanned

Each screen state below is scanned with the rule tags `wcag2a`, `wcag2aa`, `wcag21a` and `wcag21aa`. The `best-practice` rules are off. The test fails on any violation whose impact is serious or critical. Minor and moderate violations are listed in the report and not asserted; none were found.

The WebGL canvas is excluded from the `color-contrast` rule only, because axe cannot read pixels that WebGL draws. Every other rule sees the canvas. A probe page with low contrast text next to a canvas confirmed that the contrast pass reports the text.

Counts are violations by impact, one count for each rule that failed (each failed on one element). The raw findings, with rule id, impact, number of nodes and one target selector, are in `axe-before.json` (the first run, before any fix, with the assertion switched to report only) and `axe-after.json` (the final run, with the strict assertion).

| Screen | Violations before | Violations after |
| --- | --- | --- |
| landing screen | none | none |
| landing screen after a failed sample request | none | none |
| manor map with legend and steps open | 2 serious | none |
| search results open | 2 serious | none |
| room selected from the search, with its inspector | 2 serious | none |
| who imports panel | 2 serious | none |
| dependency loops panel | 2 serious | none |
| loop selected, with the evidence trail and the inspector | 2 serious | none |
| relation selected, with its occurrence and source lines | 2 serious | none |
| evidence view | 2 serious | none |
| map with the legend closed | 1 serious | none |
| steps panel closed | 1 serious | none |
| show steps panel | 1 serious | none |
| motion set to reduce | 1 serious | none |
| compare revisions open | 1 serious | none |
| comparison after loading the revised manor | 1 serious | none |
| manor map at 640 x 360 with More open | 1 serious | none |
| renderer failure banner over the Evidence view | 1 serious | none |
| result of Open live snapshot | 1 serious | none |
| Open live snapshot with no snapshot written | 1 serious | none |
| local folder dialog as opened | none | none |
| local folder dialog after a folder is chosen | none | none |
| local folder dialog after the analysis | 1 serious | none |
| local folder dialog with a saved investigation listed | none | none |
| local folder dialog with a graph file refused | none | none |
| map of an analyzed local folder | 1 serious | none |
| local folder dialog while the files are read | none | none |
| GitHub dialog as opened | none | none |
| GitHub dialog asking for a branch or tag | none | none |
| GitHub dialog with the cap error alert | none | none |
| GitHub dialog while the files are fetched | none | none |
| map of a loaded GitHub repository | 1 serious | none |

Total before: 29 violations over 32 screens. Total after: 0.

## What was fixed

| File | Change |
| --- | --- |
| `src/components/Toolbar.tsx` | The `Motion` button's visible text is now exactly its accessible name, `Motion`; its state is carried by `aria-pressed` and a `data-state` attribute (rule `label-content-name-mismatch`). |
| `src/styles/app.css` | A `::after` rule draws `: System` or `: Reduce` beside `Motion`, so the visible look is unchanged. |
| `src/components/Legend.tsx` | On the desktop layout the legend section scrolls when its entries do not fit, so it now takes keyboard focus with `tabIndex={0}` (rule `scrollable-region-focusable`). The phone layout already focused its inner group. This adds one Tab stop on the desktop map screen. |

No colour token, font or text size changed. No rule was disabled and no element was excluded other than the canvas for the contrast rule.

## Limits

axe finds only a part of the accessibility problems of a page, it cannot judge the canvas, the order of focus, the meaning of a name or the experience of using a screen reader, and no person was asked to use these screens, so this scan does not show that the application is accessible.

The screens that the specs of `tests/e2e`, `tests/compare/e2e` and `tests/intake/e2e` reach with other data (the annex, other widths, the intake cancel and timing cases, other relation or comparison selections) were not scanned. The device-saved list, the busy states of both dialogs and the cap error were scanned.