import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// 10.4 and 10.6: src/features/import/intake.css uses the manor tokens only. The checks are written here, not
// imported from tests/ui/styles.test.ts.

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const css = readFileSync(join(REPO, "src", "features", "import", "intake.css"), "utf8");
const tokens = readFileSync(join(REPO, "src", "styles", "tokens.css"), "utf8");
const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");

interface Rule {
  selector: string;
  declarations: { property: string; value: string }[];
}

function rules(text: string): Rule[] {
  const found: Rule[] = [];
  for (const match of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declarations = (match[2] ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part !== "")
      .map((part) => {
        const colon = part.indexOf(":");
        return { property: part.slice(0, colon).trim().toLowerCase(), value: part.slice(colon + 1).trim() };
      });
    found.push({ selector: (match[1] ?? "").trim(), declarations });
  }
  return found;
}

const parsed = rules(bare);
const NAMED_COLORS = [
  "aliceblue", "antiquewhite", "aqua", "aquamarine", "azure", "beige", "bisque", "black", "blanchedalmond", "blue", "blueviolet", "brown",
  "burlywood", "cadetblue", "chartreuse", "chocolate", "coral", "cornflowerblue", "cornsilk", "crimson", "cyan", "darkblue", "darkcyan",
  "darkgoldenrod", "darkgray", "darkgreen", "darkgrey", "darkkhaki", "darkmagenta", "darkolivegreen", "darkorange", "darkorchid", "darkred",
  "darksalmon", "darkseagreen", "darkslateblue", "darkslategray", "darkturquoise", "darkviolet", "deeppink", "deepskyblue", "dimgray",
  "dodgerblue", "firebrick", "floralwhite", "forestgreen", "fuchsia", "gainsboro", "ghostwhite", "gold", "goldenrod", "gray", "green",
  "greenyellow", "grey", "honeydew", "hotpink", "indianred", "indigo", "ivory", "khaki", "lavender", "lavenderblush", "lawngreen",
  "lemonchiffon", "lightblue", "lightcoral", "lightcyan", "lightgray", "lightgreen", "lightgrey", "lightpink", "lightsalmon", "lightseagreen",
  "lightskyblue", "lightslategray", "lightsteelblue", "lightyellow", "lime", "limegreen", "linen", "magenta", "maroon", "mediumaquamarine",
  "mediumblue", "mediumorchid", "mediumpurple", "mediumseagreen", "mediumslateblue", "mediumspringgreen", "mediumturquoise", "mediumvioletred",
  "midnightblue", "mintcream", "mistyrose", "moccasin", "navajowhite", "navy", "oldlace", "olive", "olivedrab", "orange", "orangered", "orchid",
  "palegoldenrod", "palegreen", "paleturquoise", "palevioletred", "papayawhip", "peachpuff", "peru", "pink", "plum", "powderblue", "purple",
  "rebeccapurple", "red", "rosybrown", "royalblue", "saddlebrown", "salmon", "sandybrown", "seagreen", "seashell", "sienna", "silver", "skyblue",
  "slateblue", "slategray", "snow", "springgreen", "steelblue", "tan", "teal", "thistle", "tomato", "turquoise", "violet", "wheat", "white",
  "whitesmoke", "yellow", "yellowgreen",
];
const COLOR_PROPERTIES = /^(color|background|background-color|border|border-color|border-top|border-bottom|border-left|border-right|outline|outline-color|box-shadow|text-shadow|fill|stroke|caret-color|accent-color)$/;

