import { describe, expect, it } from "vitest";
import { DOOR_BASE_UNITS, DOOR_MAX_GROW, DOOR_TARGET_PX, doorGrow, doorPxAt, openingShare, panelScaleAt } from "../../src/scene/doorLook";

// Door pass: every door is drawn 16 to 20 px wide at the first view (not 3 times its old size), and its panel swings open on its hinge
// far enough that at least half the door width shows the dark opening. The numbers are pure, so they are tested without a scene.

describe("the size of a door on the screen", () => {
  it("aims at 18 px, the middle of the 16 to 20 px band", () => {
    expect(DOOR_TARGET_PX).toBe(18);
  });

  it("is 16 to 20 px at every zoom from the first view of a large map up to the natural size", () => {
    for (let zoom = 0.55; zoom <= 1.2; zoom += 0.01) {
      const px = doorPxAt(zoom);
      expect(px, `zoom ${zoom.toFixed(2)}`).toBeGreaterThanOrEqual(16);
      expect(px, `zoom ${zoom.toFixed(2)}`).toBeLessThanOrEqual(20);
    }
  });

  it("never shrinks a door below its 16 unit size and never grows it past the maximum", () => {
    expect(doorGrow(5)).toBe(1);
    expect(doorGrow(0.0001)).toBe(DOOR_MAX_GROW);
    expect(DOOR_MAX_GROW).toBeLessThanOrEqual(2.4);
  });

  it("grows a door in steps of a tenth, so that a camera move redraws it rarely", () => {
    for (const zoom of [0.4, 0.55, 0.62, 0.8, 1]) expect(Math.abs(doorGrow(zoom) * 10 - Math.round(doorGrow(zoom) * 10))).toBeLessThan(1e-9);
  });

  it("is about 1.5 to 2 times the old 16 unit door at the first view", () => {
    const zoom = 0.6;
    expect(doorGrow(zoom)).toBeGreaterThanOrEqual(1.5);
    expect(doorGrow(zoom)).toBeLessThanOrEqual(2.1);
    expect(DOOR_BASE_UNITS).toBe(16);
  });
});

describe("the swing of the panel", () => {
  it("is shut at 0 and a thin edge at the hinge at 1", () => {
    expect(panelScaleAt(0)).toBe(1);
    expect(panelScaleAt(1)).toBeLessThan(0.2);
    expect(panelScaleAt(1)).toBeGreaterThan(0);
  });

  it("narrows steadily and clamps outside 0 to 1", () => {
    let last = 1;
    for (let f = 0; f <= 1.0001; f += 0.05) {
      const s = panelScaleAt(f);
      expect(s).toBeLessThanOrEqual(last + 1e-9);
      last = s;
    }
    expect(panelScaleAt(-3)).toBe(1);
    expect(panelScaleAt(4)).toBe(panelScaleAt(1));
  });

  it("shows at least half the door width of opening when fully open, and nothing when shut", () => {
    expect(openingShare(0)).toBe(0);
    expect(openingShare(1)).toBeGreaterThanOrEqual(0.5);
    expect(openingShare(1)).toBeLessThan(1);
  });
});
