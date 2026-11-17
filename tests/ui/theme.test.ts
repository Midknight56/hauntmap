import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TOKENS } from "../../src/scene/styles";
import { DEFAULT_THEME, THEME_NAMES, THEMES, kebab, onThemeChange, setTheme, themeCss, type ThemeName } from "../../src/styles/theme";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "..", "src");

/** WCAG 2.x contrast, written here so that the test does not use the code it checks. */
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
function hsl(hex: string): { h: number; s: number; l: number } {
  const [r, g, b] = [1, 3, 5].map((o) => parseInt(hex.slice(o, o + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

// This file runs in the node project: a one-field stand-in for the document records `data-theme`.
const fakeDocument = { documentElement: { dataset: {} as Record<string, string> } };
beforeEach(() => {
  (globalThis as { document?: unknown }).document = fakeDocument;
});
afterEach(() => {
  setTheme(DEFAULT_THEME);
  delete (globalThis as { document?: unknown }).document;
});

describe("three palettes (item 1)", () => {
  it("names the palettes and makes Candlelit manor the default", () => {
    expect(THEME_NAMES).toEqual(["candlelit-manor", "moonlit-crypt", "graveyard-fog"]);
    expect(DEFAULT_THEME).toBe("candlelit-manor");
    expect(THEMES["candlelit-manor"].title).toBe("Candlelit manor");
    expect(THEMES["moonlit-crypt"].title).toBe("Moonlit crypt");
    expect(THEMES["graveyard-fog"].title).toBe("Graveyard fog");
    expect({ ...TOKENS }).toEqual({ ...THEMES[DEFAULT_THEME].colors });
  });

  for (const name of ["candlelit-manor", "moonlit-crypt", "graveyard-fog"] as ThemeName[]) {
    describe(name, () => {
      const c = THEMES[name].colors;
      const pairs: [string, string, string, number][] = [
        ["ink on panel", c.ink, c.panel, 4.5],
        ["inkMuted on panel", c.inkMuted, c.panel, 4.5],
        ["roomInk on room", c.roomInk, c.room, 4.5],
        ["roomSubduedInk on roomSubdued", c.roomSubduedInk, c.roomSubdued, 4.5],
        ["wingInk on wing", c.wingInk, c.wing, 4.5],
        ["plateInk on plate", c.plateInk, c.plate, 4.5],
        ["door on floor", c.door, c.floor, 3],
        ["door on panel", c.door, c.panel, 3],
        ["corridor on floor", c.corridor, c.floor, 3],
        ["corridor on panel", c.corridor, c.panel, 3],
        ["focus on floor", c.focus, c.floor, 3],
        ["focus on panel", c.focus, c.panel, 3],
        ["changed on floor", c.changed, c.floor, 3],
        ["changed on panel", c.changed, c.panel, 3],
        ["removed on floor", c.removed, c.floor, 3],
        ["removed on panel", c.removed, c.panel, 3],
        ["added on floor", c.added, c.floor, 3],
        ["added on panel", c.added, c.panel, 3],
        ["sealed on panel", c.sealed, c.panel, 3],
        ["wall on floor", c.wall, c.floor, 3],
        ["passage on floor", c.passage, c.floor, 3],
        ["ghost on floor", c.ghost, c.floor, 3],
        ["ghost on room", c.ghost, c.room, 3],
      ];
      it.each(pairs)("%s is at least its threshold", (label, fg, bg, min) => {
        expect(contrast(fg, bg), label).toBeGreaterThanOrEqual(min);
      });

      it("is never grey: the surfaces and inks carry a hue", () => {
        for (const key of ["floor", "wing", "room", "roomSubdued", "panel", "ink", "wall"] as const) {
          const [r, g, b] = [1, 3, 5].map((o) => parseInt(c[key].slice(o, o + 2), 16)) as [number, number, number];
          expect(Math.max(r, g, b) - Math.min(r, g, b), `${key} ${c[key]}`).toBeGreaterThanOrEqual(8);
        }
      });
    });
  }

  it("is not purple by default: no surface or ink of Candlelit manor or Graveyard fog sits in the purple hues", () => {
    for (const name of ["candlelit-manor", "graveyard-fog"] as const) {
      for (const [key, value] of Object.entries(THEMES[name].colors)) {
        const { h, s } = hsl(value);
        const purple = h >= 255 && h <= 325 && s > 0.15;
        expect(purple, `${name} ${key} ${value}`).toBe(false);
      }
    }
  });

  it("gives Moonlit crypt a violet loop corridor, Candlelit manor a green one and Graveyard fog a cyan one", () => {
    expect(hsl(THEMES["moonlit-crypt"].colors.corridor).h).toBeGreaterThanOrEqual(255);
    expect(hsl(THEMES["moonlit-crypt"].colors.corridor).h).toBeLessThanOrEqual(285);
    const green = hsl(THEMES["candlelit-manor"].colors.corridor).h;
    expect(green).toBeGreaterThanOrEqual(120);
    expect(green).toBeLessThanOrEqual(175);
    const cyan = hsl(THEMES["graveyard-fog"].colors.corridor).h;
    expect(cyan).toBeGreaterThanOrEqual(170);
    expect(cyan).toBeLessThanOrEqual(200);
  });
});

describe("setTheme", () => {
  it("changes TOKENS in place, sets data-theme and tells the listeners", () => {
    const seen: ThemeName[] = [];
    const stop = onThemeChange((name) => seen.push(name));
    setTheme("moonlit-crypt");
    expect(TOKENS.door).toBe(THEMES["moonlit-crypt"].colors.door);
    expect(TOKENS.corridor).toBe(THEMES["moonlit-crypt"].colors.corridor);
    expect(fakeDocument.documentElement.dataset["theme"]).toBe("moonlit-crypt");
    setTheme("graveyard-fog");
    expect(TOKENS.floor).toBe(THEMES["graveyard-fog"].colors.floor);
    stop();
    setTheme("candlelit-manor");
    expect(seen).toEqual(["moonlit-crypt", "graveyard-fog"]);
    expect(TOKENS.door).toBe(THEMES["candlelit-manor"].colors.door);
  });

  it("ignores a name that is not a palette", () => {
    setTheme(DEFAULT_THEME);
    setTheme("nonsense" as ThemeName);
    expect(fakeDocument.documentElement.dataset["theme"]).toBe(DEFAULT_THEME);
    expect(TOKENS.door).toBe(THEMES[DEFAULT_THEME].colors.door);
  });
});

describe("tokens.css reads the same palettes", () => {
  const css = readFileSync(join(SRC, "styles", "tokens.css"), "utf8");
  it("is exactly what themeCss() writes from theme.ts", () => {
    expect(css.startsWith(themeCss())).toBe(true);
  });
  it("carries every token of every palette", () => {
    for (const name of THEME_NAMES) {
      for (const [key, value] of Object.entries(THEMES[name].colors)) {
        const block = name === DEFAULT_THEME ? css : css.slice(css.indexOf(`[data-theme="${name}"]`));
        const match = new RegExp(`--${kebab(key)}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(block);
        expect(match?.[1]?.toLowerCase(), `${name} --${kebab(key)}`).toBe(value.toLowerCase());
      }
    }
  });
});

describe("display face", () => {
  const dir = join(SRC, "styles", "fonts");
  it("is a font file in the repository with its OFL text, and no stylesheet or page asks a remote server for a font", () => {
    const files = existsSync(dir) ? readdirSync(dir) : [];
    expect(files.some((f) => f.endsWith(".ttf") || f.endsWith(".woff2"))).toBe(true);
    const licence = files.find((f) => /OFL/i.test(f));
    expect(licence).toBeDefined();
    expect(readFileSync(join(dir, licence as string), "utf8")).toContain("SIL Open Font License");
    const font = files.find((f) => f.endsWith(".ttf") || f.endsWith(".woff2")) as string;
    expect(statSync(join(dir, font)).size).toBeGreaterThan(20_000);
    const app = readFileSync(join(SRC, "styles", "app.css"), "utf8");
    expect(app).toMatch(/@font-face\s*\{[^}]*url\(["']?\.\/fonts\//);
    const everything = [app, css(), readFileSync(join(SRC, "..", "index.html"), "utf8")].join("\n");
    expect(everything).not.toMatch(/fonts\.googleapis|fonts\.gstatic|@import\s+url\(\s*["']?https?:/i);
  });
  function css(): string {
    return readFileSync(join(SRC, "styles", "tokens.css"), "utf8");
  }
});
