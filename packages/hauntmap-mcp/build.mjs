import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// Builds dist/index.js (MCP server) and dist/cli.js (hauntmap CLI) as self-contained ES modules:
// every dependency, and the analysis code of ../../src, is inlined, so that Node 24 runs the files
// from any folder without a package.json or node_modules beside them. The banner gives bundled
// CommonJS dependencies a working `require`.

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "dist");

rmSync(out, { recursive: true, force: true });

await build({
  entryPoints: { index: join(here, "src", "index.ts"), cli: join(here, "src", "cli.ts") },
  outdir: out,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  legalComments: "none",
  logLevel: "warning",
  banner: {
    js: 'import { createRequire as __hauntmapCreateRequire } from "node:module"; const require = __hauntmapCreateRequire(import.meta.url);',
  },
});

process.stdout.write("built dist/index.js and dist/cli.js\n");
