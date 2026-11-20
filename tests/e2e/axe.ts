import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

// The axe scan of requirement 1 of `.kiro/specs/accessibility-scan`. axe finds a part of the accessibility problems of a page;
// a scan with no serious or critical violation is not a claim that the screen is accessible.

/** The rule sets: WCAG 2.0 and 2.1, levels A and AA. The `best-practice` tag is not passed, so those rules do not run. */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

export type Impact = "minor" | "moderate" | "serious" | "critical";

export interface FoundViolation {
  id: string;
  impact: Impact | null;
  help: string;
  /** The number of nodes the rule failed on. */
  nodes: number;
  /** One target selector, the first node's. */
  target: string;
}

export interface ScanResult {
  name: string;
  violations: FoundViolation[];
}

/** Run axe on the current page and return its violations, sorted by rule id. `name` names the screen state in every report. */
export async function scanPage(page: Page, name: string): Promise<ScanResult> {
  // Pass A: every rule of the four tags on the whole page, the canvas included, except the colour contrast rule.
  // Pass B: the colour contrast rule alone, on everything except the WebGL canvas. axe cannot read pixels that WebGL draws, so it cannot
  // judge their contrast; the page text, the controls, the dialogs and the Evidence view are all inside pass B.
  // Splitting the passes this way keeps every other rule looking at the canvas element.
  const everything = await new AxeBuilder({ page }).withTags(TAGS).disableRules(["color-contrast"]).analyze();
  const contrast = await new AxeBuilder({ page }).withRules(["color-contrast"]).exclude("canvas").analyze();
  const violations = [...everything.violations, ...contrast.violations].map<FoundViolation>((v) => ({
    id: v.id,
    impact: (v.impact ?? null) as Impact | null,
    help: v.help,
    nodes: v.nodes.length,
    target: v.nodes[0]?.target.map(String).join(" ") ?? "",
  }));
  violations.sort((a, b) => a.id.localeCompare(b.id));
  return { name, violations };
}

/** Violations that fail the test: serious or critical. Minor and moderate ones are listed in the report only. */
export function blocking(result: ScanResult): FoundViolation[] {
  return result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
}

/** One line for each blocking violation: screen, rule id, impact, node count and one target. */
export function describeBlocking(result: ScanResult): string[] {
  return blocking(result).map((v) => `${result.name}: ${v.id} (${v.impact}, ${v.nodes} nodes) ${v.target}: ${v.help}`);
}

/** Write every scan to `file` as JSON: the screens in the order they were scanned. */
export function writeReport(file: string, scans: ScanResult[]): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ screens: scans.map((s) => ({ name: s.name, violations: s.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes, target: v.target })) })) }, null, 2)}\n`, "utf8");
}
