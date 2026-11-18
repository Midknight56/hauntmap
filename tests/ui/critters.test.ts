import { describe, expect, it } from "vitest";
import { drawCritter } from "../../src/scene/critters";
import { CRITTER_PX } from "../../src/scene/haunt";

// The silhouettes of the bats and cats are drawn in screen pixels: a dark body with a light rim of 1.5 to 2 px, all inside the frame
// of the cached texture, so that the rim is not cut off.

describe("the silhouette of a critter", () => {
  for (const kind of ["bat", "cat"] as const) {
    it(`${kind}: a rim of 1.5 to 2 px around the dark body, inside the frame of its texture`, () => {
      const drawn = drawCritter(kind);
      expect(drawn.w).toBe(CRITTER_PX[kind].w);
      expect(drawn.h).toBe(CRITTER_PX[kind].h);
      const [rim, body] = drawn.node.children;
      const outer = (rim as NonNullable<typeof rim>).getBounds();
      const inner = (body as NonNullable<typeof body>).getBounds();
      const widthOfRim = Math.min(inner.x - outer.x, outer.x + outer.width - (inner.x + inner.width));
      expect(widthOfRim, "the rim on the left and right").toBeGreaterThanOrEqual(1.5 - 0.05);
      expect(widthOfRim).toBeLessThanOrEqual(2 + 0.05);
      expect(outer.x).toBeGreaterThanOrEqual(0);
      expect(outer.y).toBeGreaterThanOrEqual(0);
      expect(outer.x + outer.width).toBeLessThanOrEqual(drawn.w + 1e-6);
      expect(outer.y + outer.height).toBeLessThanOrEqual(drawn.h + 1e-6);
      expect(inner.width, "the body fills most of the frame").toBeGreaterThanOrEqual(drawn.w - 8);
    });
  }
});