describe("intake.css (10.4, 10.6)", () => {
  it("has rules to check", () => {
    expect(parsed.length).toBeGreaterThan(10);
  });

  it("holds no color literal: no hex, rgb, hsl, hwb, lab, lch, oklab, oklch or named color", () => {
    expect(bare).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(bare).not.toMatch(/\b(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\(/i);
    const offenders: string[] = [];
    for (const rule of parsed)
      for (const { property, value } of rule.declarations) {
        if (!COLOR_PROPERTIES.test(property)) continue;
        const words = value.replace(/var\([^)]*\)/g, " ").toLowerCase().split(/[^a-z]+/);
        for (const word of words) if (NAMED_COLORS.includes(word)) offenders.push(`${rule.selector} { ${property}: ${value} }`);
      }
    expect(offenders).toEqual([]);
  });

  it("uses only tokens that tokens.css defines, and adds no token of its own", () => {
    const defined = new Set(Array.from(tokens.matchAll(/(--[a-z0-9-]+)\s*:/g)).map((match) => match[1]));
    const used = new Set(Array.from(bare.matchAll(/var\((--[a-z0-9-]+)/g)).map((match) => match[1]));
    expect([...used].filter((name) => !defined.has(name))).toEqual([]);
    expect(bare).not.toMatch(/(^|[;{\s])--[a-z0-9-]+\s*:/);
  });

  it("sets no font size under 12 px and no relative unit that could go under it", () => {
    const offenders: string[] = [];
    for (const rule of parsed)
      for (const { property, value } of rule.declarations) {
        if (property !== "font-size" && property !== "font") continue;
        for (const match of value.matchAll(/(\d*\.?\d+)(px|rem|em|pt|%|vw|vh)\b/g)) {
          const amount = Number(match[1]);
          const unit = match[2];
          if (property === "font" && !/\//.test(value) && unit !== "px") continue;
          if (unit !== "px" || amount < 12) offenders.push(`${rule.selector} { ${property}: ${value} }`);
        }
        if (/\b(xx-small|x-small|small|smaller)\b/.test(value)) offenders.push(`${rule.selector} { ${property}: ${value} }`);
      }
    expect(offenders).toEqual([]);
  });

  it("never removes the focus outline", () => {
    expect(bare).not.toMatch(/outline\s*:\s*(none|0)\b/i);
    expect(bare).not.toMatch(/outline-style\s*:\s*none/i);
  });

  it("animates nothing: no animation, no transition, no keyframes", () => {
    expect(bare).not.toMatch(/\banimation(-[a-z]+)?\s*:/i);
    expect(bare).not.toMatch(/\btransition(-[a-z]+)?\s*:/i);
    expect(bare).not.toMatch(/@keyframes/i);
  });

  const declaration = (selector: string, property: string): string | undefined =>
    parsed.find((rule) => rule.selector === selector)?.declarations.find((d) => d.property === property)?.value;

  it("builds the panel, the heading, the body text and the backdrop from the manor tokens", () => {
    expect(declaration(".intake-dialog", "background")).toBe("var(--panel)");
    expect(declaration(".intake-dialog", "border")).toBe("1px solid var(--wall-line)");
    expect(declaration(".intake-dialog", "font-family")).toBe("var(--font-ui)");
    expect(declaration(".intake-dialog", "color")).toBe("var(--ink)");
    expect(declaration(".intake-heading", "font-family")).toBe("var(--font-display)");
    expect(declaration(".intake-heading", "color")).toBe("var(--focus)");
    expect(declaration(".intake-backdrop", "background")).toContain("var(--floor)");
    expect(declaration(".intake-mono", "font-family")).toBe("var(--font-mono)");
    expect(declaration(".intake-muted", "color")).toBe("var(--ink-muted)");
  });

  it("keeps the dialog inside the viewport width and scrolling inside it (10.5)", () => {
    expect(declaration(".intake-dialog", "max-width")).toMatch(/100vw|100%/);
    expect(declaration(".intake-dialog", "max-height")).toMatch(/vh|dvh|%/);
    expect(declaration(".intake-dialog", "overflow-y")).toBe("auto");
    expect(declaration(".intake-list", "overflow")).toBeDefined();
  });

  it("makes file inputs at least var(--hit) tall", () => {
    expect(declaration('.intake-dialog input[type="file"]', "min-height")).toBe("var(--hit)");
  });
});
