import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { treesEqual } from "./sampleTree";

// pnpm demo:live, the command of the analyze-live hook. Idempotent:
//   1. packages/hauntmap-mcp/dist/cli.js absent            -> skip line, exit 0
//   2. haunts/manor equals public/demo/manor/before       -> skip line, exit 0, nothing written
//   3. otherwise run the CLI on haunts/manor and exit with its code.
// The runner of step 3 is injected so that tests/kiro/demo-live.test.ts needs no built CLI.
// Usage: tsx scripts/demo-live.ts

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI_COMMAND = "analyze haunts/manor --out public/demo/live.json";

export interface DemoLiveIo {
  stdout(text: string): void;
  /** Runs the hauntmap CLI with these arguments and returns its exit code. */
  runner(args: string[]): number;
}

export function runDemoLive(repoRoot: string, io: DemoLiveIo): number {
  if (!existsSync(join(repoRoot, "packages", "hauntmap-mcp", "dist", "cli.js"))) {
    io.stdout("demo:live: skipped (dist/cli.js absent; run pnpm build:mcp)\n");
    return 0;
  }
  if (treesEqual(join(repoRoot, "haunts", "manor"), join(repoRoot, "public", "demo", "manor", "before"))) {
    io.stdout("demo:live: skipped (haunts/manor is identical to public/demo/manor/before)\n");
    return 0;
  }
  return io.runner(CLI_COMMAND.split(" "));
}

/** Spawns the launcher with this Node, without a shell, so that it runs the same under PowerShell and cmd.exe. */
function spawnCli(args: string[]): number {
  const launcher = join(REPO, "packages", "hauntmap-mcp", "bin", "hauntmap.js");
  const result = spawnSync(process.execPath, [launcher, ...args], { cwd: REPO, stdio: "inherit" });
  return result.status ?? 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(runDemoLive(REPO, { stdout: (text) => process.stdout.write(text), runner: spawnCli }));
}
