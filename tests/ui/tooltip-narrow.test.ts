import { describe, expect, it } from "vitest";
import { TOOLTIP_MIN_WIDTH, tooltipSuppressed } from "../../src/components/Tooltip";

// Design pass 2, item 8: on a narrow screen or a touch device a selection shows no tooltip over the map; the evidence sheet carries the text.

describe("tooltipSuppressed", () => {
  it("is on under 768 px and off from 768 px up on a pointer that hovers", () => {
    expect(TOOLTIP_MIN_WIDTH).toBe(768);
    expect(tooltipSuppressed(360, false)).toBe(true);
    expect(tooltipSuppressed(767, false)).toBe(true);
    expect(tooltipSuppressed(768, false)).toBe(false);
    expect(tooltipSuppressed(1920, false)).toBe(false);
  });

  it("is on for a touch device at any width", () => {
    expect(tooltipSuppressed(1920, true)).toBe(true);
    expect(tooltipSuppressed(1024, true)).toBe(true);
  });
});
