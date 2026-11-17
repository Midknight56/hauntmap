import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COMPANIONS } from "../../src/scene/compare";
import { STATE_STYLES, TOKENS } from "../../src/scene/styles";
import { REPO } from "./loadFolder";

/** WCAG 2.x relative luminance and contrast ratio, written here so that the test does not reuse the source. */
function luminance(hex: string): number {
  const channel = (offset: number): number => {
    const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const STATES = ["comparison-changed", "comparison-removed", "comparison-added"] as const;
// The Candlelit manor palette of src/styles/theme.ts (the design pass of 2026-11-17 took these three from the owner's design: candle, bone and moss; ratios are in the log row).
const TOKEN_HEX = { changed: "#f2b24c", removed: "#ede3d0", added: "#a6e06a" } as const;

describe("comparison states (5.4)", () => {
  it.each(STATES)("%s differs from default by more than color", (state) => {
    const base = STATE_STYLES.default;
    const s = STATE_STYLES[state];
    const differs = s.outlineWidth !== base.outlineWidth || s.glyph !== base.glyph || s.label !== base.label || (s.outlineStyle ?? "solid") !== (base.outlineStyle ?? "solid");
    expect(differs).toBe(true);
  });

  it("has the companions of 5.1: lamp, dashed ghost outline, + glyph, and the state labels", () => {
    expect(COMPANIONS).toEqual({ "comparison-changed": "lamp", "comparison-removed": "dashed outline", "comparison-added": "+" });
    expect(STATE_STYLES["comparison-changed"].label).toBe("changed");
    expect(STATE_STYLES["comparison-removed"]).toMatchObject({ outlineWidth: 2, outlineStyle: "dashed", glyph: null, label: "removed" });
    expect(STATE_STYLES["comparison-added"]).toMatchObject({ outlineWidth: 2, glyph: "+", label: "added" });
    expect(STATE_STYLES.default.outlineStyle ?? "solid").toBe("solid");
  });

  it("TOKENS has the three comparison tokens", () => {
    expect({ changed: TOKENS.changed, removed: TOKENS.removed, added: TOKENS.added }).toEqual(TOKEN_HEX);
  });

  for (const [name, hex] of Object.entries(TOKEN_HEX)) {
    for (const bg of ["floor", "room"] as const) {
      it(`--${name} on ${bg} is at least 3:1`, () => {
        const ratio = contrast(hex, TOKENS[bg]);
        console.log(`contrast --${name} on ${bg}: ${ratio.toFixed(2)}:1 (at least 3:1)`);
        expect(ratio).toBeGreaterThanOrEqual(3);
      });
    }
  }

  it("tokens.css carries the same three hex values", () => {
    const css = readFileSync(join(REPO, "src", "styles", "tokens.css"), "utf8");
    for (const [name, hex] of Object.entries(TOKEN_HEX)) {
      expect(new RegExp(`--${name}:\\s*${hex};`, "i").test(css), `--${name}`).toBe(true);
    }
  });
});
