import { expect, test } from "@playwright/test";
import { openManor, sceneDebug, settled } from "./helpers";

// Design pass 3, item 12b (a): after Fit to view, the name plate of a loop room covers no other drawn name. The plates of receipt.ts,
// checkout.ts and charge.ts used to lie over templates and mailer, order, and gateway and ledger.

const PLATED = ["src/notifications/receipt.ts", "src/orders/checkout.ts", "src/payments/charge.ts"];

for (const size of [
  { width: 1920, height: 1080 },
  { width: 1280, height: 720 },
]) {
  test.describe(`after Fit to view at ${size.width} x ${size.height}`, () => {
    test.use({ viewport: size });

    test("no plate covers another drawn label or room name", async ({ page }) => {
      await openManor(page);
      await settled(page);
      await page.getByRole("button", { name: "Fit to view" }).click();
      await expect.poll(async () => (await sceneDebug(page)).activeTweens).toBe(0);
      await page.waitForTimeout(300);
      const labels = (await sceneDebug(page)).labels;
      const box = (r: { x: number; y: number; width: number; height: number }) => ({ l: r.x, t: r.y, r: r.x + r.width, b: r.y + r.height });
      const overlap = (a: ReturnType<typeof box>, b: ReturnType<typeof box>): boolean => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
      let checked = 0;
      for (const id of PLATED) {
        const mine = labels.find((l) => l.kind === "room" && l.id === id);
        if (mine === undefined) continue;
        expect(mine.plate, `${id} reports its plate`).toBeDefined();
        const plate = box(mine.plate as { x: number; y: number; width: number; height: number });
        checked++;
        for (const other of labels) {
          if (other === mine || other.rect === undefined) continue;
          if (other.kind === "step" || other.kind === "glyph" || other.kind === "count") continue;
          const theirs = other.plate ?? other.rect;
          expect(overlap(plate, box(theirs)), `the plate of ${id} covers ${other.kind} ${other.id} "${other.text}"`).toBe(false);
        }
      }
      expect(checked, "at least one loop room is drawn with a plate").toBeGreaterThan(0);
    });
  });
}
