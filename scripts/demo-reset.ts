import { mkdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { copyIncluded } from "./sampleTree";

// pnpm demo:reset: restores haunts/manor from public/demo/manor/before (included extensions only).
// Usage: tsx scripts/demo-reset.ts

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Deletes haunts/manor and copies the included files of the fixture; returns the number of files. Throws when the fixture is missing. */
export function resetSample(repoRoot: string): number {
  const fixture = join(repoRoot, "public", "demo", "manor", "before");
  const sample = join(repoRoot, "haunts", "manor");
  if (!statSync(fixture).isDirectory()) throw new Error(`${fixture} is not a directory`);
  rmSync(sample, { recursive: true, force: true });
  mkdirSync(sample, { recursive: true });
  return copyIncluded(fixture, sample);
}

export function runReset(repoRoot: string, stdout: (text: string) => void, stderr: (text: string) => void): number {
  try {
    const count = resetSample(repoRoot);
    stdout(`demo:reset: haunts/manor restored from public/demo/manor/before (${count} files)\n`);
    return 0;
  } catch (error) {
    stderr(`demo:reset: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(runReset(REPO, (text) => process.stdout.write(text), (text) => process.stderr.write(text)));
}
