import { expect, type Page } from "@playwright/test";
import { assertFocusVisibleAndUnobscured, expected, focusedName, inspectorHeading } from "./helpers";

// The cycle investigation of requirement 11.1 with keyboard input only (no export step: no export
// feature is built). `keyboard-journey.spec.ts` runs it and `reduced-motion.spec.ts` runs it again
// with reduced motion. Both run against the release build, so nothing here uses the development hook.

const MIDDLE_DOT = "\u00B7";

/**
 * Press Tab (or Shift+Tab) until the focused element's name matches. After every press that lands on
 * an element, its focus ring must be visible and its center unobscured (11.3).
 */
export async function tabUntil(page: Page, match: string | RegExp, direction: "Tab" | "Shift+Tab" = "Tab"): Promise<string> {
  for (let presses = 0; presses < 250; presses++) {
    await page.keyboard.press(direction);
    const onBody = await page.evaluate(() => document.activeElement === null || document.activeElement === document.body);
    if (onBody) continue;
    await assertFocusVisibleAndUnobscured(page);
    const name = await focusedName(page);
    if (typeof match === "string" ? name === match : match.test(name)) return name;
  }
  throw new Error(`tabUntil: no element named ${String(match)} received focus in 250 ${direction} presses`);
}

export interface JourneyFacts {
  receipt: string;
  checkout: string;
  charge: string;
}

export function journeyFacts(): JourneyFacts {
  const witness = expected().cycles["static-value"]?.[0]?.witness.modules ?? [];
  const [receipt, checkout, charge] = witness;
  if (receipt === undefined || checkout === undefined || charge === undefined) throw new Error("expected.json has no 3-module loop");
  return { receipt, checkout, charge };
}

/** The accessible text of the `Imports` button of `from` whose target is `to`, from expected.json. */
function importsButtonName(from: string, to: string): string {
  const record = expected().imports.find((r) => r.from === from && r.to === to);
  if (record === undefined) throw new Error(`expected.json has no import ${from} -> ${to}`);
  return `${to} ${MIDDLE_DOT} ${record.syntaxKind} ${MIDDLE_DOT} ${record.dependencyKind}`;
}

async function expectHeading(page: Page, text: string): Promise<void> {
  await expect(inspectorHeading(page)).toHaveText(text);
}

/** Steps of 11.1. `onMap` runs when the loop is revealed, for a screenshot. */
export async function runKeyboardJourney(page: Page, onLoop?: () => Promise<void>): Promise<void> {
  const f = journeyFacts();
  await page.goto("/");

  // 1. Tab to Explore the manor and press Enter.
  await tabUntil(page, "Explore the manor");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => performance.getEntriesByName("hauntmap:usable").length > 0);
  await expectHeading(page, "Inspector");

  // 2. Search for `receipt`, ArrowDown to the module, Enter.
  await tabUntil(page, "Search modules");
  await page.keyboard.type("receipt");
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press("ArrowDown");
    const active = await page.evaluate(() => {
      const input = document.activeElement;
      const id = input?.getAttribute("aria-activedescendant");
      return id === null || id === undefined ? "" : (document.getElementById(id)?.textContent ?? "");
    });
    if (active === f.receipt) break;
  }
  await page.keyboard.press("Enter");
  await expectHeading(page, f.receipt);

  // 3. In the inspector, activate the Imports button whose target is checkout.ts (the import door).
  await tabUntil(page, importsButtonName(f.receipt, f.checkout));
  await page.keyboard.press("Enter");
  await expectHeading(page, `${f.receipt} imports ${f.checkout}`);

  // 4. Dependency loops, Enter, then Enter on the 3-module component.
  await tabUntil(page, "Dependency loops", "Shift+Tab");
  await page.keyboard.press("Enter");
  await tabUntil(page, `3 modules: ${f.receipt}, ${f.checkout}, ${f.charge}`);
  await page.keyboard.press("Enter");
  await expectHeading(page, `${f.receipt} imports ${f.checkout}`);
  if (onLoop !== undefined) await onLoop();

  // 5. In the evidence trail, ArrowDown to Step 2 and Enter.
  await tabUntil(page, /^Step 1: /);
  await page.keyboard.press("ArrowDown");
  expect(await focusedName(page)).toMatch(/^Step 2: /);
  await page.keyboard.press("Enter");
  await expectHeading(page, `${f.checkout} imports ${f.charge}`);

  // 6. Activate the first occurrence and read a source line.
  await tabUntil(page, /^line \d+, column \d+: /, "Shift+Tab");
  await page.keyboard.press("Enter");
  await expectHeading(page, `${f.checkout} imports ${f.charge}`);
  const line = page.locator('[aria-label="Source lines"] li[aria-current="true"]');
  await expect(line).toHaveCount(1);
  await expect(line).toContainText(/import .+ from ".+"/);
}
