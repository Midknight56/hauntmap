import { expect, test } from "@playwright/test";
import { openManor } from "./helpers";

// The panels slide in from 14 px lower (panel-slide in src/styles/app.css). On the desktop layout that must never make the page
// taller than the screen, not even on the first frame of the slide. The phone layout keeps its page scroll and is not tested here.

const SIZES = [
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
] as const;

for (const size of SIZES) {
  test.describe(`panel slide at ${size.width} x ${size.height}`, () => {
    test.use({ viewport: size });

    test("with every animation paused at its first frame, the page is still one screen", async ({ page }) => {
      await openManor(page);
      const paused = await page.evaluate(() => {
        // The slides may be over by now: start every CSS animation again, so that the first frame is there to be paused.
        for (const element of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
          if (getComputedStyle(element).animationName === "none") continue;
          element.style.animation = "none";
          void element.offsetHeight;
          element.style.animation = "";
        }
        const running = document.getAnimations();
        for (const animation of running) {
          animation.pause();
          animation.currentTime = 0;
        }
        return running.length;
      });
      expect(paused).toBeGreaterThan(0);
      const m = await page.evaluate(() => ({
        innerHeight: window.innerHeight,
        scrollHeight: document.documentElement.scrollHeight,
      }));
      expect(m.scrollHeight).toBe(m.innerHeight);
    });
  });
}
