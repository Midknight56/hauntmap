import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SUBDUED_ALPHA } from "../../src/scene/rooms";
import { MAP_BACKGROUND, THEMES } from "../../src/styles/theme";

// Item 1 of the design pass: the owner's tokens are the default palette, the four font files are loaded from the
// repository, no font is requested from a remote server, and no rule changes the case of a text.

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const SRC = join(ROOT, "src");

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...cssFiles(path));
    else if (name.endsWith(".css")) out.push(path);
  }
  return out;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(css|ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

describe("the design tokens are the default palette", () => {
  const c = THEMES["candlelit-manor"].colors;
  it("carries the thirteen colours of the design README", () => {
    expect(c.floor.toLowerCase()).toBe("#170d10"); // bg
    expect(c.panel.toLowerCase()).toBe("#22141a");
    expect(c.room.toLowerCase()).toBe("#2a181e");
    expect(c.wing.toLowerCase()).toBe("#1e1115"); // wing floor
    expect(c.wallLine.toLowerCase()).toBe("#6b464c"); // wall
    expect(c.edge.toLowerCase()).toBe("#8c6f74");
    expect(c.ink.toLowerCase()).toBe("#ede3d0"); // bone
    expect(c.inkMuted.toLowerCase()).toBe("#bba9a6"); // muted
    expect(c.focus.toLowerCase()).toBe("#f2b24c"); // candle
    expect(c.corridor.toLowerCase()).toBe("#7df2c6"); // ecto
    expect(c.added.toLowerCase()).toBe("#a6e06a"); // moss
    expect(c.onFill.toLowerCase()).toBe("#3a232a");
    expect(c.selectedFill.toLowerCase()).toBe("#3b2616");
  });

  it("states the map background of the README", () => {
    expect(MAP_BACKGROUND).toBe("radial-gradient(900px 620px at 44% 40%, #2C171D, transparent 72%)");
    expect(c.mapGlow.toLowerCase()).toBe("#2c171d");
  });

  it("keeps the other two palettes", () => {
    expect(THEMES["moonlit-crypt"].colors.floor).toBe("#080c16");
    expect(THEMES["graveyard-fog"].colors.floor).toBe("#0c150e");
    for (const name of ["moonlit-crypt", "graveyard-fog"] as const) {
      for (const key of ["edge", "onFill", "selectedFill", "mapGlow", "wallLine"] as const) expect(THEMES[name].colors[key]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("fonts", () => {
  const fonts = join(SRC, "styles", "fonts");
  const app = readFileSync(join(SRC, "styles", "app.css"), "utf8");

  it("loads Almendra SC, Spectral 400 and 600, and Spline Sans Mono from the committed files", () => {
    for (const [family, file] of [
      ["Almendra SC", "AlmendraSC-Regular.ttf"],
      ["Spectral", "Spectral-Regular.ttf"],
      ["Spectral", "Spectral-SemiBold.ttf"],
      ["Spline Sans Mono", "SplineSansMono-VariableFont_wght.ttf"],
    ] as const) {
      expect(existsSync(join(fonts, file)), file).toBe(true);
      const face = new RegExp(`@font-face\\s*\\{[^}]*font-family:\\s*"${family}"[^}]*url\\(["']?\\./fonts/${file.replace(/\./g, "\\.")}["']?\\)[^}]*\\}`);
      expect(app, `${family} ${file}`).toMatch(face);
    }
    expect(app).toMatch(/font-weight:\s*600/);
  });

  it("requests no font from a remote server", () => {
    const all = [...cssFiles(SRC).map((f) => readFileSync(f, "utf8")), readFileSync(join(ROOT, "index.html"), "utf8")].join("\n");
    expect(all).not.toMatch(/fonts\.googleapis|fonts\.gstatic|@import\s+url\(\s*["']?https?:/i);
  });

  it("has no text-transform anywhere in the styles or the scene", () => {
    for (const file of sourceFiles(SRC)) expect(readFileSync(file, "utf8"), file).not.toMatch(/text-transform|textTransform/);
  });

  it("drops Cinzel: no file in src names it, and its files are gone", () => {
    for (const file of sourceFiles(SRC)) expect(readFileSync(file, "utf8"), file).not.toMatch(/Cinzel/);
    expect(existsSync(join(fonts, "Cinzel-VariableFont_wght.ttf"))).toBe(false);
    expect(existsSync(join(fonts, "Cinzel-OFL.txt"))).toBe(false);
  });

  it("names each font and its licence in docs/third-party-notices.md", () => {
    const notices = readFileSync(join(ROOT, "docs", "third-party-notices.md"), "utf8");
    for (const family of ["Almendra SC", "Spectral", "Spline Sans Mono"]) expect(notices).toContain(family);
    expect(notices).toContain("SIL Open Font License");
    for (const file of readdirSync(fonts).filter((f) => f.endsWith("OFL.txt"))) expect(notices).toContain(file);
  });
});

describe("contrast of the text of the design (item 6)", () => {
  const c = THEMES["candlelit-manor"].colors;
  const lum = (hex: string): number => {
    const ch = (o: number): number => {
      const v = parseInt(hex.slice(o, o + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * ch(1) + 0.7152 * ch(3) + 0.0722 * ch(5);
  };
  const ratio = (a: string, b: string): number => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
    return (hi + 0.05) / (lo + 0.05);
  };
  const mix = (a: string, b: string, t: number): string =>
    `#${[1, 3, 5].map((o) => Math.round(parseInt(a.slice(o, o + 2), 16) * t + parseInt(b.slice(o, o + 2), 16) * (1 - t)).toString(16).padStart(2, "0")).join("")}`;

  it("keeps every text colour at 4.5:1 or better on the surface it is drawn on", () => {
    const pairs: [string, string, string][] = [
      ["bone on panel", c.ink, c.panel],
      ["bone on page", c.ink, c.floor],
      ["muted on panel", c.inkMuted, c.panel],
      ["muted on page", c.inkMuted, c.floor],
      ["bone on room", c.roomInk, c.room],
      ["bone on toggled-on fill", c.ink, c.onFill],
      ["bone on selected fill", c.ink, c.selectedFill],
      ["candle on panel", c.focus, c.panel],
      ["page colour on candle (the brass plate)", c.floor, c.focus],
      ["ecto on panel", c.corridor, c.panel],
      ["moss on panel", c.added, c.panel],
      ["bone on wing floor", c.wingInk, c.wing],
    ];
    for (const [name, fg, bg] of pairs) expect(ratio(fg, bg), name).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the name of a subdued room at 4.5:1 with the room drawn at 55 percent opacity", () => {
    expect(SUBDUED_ALPHA).toBeGreaterThanOrEqual(0.45);
    expect(SUBDUED_ALPHA).toBeLessThanOrEqual(0.55);
    const room = mix(c.roomSubdued, c.floor, SUBDUED_ALPHA);
    const ink = mix(c.roomSubduedInk, c.floor, SUBDUED_ALPHA);
    expect(ratio(ink, room)).toBeGreaterThanOrEqual(4.5);
  });
});
