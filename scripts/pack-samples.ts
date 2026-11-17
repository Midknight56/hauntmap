import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_ANALYSIS_OPTIONS } from "../src/contracts/options";

// Writes sources.json beside each sample: every source file path and its text, so that the app
// can load a sample with one request. `--check` writes nothing and fails when a file is stale.
// Usage: tsx scripts/pack-samples.ts [--check] [sampleFolder ...]

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SAMPLES = ["manor/before", "manor/after", "annex"].map((name) => join(REPO, "public", "demo", ...name.split("/")));

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function collect(dir: string, prefix: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) collect(join(dir, entry.name), relative, out);
    else if (DEFAULT_ANALYSIS_OPTIONS.includeExtensions.some((extension) => entry.name.endsWith(extension))) out.push(relative);
  }
}

function packSample(dir: string): string {
  const paths: string[] = [];
  collect(dir, "", paths);
  paths.sort(compareText);
  const files = paths.map((path) => ({ path, text: readFileSync(join(dir, ...path.split("/")), "utf8") }));
  return `${JSON.stringify({ files }, null, 2)}\n`;
}

const args = process.argv.slice(2);
const check = args.includes("--check");
const folders = args.filter((arg) => arg !== "--check").map((arg) => resolve(arg));
const targets = folders.length > 0 ? folders : DEFAULT_SAMPLES;

let failed = false;
for (const dir of targets) {
  const target = join(dir, "sources.json");
  const packed = packSample(dir);
  if (check) {
    if (!existsSync(target)) {
      process.stderr.write(`${target} is missing; run pnpm pack:samples\n`);
      failed = true;
    } else if (readFileSync(target, "utf8") !== packed) {
      process.stderr.write(`${target} is stale; run pnpm pack:samples\n`);
      failed = true;
    }
  } else {
    writeFileSync(target, packed, "utf8");
    process.stdout.write(`wrote ${target}\n`);
  }
}
process.exit(failed ? 1 : 0);
