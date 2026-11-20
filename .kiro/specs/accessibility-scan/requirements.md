# Requirements: accessibility-scan

An automated axe scan runs on every screen state of the HauntMap journey, and the test fails on any serious or critical violation. `.kiro/steering/accessibility-and-motion.md`, `.kiro/steering/claims-policy.md` and `.kiro/steering/revision-2026-11-16.md` apply. axe checks only a part of the accessibility problems of a page; a passing scan is not a claim that the application is accessible.

## 1. The scan

1.1 THE SYSTEM SHALL provide `tests/e2e/axe.ts`, a helper that runs axe on the current page with the tags `wcag2a`, `wcag2aa`, `wcag21a` and `wcag21aa` and no `best-practice` rules, and returns the violations.
1.2 WHEN a scan finds a violation whose impact is `serious` or `critical`, THE test SHALL fail and name the screen, the rule id, the impact and one target selector for each node.
1.3 WHEN a scan finds a violation whose impact is `minor` or `moderate`, THE test SHALL list it in the report and SHALL NOT assert on it.
1.4 THE scan SHALL NOT disable a rule or exclude an element, except the WebGL canvas, which is excluded for the contrast rule `color-contrast` only. The reason is in a comment beside the exclusion.
1.5 Every scan has a name. THE report SHALL list each name with its violations.
1.6 THE spec SHALL run in the `dev` project, headless, with the launch options of `playwright.config.ts`.

## 2. The landing screen

2.1 THE scan SHALL cover the landing screen as first drawn.
2.2 THE scan SHALL cover the landing screen after a sample request fails and the status region shows its message.

## 3. The map screen

3.1 THE scan SHALL cover the manor map after `Explore the manor`, with the legend open.
3.2 THE scan SHALL cover the map with the legend closed.
3.3 THE scan SHALL cover the map with the `Show steps` panel open.
3.4 THE scan SHALL cover the map with `Motion` set to `Reduce`.
3.5 THE scan SHALL cover the map at 640 x 360 with the controls behind `More` open.
3.6 THE scan SHALL cover the map banner shown when the renderer fails (`Retry map`, `Open Evidence view`).

## 4. The investigation panels

4.1 THE scan SHALL cover the `Dependency loops` panel.
4.2 THE scan SHALL cover the loop selected, with the evidence trail and the inspector.
4.3 THE scan SHALL cover a room selected from the search, with its inspector, its source excerpt and its lists.
4.4 THE scan SHALL cover the `Who imports` panel.
4.5 THE scan SHALL cover the Evidence view.

## 5. The comparison screens

5.1 THE scan SHALL cover `Compare revisions` open and idle.
5.2 THE scan SHALL cover the comparison after the revised manor is loaded.
5.3 THE scan SHALL cover the result of `Open live snapshot`.

## 6. The local folder dialog

6.1 THE scan SHALL cover the dialog as opened, over the landing screen.
6.2 THE scan SHALL cover the dialog after a folder is chosen (the review of the included and skipped files).
6.3 THE scan SHALL cover the dialog after the analysis (the summary and the save control).

## 7. The GitHub dialog

7.1 THE scan SHALL cover the dialog as opened.
7.2 THE scan SHALL cover the dialog when it asks for a branch or tag.
7.3 THE scan SHALL cover the dialog with its error alert, for a listing that is over the cap.

## 8. The report

8.1 WHEN `HAUNTMAP_AXE_REPORT` names a file, THE spec SHALL write there, for each scan, its name and its violations (rule id, impact, number of nodes, one target selector).
8.2 `docs/acceptance/accessibility/README.md` SHALL name the axe-core version read from `node_modules`, the scanned screens with the violations before and after by impact, the fixes, and what axe cannot check.
8.3 THE documents SHALL NOT claim that the application is fully accessible.
