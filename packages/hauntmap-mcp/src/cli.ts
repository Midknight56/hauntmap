import { realpath, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ToolErrorCode } from "./errors";
import { nodeFs } from "./loader";
import type { FsLike } from "./loader";
import { analyzeTool, createContext, PRESETS } from "./tools";
import type { ToolContext } from "./tools";

// The `hauntmap` command line tool, launched by bin/hauntmap.js. It runs the same tool functions as
// the MCP server and writes their result to a file (design.md, "CLI").

export const USAGE = [
  "Usage: hauntmap analyze <root> --out <file> [--preset static-value|type-inclusive|dynamic-inclusive]",
  "       hauntmap compare <before> <after> --out <file>",
].join("\n");

export type ExitCode = 0 | 2 | 3 | 4 | 5 | 6;

export interface CliIo {
  cwd: string;
  stdout(text: string): void;
  stderr(text: string): void;
  fs?: FsLike;
  /** Tests inject a ToolContext; the launcher leaves it out. */
  context?: ToolContext;
}

const ARROW = "\u2192";
const RETRY_CODES = ["EPERM", "EBUSY"];

interface Parsed {
  command: "analyze" | "compare";
  roots: string[];
  out: string;
  preset: string | null;
}

function parse(argv: string[]): Parsed | null {
  const [command, ...rest] = argv;
  if (command !== "analyze" && command !== "compare") return null;
  const roots: string[] = [];
  let out: string | null = null;
  let preset: string | null = null;
  for (let i = 0; i < rest.length; i += 1) {
    const word = rest[i] as string;
    if (word === "--out" || word === "--preset") {
      const value = rest[i + 1];
      if (value === undefined || value.startsWith("--")) return null;
      if (word === "--out") out = value;
      else preset = value;
      i += 1;
    } else if (word.startsWith("--")) {
      return null;
    } else {
      roots.push(word);
    }
  }
  if (out === null || roots.length !== (command === "analyze" ? 1 : 2)) return null;
  if (command === "compare" && preset !== null) return null;
  return { command, roots, out, preset };
}

async function isHauntmapRoot(fs: FsLike, cwd: string): Promise<boolean> {
  try {
    const text = new TextDecoder("utf-8").decode(await fs.readFile(resolve(cwd, "package.json")));
    return (JSON.parse(text) as { name?: unknown }).name === "hauntmap";
  } catch {
    return false;
  }
}

function exitFor(code: ToolErrorCode, message: string): ExitCode {
  if (code === "invalid-arguments" || code === "invalid-preset") return 2;
  if (code === "analysis-failed" && message.startsWith("internal error, output failed validation")) return 5;
  return 4;
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

/** Writes `text` to `path` through `<path>.tmp` and a rename; the rename is retried where Windows holds the target open. */
async function writeAtomically(path: string, text: string): Promise<void> {
  const temporary = `${path}.tmp`;
  try {
    await writeFile(temporary, text, "utf8");
    for (let attempt = 1; ; attempt += 1) {
      try {
        await rename(temporary, path);
        return;
      } catch (thrown) {
        const code = (thrown as NodeJS.ErrnoException).code ?? "";
        if (!RETRY_CODES.includes(code) || attempt >= 5) throw thrown;
        await sleep(100);
      }
    }
  } catch (thrown) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw thrown;
  }
}

export async function main(argv: string[], io: CliIo): Promise<ExitCode> {
  const fs = io.fs ?? nodeFs;
  if (!(await isHauntmapRoot(fs, io.cwd))) {
    io.stderr(`hauntmap: run from the HauntMap repository root (no package.json named hauntmap in ${io.cwd}).\n`);
    return 4;
  }
  const parsed = parse(argv);
  if (parsed === null) {
    io.stderr(`${USAGE}\n`);
    return 2;
  }
  if (parsed.preset !== null && !PRESETS.includes(parsed.preset as (typeof PRESETS)[number])) {
    io.stderr(`hauntmap: Preset "${parsed.preset}" is not one of ${PRESETS.join(", ")}.\n`);
    return 2;
  }
  if (parsed.command === "compare") {
    io.stderr("hauntmap: compare is not available until snapshot-comparison lands\n");
    return 4;
  }

  const ctx = io.context ?? createContext(await realpath(io.cwd), { fs: io.fs, log: () => undefined });
  const result = await analyzeTool(ctx, { root: parsed.roots[0], ...(parsed.preset === null ? {} : { preset: parsed.preset }) });
  if (!result.ok) {
    io.stderr(`hauntmap: ${result.error.message}\n`);
    return exitFor(result.error.code, result.error.message);
  }

  const investigation = result.value;
  const target = resolve(io.cwd, parsed.out);
  try {
    await writeAtomically(target, `${JSON.stringify(investigation, null, 2)}\n`);
  } catch (thrown) {
    io.stderr(`hauntmap: cannot write ${parsed.out} (${(thrown as NodeJS.ErrnoException).code ?? "unknown"}).\n`);
    return 6;
  }
  const relations = new Set(investigation.imports.map((record) => record.relationId)).size;
  io.stdout(`analyze: ${investigation.modules.length} modules, ${relations} relations, ${investigation.diagnostics.length} diagnostics ${ARROW} ${parsed.out}\n`);
  return 0;
}
