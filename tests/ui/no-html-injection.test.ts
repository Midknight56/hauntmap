import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// 5.3: IDs, paths and specifiers reach the screen as React text nodes only.
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FOLDERS = ["src/components", "src/features", "src/scene"];
const FORBIDDEN = ["dangerouslySetInnerHTML", "innerHTML", "outerHTML", "insertAdjacentHTML", "document.write"];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

/** Every occurrence of a forbidden name, as `file: name`. */
export function findInjection(text: string): string[] {
  return FORBIDDEN.filter((name) => text.includes(name));
}

describe("no HTML injection (5.3)", () => {
  it("none of the forbidden APIs appears in src/components, src/features or src/scene", () => {
    const hits: string[] = [];
    for (const folder of FOLDERS) {
      for (const file of sourceFiles(join(REPO, folder))) {
        for (const name of findInjection(readFileSync(file, "utf8"))) hits.push(`${relative(REPO, file)}: ${name}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("the detector flags each forbidden name", () => {
    for (const name of FORBIDDEN) expect(findInjection(`el.${name} = x`)).toEqual([name]);
    expect(findInjection("textContent = x")).toEqual([]);
  });
});