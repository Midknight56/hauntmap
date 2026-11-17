import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// Plain text cross check of requirement 8.5. It counts, line by line, the statements that end in
// a module specifier and compares the count of each file with the imports that expected.json
// lists for it. It does not parse and does not use the analyzer.
// Usage: node scripts/check-expected.mjs [sampleFolder ...]

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SAMPLES = ["manor/before", "manor/after", "annex"].map((name) => join(REPO, "public", "demo", ...name.split("/")));
const EXTENSIONS = [".js", ".jsx", ".ts", ".tsx", ".mjs", ".mts"];
const STATEMENT = [/from\s+["']/, /^\s*import\s+["']/, /\bimport\(\s*["']/];

function collect(dir, prefix, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) collect(join(dir, entry.name), relative, out);
    else if (EXTENSIONS.some((extension) => entry.name.endsWith(extension))) out.push(relative);
  }
}

const folders = process.argv.slice(2).map((arg) => resolve(arg));
const targets = folders.length > 0 ? folders : DEFAULT_SAMPLES;
const problems = [];

for (const dir of targets) {
  const expected = JSON.parse(readFileSync(join(dir, "expected.json"), "utf8"));
  const listed = new Map();
  for (const entry of expected.imports) listed.set(entry.from, (listed.get(entry.from) ?? 0) + 1);

  const paths = [];
  collect(dir, "", paths);
  const counted = new Map();
  let total = 0;
  for (const path of paths) {
    const lines = readFileSync(join(dir, ...path.split("/")), "utf8").split("\n");
    const count = lines.filter((line) => STATEMENT.some((pattern) => pattern.test(line))).length;
    if (count > 0) counted.set(path, count);
    total += count;
  }
  for (const path of new Set([...counted.keys(), ...listed.keys()])) {
    const found = counted.get(path) ?? 0;
    const wanted = listed.get(path) ?? 0;
    if (found !== wanted) problems.push(`${dir}: ${path} has ${found} import lines, expected.json lists ${wanted}`);
  }
  process.stdout.write(`${dir}: ${total} import lines in ${paths.length} files, expected.json lists ${expected.imports.length}\n`);
}

if (problems.length > 0) {
  process.stderr.write(`${problems.join("\n")}\n`);
  process.exit(1);
}
