import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// Vitest global setup: builds packages/hauntmap-mcp/dist once when it is missing or older than the
// sources it bundles (the package's own src, ../../src and the build script), so that the tests
// that spawn the built server and CLI run against the current code.

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PACKAGE = join(REPO, "packages", "hauntmap-mcp");

function newestMtime(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(path) : statSync(path).mtimeMs);
  }
  return newest;
}

export default function setup(): void {
  const outputs = [join(PACKAGE, "dist", "index.js"), join(PACKAGE, "dist", "cli.js")];
  const sources = Math.max(newestMtime(join(PACKAGE, "src")), newestMtime(join(REPO, "src")), statSync(join(PACKAGE, "build.mjs")).mtimeMs);
  const stale = outputs.some((output) => !existsSync(output) || statSync(output).mtimeMs < sources);
  if (!stale) return;
  const result = spawnSync(process.execPath, [join(PACKAGE, "build.mjs")], { cwd: PACKAGE, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`building packages/hauntmap-mcp failed with exit code ${String(result.status)}`);
}
