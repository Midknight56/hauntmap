import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// 2.5: a subdued room is "Not in this traversal"; the interface never calls code dead, unused,
// unreachable or orphaned. 7.7: the two panels name graph relations only with imports, imported by and reaches.
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const PANEL_WORDS = [/\bbreaks\b/i, /\bfails\b/i, /\bbroken\b/i, /\bdead\b/i, /\bunused\b/i, /\brisk/i];
const DRAWING_WORDS = [/dead code/i, /\bunused\b/i, /\bunreachable\b/i, /\borphan/i];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx|css)$/.test(name)) out.push(path);
  }
  return out;
}

export function forbiddenIn(text: string, words: RegExp[]): string[] {
  return words.filter((w) => w.test(text)).map((w) => String(w));
}

describe("vocabulary (2.5, 7.7)", () => {
  it("src/scene and src/components contain none of the 2.5 words", () => {
    const hits: string[] = [];
    for (const folder of ["src/scene", "src/components"]) {
      for (const file of sourceFiles(join(REPO, folder))) {
        for (const word of forbiddenIn(readFileSync(file, "utf8"), DRAWING_WORDS)) hits.push(`${relative(REPO, file)}: ${word}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("the loops and who-imports panels contain none of the 7.7 words", () => {
    const hits: string[] = [];
    for (const name of ["LoopsPanel.tsx", "WhoImportsPanel.tsx"]) {
      const text = readFileSync(join(REPO, "src", "components", name), "utf8");
      for (const word of forbiddenIn(text, PANEL_WORDS)) hits.push(`${name}: ${word}`);
    }
    expect(hits).toEqual([]);
  });

  it("the detector flags the words", () => {
    expect(forbiddenIn("it breaks", PANEL_WORDS)).toHaveLength(1);
    expect(forbiddenIn("imports, imported by and reaches", PANEL_WORDS)).toEqual([]);
    expect(forbiddenIn("this is dead code", DRAWING_WORDS)).toHaveLength(1);
    expect(forbiddenIn("an orphaned module", DRAWING_WORDS)).toHaveLength(1);
  });
});