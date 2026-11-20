import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// 1.6: every folder name, path, label, URL and message is a React text node. The source scan covers both
// intake folders. The rendering case (a folder named `a&b<img src=x onerror=alert(1)>`) comes with the dialog.

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FOLDERS = ["src/features/import", "src/features/github"];
const BANNED = /dangerouslySetInnerHTML|\binnerHTML\b|\bouterHTML\b|insertAdjacentHTML|document\.write\b/;

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(path);
  }
  return files;
}

describe("no markup from strings (1.6)", () => {
  it("no file of src/features/import or src/features/github uses an HTML string API", () => {
    const offenders = FOLDERS.flatMap((folder) => sourceFiles(join(REPO, folder)))
      .filter((file) => BANNED.test(readFileSync(file, "utf8")))
      .map((file) => relative(REPO, file).split("\\").join("/"));
    expect(offenders).toEqual([]);
  });

  it("the scan has files to read", () => {
    expect(FOLDERS.flatMap((folder) => sourceFiles(join(REPO, folder))).length).toBeGreaterThan(0);
  });

  it("the pattern finds each banned API (a check of the check)", () => {
    for (const text of ["x.innerHTML = a", "<div dangerouslySetInnerHTML={h} />", "el.insertAdjacentHTML('a', b)", "n.outerHTML", "document.write(a)"]) expect(BANNED.test(text)).toBe(true);
    expect(BANNED.test("const text = node.textContent;")).toBe(false);
  });
});
