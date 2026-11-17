import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { STATE_STYLES, TOKENS } from "../../src/scene/styles";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "..", "src");

/** WCAG 2.x relative luminance and contrast ratio, implemented here so that the test is independent of the source. */
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

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...cssFiles(path));
    else if (name.endsWith(".css")) out.push(path);
  }
  return out;
}

const kebab = (name: string): string => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

describe("state styles (2.6, 2.8)", () => {
  it("has exactly the states of the visual-language table", () => {
    expect(Object.keys(STATE_STYLES).sort()).toEqual(
      ["comparison-added", "comparison-changed", "comparison-removed", "default", "focusHalo", "selected", "subdued", "trace", "witness"].sort(),
    );
  });

  it("gives every non-default state an outline, glyph or label that default lacks", () => {
    const base = STATE_STYLES.default;
    expect(base.glyph).toBeNull();
    expect(base.label).toBeNull();
    for (const [name, style] of Object.entries(STATE_STYLES)) {
      if (name === "default") continue;
      const differs = style.outlineWidth !== base.outlineWidth || style.glyph !== base.glyph || style.label !== base.label;
      expect(differs, `${name} differs from default only in color`).toBe(true);
    }
  });

  it("states the named companions: selected 3-unit outline, subdued text, sealed ?, added +", () => {
    expect(STATE_STYLES.selected.outlineWidth).toBe(3);
    expect(STATE_STYLES.subdued.label).toBe("Not in this traversal");
    expect(STATE_STYLES["comparison-added"].glyph).toBe("+");
    expect(STATE_STYLES.witness.label).not.toBeNull();
    expect(STATE_STYLES.trace.label).not.toBeNull();
  });
});

describe("tokens (11.7)", () => {
  const pairs: [string, string, string, number][] = [
    ["ink on panel", TOKENS.ink, TOKENS.panel, 4.5],
    ["inkMuted on panel", TOKENS.inkMuted, TOKENS.panel, 4.5],
    ["roomInk on room", TOKENS.roomInk, TOKENS.room, 4.5],
    ["roomSubduedInk on roomSubdued", TOKENS.roomSubduedInk, TOKENS.roomSubdued, 4.5],
    ["door on floor", TOKENS.door, TOKENS.floor, 3],
    ["corridor on floor", TOKENS.corridor, TOKENS.floor, 3],
    ["focus on panel", TOKENS.focus, TOKENS.panel, 3],
  ];

  it.each(pairs)("%s is at least its threshold", (name, fg, bg, min) => {
    const ratio = contrast(fg, bg);
    console.log(`contrast ${name}: ${ratio.toFixed(2)}:1 (at least ${min}:1)`);
    expect(ratio).toBeGreaterThanOrEqual(min);
  });

  it("tokens.css carries the same hex values as TOKENS", () => {
    const css = readFileSync(join(SRC, "styles", "tokens.css"), "utf8");
    for (const [name, value] of Object.entries(TOKENS)) {
      const match = new RegExp(`--${kebab(name)}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(css);
      expect(match?.[1]?.toLowerCase(), `--${kebab(name)} in tokens.css`).toBe(value.toLowerCase());
    }
  });

  it("tokens.css declares the focus ring", () => {
    const css = readFileSync(join(SRC, "styles", "tokens.css"), "utf8");
    expect(css).toMatch(/:focus-visible\s*\{\s*outline:\s*3px solid var\(--focus\);\s*outline-offset:\s*2px;?\s*\}/);
  });
});

describe("focus ring is never removed (11.3)", () => {
  it("has no outline: none, outline: 0 or outline-style: none in src/**/*.css", () => {
    const files = cssFiles(SRC);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const css = readFileSync(file, "utf8");
      expect(css, file).not.toMatch(/outline\s*:\s*(none|0)\b/i);
      expect(css, file).not.toMatch(/outline-style\s*:\s*none/i);
    }
  });
});
describe("reduced-motion block (11.5)", () => {
  it("app.css sets transition: none and animation: none under prefers-reduced-motion and under the Motion toggle", () => {
    const css = readFileSync(join(SRC, "styles", "app.css"), "utf8");
    const media = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?\n)\}/.exec(css);
    expect(media, "a prefers-reduced-motion block").not.toBeNull();
    expect(media?.[1]).toMatch(/transition:\s*none/);
    expect(media?.[1]).toMatch(/animation:\s*none/);
    const toggle = /\[data-motion="reduce"\][^{]*\{([^}]*)\}/.exec(css);
    expect(toggle, "a rule for [data-motion=reduce]").not.toBeNull();
    expect(toggle?.[1]).toMatch(/transition:\s*none/);
    expect(toggle?.[1]).toMatch(/animation:\s*none/);
  });
});