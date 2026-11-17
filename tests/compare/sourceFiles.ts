import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Every file under the comparison's source folders, as [repository path, text]. */
export function compareSources(): [string, string][] {
  const out: [string, string][] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else out.push([relative(REPO, path).split("\\").join("/"), readFileSync(path, "utf8")]);
    }
  };
  for (const folder of ["src/features/compare", "src/scene/compare"]) if (existsSync(join(REPO, folder))) walk(join(REPO, folder));
  out.push(["src/analysis/graph/compare.ts", readFileSync(join(REPO, "src", "analysis", "graph", "compare.ts"), "utf8")]);
  return out;
}