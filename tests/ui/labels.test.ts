import { describe, expect, it } from "vitest";
import { MIN_LABEL_PX, TARGET_LABEL_PX, fitLines, labelScale, stemOfId, wingTitleFor } from "../../src/scene/labels";

// A stand-in for text measurement: every character is 6 units wide.
const measure = (s: string): number => s.length * 6;

describe("label scale (item 5)", () => {
  it("keeps the drawn label at least 11 px tall at every zoom the map allows", () => {
    for (const zoom of [0.25, 0.4, 0.61, 0.8, 1, 1.5, 4]) {
      const px = 11 * labelScale(zoom, 11) * zoom;
      expect(px, `zoom ${zoom}`).toBeGreaterThanOrEqual(MIN_LABEL_PX);
    }
  });

  it("leaves the label at its own size once the map is zoomed in far enough", () => {
    expect(labelScale(2, 11)).toBe(1);
    expect(labelScale(0.5, 11)).toBeCloseTo(TARGET_LABEL_PX / (11 * 0.5), 9);
  });
});

describe("room label words", () => {
  it("takes the file stem from a module ID", () => {
    expect(stemOfId("src/orders/checkout.ts")).toBe("checkout");
    expect(stemOfId("src/a/b.test.tsx")).toBe("b.test");
    expect(stemOfId("Makefile")).toBe("Makefile");
    expect(stemOfId("src/.env.ts")).toBe(".env");
  });

  it("uses the full name when it fits on one line", () => {
    expect(fitLines(["receipt.ts", "receipt"], 100, measure, 2)).toEqual(["receipt.ts"]);
  });

  it("falls to the stem, then to two lines split at a word boundary", () => {
    expect(fitLines(["receipt.ts", "receipt"], 50, measure, 2)).toEqual(["receipt"]);
    expect(fitLines(["catalogService.ts", "catalogService"], 50, measure, 2)).toEqual(["catalog", "Service"]);
    expect(fitLines(["order-repo.ts", "order-repo"], 40, measure, 2)).toEqual(["order-", "repo"]);
  });

  it("never cuts a word without a break into two lines: it ends the stem with an ellipsis instead", () => {
    expect(fitLines(["checkout.ts", "checkout"], 36, measure, 2)).toEqual(["check\u2026"]);
    expect(fitLines(["Not in this traversal"], 70, measure, 2)).toEqual(["Not in this", "traversal"]);
  });

  it("truncates with an ellipsis, never to nothing, when no break makes it fit", () => {
    const out = fitLines(["preferences.ts", "preferences"], 48, measure, 1);
    expect(out).toHaveLength(1);
    expect(out[0]?.endsWith("\u2026")).toBe(true);
    expect(measure(out[0] as string)).toBeLessThanOrEqual(48);
    expect(fitLines(["x"], 1, measure, 1)).toEqual(["\u2026"]);
  });

  it("never returns more lines than allowed", () => {
    expect(fitLines(["aVeryLongModuleNameThatCannotFit.ts", "aVeryLongModuleNameThatCannotFit"], 60, measure, 2).length).toBeLessThanOrEqual(2);
  });
});

describe("wing titles", () => {
  it("reads `wing, count` when the plate is wide, the wing alone when narrower, its last folder when narrower still", () => {
    expect(wingTitleFor("src/catalog", 8, 400, measure)).toBe("src/catalog \u00B7 8 modules");
    expect(wingTitleFor("src/catalog", 8, 90, measure)).toBe("src/catalog");
    expect(wingTitleFor("src/catalog", 8, 50, measure)).toBe("catalog");
    expect(wingTitleFor("src/catalog", 1, 400, measure)).toBe("src/catalog \u00B7 1 module");
  });

  it("clips the last folder with an ellipsis when even that does not fit", () => {
    const title = wingTitleFor("src/notifications", 5, 40, measure);
    expect(title.endsWith("\u2026")).toBe(true);
    expect(measure(title)).toBeLessThanOrEqual(40);
  });
});
