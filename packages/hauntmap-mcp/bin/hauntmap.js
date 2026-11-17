#!/usr/bin/env node
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

// Launcher of the hauntmap CLI. Plain JavaScript, no dependencies. It loads dist/cli.js through a
// file URL, because import() rejects a bare Windows path such as D:\... .
const cliPath = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");

if (!existsSync(cliPath)) {
  process.stderr.write("hauntmap: the CLI is not built. Run pnpm build:mcp first.\n");
  process.exit(3);
}

const cli = await import(pathToFileURL(cliPath).href);
if (typeof cli.main !== "function") {
  process.stderr.write("hauntmap: dist/cli.js has no main function. Run pnpm build:mcp first.\n");
  process.exit(3);
}
const io = {
  cwd: process.cwd(),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};
process.exitCode = await cli.main(process.argv.slice(2), io);
