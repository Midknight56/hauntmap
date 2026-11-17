import { expect, test, type Page } from "@playwright/test";
import { runKeyboardJourney } from "./journey";

// Requirement 11.5 on the release build (the `prod` project): the journey of 11.1 with reduced motion
// emulated, and again with the `Motion` toggle set to Reduce. The release build has no development
// hook, so `activeTweens` and `particleCount` are sampled in reduced-motion-scene.spec.ts (dev project).

const PREFS_KEY = "hauntmap.prefs.v1";

/** The computed transition and animation of every button and of the page root. */
async function motionStyles(page: Page): Promise<{ transition: string[]; animation: string[]; dataMotion: string }> {
  return page.evaluate(() => {
    const els = [document.documentElement, ...document.querySelectorAll("button, select, input, .map-wrapper, .inspector")];
    return {
      transition: [...new Set(els.map((el) => getComputedStyle(el).transitionDuration))],
      animation: [...new Set(els.map((el) => getComputedStyle(el).animationName))],
      dataMotion: document.documentElement.dataset["motion"] ?? "",
    };
  });
}

test.describe("reduced motion (release build)", () => {
  test("11.5 the journey with prefers-reduced-motion emulated; transitions and animations are off", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await runKeyboardJourney(page);
    const styles = await motionStyles(page);
    expect(styles.dataMotion).toBe("reduce");
    expect(styles.transition).toEqual(["0s"]);
    expect(styles.animation).toEqual(["none"]);
  });

  test("11.5 the journey with the Motion toggle set to Reduce and no system preference; the choice is stored", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.addInitScript(
      ([key]) => {
        // The toggle's own record, as the toolbar writes it; the journey starts on the landing screen.
        if (localStorage.getItem(key as string) === null) localStorage.setItem(key as string, JSON.stringify({ version: 1, motion: "reduce", legendOpen: true, preset: "static-value" }));
      },
      [PREFS_KEY],
    );
    await runKeyboardJourney(page);
    await expect(page.getByRole("button", { name: "Motion" })).toHaveAttribute("aria-pressed", "true");
    const styles = await motionStyles(page);
    expect(styles.dataMotion).toBe("reduce");
    expect(styles.transition).toEqual(["0s"]);
    expect(styles.animation).toEqual(["none"]);
    const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}") as { motion?: string }, PREFS_KEY);
    expect(stored.motion).toBe("reduce");
  });

  test("11.5 pressing the Motion toggle stores reduce and switches the page to instant styles", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/");
    await page.getByRole("button", { name: "Explore the manor" }).click();
    await page.getByRole("application", { name: "Haunted map" }).waitFor();
    expect((await motionStyles(page)).dataMotion).toBe("allow");
    await page.getByRole("button", { name: "Motion" }).click();
    expect((await motionStyles(page)).dataMotion).toBe("reduce");
    expect((await motionStyles(page)).transition).toEqual(["0s"]);
    const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}") as { motion?: string }, PREFS_KEY);
    expect(stored.motion).toBe("reduce");
  });
});