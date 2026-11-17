import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Item 6 of the design pass: no text under 12 CSS px anywhere. The style sheets state every font size in px or rem
// (so that it can be read here); the scene's labels are checked in the browser (tests/e2e/theme-look.spec.ts) and the
// computed size of every text on the screens is checked by tests/e2e/spacing.spec.ts.

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...cssFiles(path));
    else if (name.endsWith(".css")) out.push(path);
  }
  return out;
}

describe("font sizes in the style sheets", () => {
  const files = cssFiles(SRC);
  it("finds the style sheets", () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  for (const file of files) {
    it(`${file.slice(SRC.length + 1).replace(/\\/g, "/")} has no font size under 12 px and states every size in px or rem`, () => {
      const css = readFileSync(file, "utf8");
      for (const match of css.matchAll(/font-size\s*:\s*([^;}]+)/g)) {
        const value = (match[1] as string).trim();
        const px = /^([\d.]+)px$/.exec(value);
        const rem = /^([\d.]+)rem$/.exec(value);
        if (px === null && rem === null) {
          // `inherit` and a `var()` of a size already checked below are the only other forms allowed.
          expect(value, `font-size: ${value}`).toMatch(/^(inherit|var\(--[a-z-]+\))$/);
          continue;
        }
        const size = px !== null ? Number(px[1]) : Number(rem?.[1]) * 16;
        expect(size, `font-size: ${value}`).toBeGreaterThanOrEqual(12);
      }
      for (const match of css.matchAll(/--[a-z-]*(?:font-size|text)[a-z-]*\s*:\s*([\d.]+)(px|rem)/g)) {
        const size = Number(match[1]) * (match[2] === "rem" ? 16 : 1);
        expect(size, match[0]).toBeGreaterThanOrEqual(12);
      }
    });
  }
});