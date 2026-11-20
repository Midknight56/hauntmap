# HauntMap power

A Kiro power in the Agent Plugins format. It gives Kiro the four tools of the HauntMap MCP server (`analyze`, `cycles`, `who_imports`, `compare`, from `packages/hauntmap-mcp`) and one skill, `refactor-loops`, which holds the rule of `.kiro/steering/refactoring.md`: call `cycles` before an import change, call `compare` after it, and report the removed and added relations.

The power does not carry the server. It starts the server file that your clone of this repository builds.

## What it needs

- Node 24 or later.
- A clone of this repository, with `pnpm install` and `pnpm build:mcp` run once. That writes `packages/hauntmap-mcp/dist/index.js`.
- Two environment variables, set before you start Kiro:
  - `HAUNTMAP_MCP_DIST`: the full path of `packages/hauntmap-mcp/dist/index.js` in your clone.
  - `HAUNTMAP_WORKSPACE`: the full path of the folder you work in. The tools accept only folders inside it, and they take them relative to it.

Kiro copies an installed power to its own folder and starts its server there, so the server cannot find your clone or your project on its own. That is why the two variables exist (seen in `docs/acceptance/power-session/README.md`: without the second one the server's working directory was the installed power's folder).

## Install

From the root of your clone, in PowerShell:

```powershell
pnpm install
pnpm build:mcp
$env:HAUNTMAP_MCP_DIST = (Resolve-Path packages/hauntmap-mcp/dist/index.js).Path
$env:HAUNTMAP_WORKSPACE = (Get-Location).Path
kiro-cli powers install power/hauntmap
```

The command prints `Installed power "hauntmap"`. The next Kiro CLI session loads it. In the Kiro IDE, the powers panel lists a power that the CLI installed. The power activates when you talk about dependency cycles, circular imports, import loops, who imports a module, or refactoring imports.

## Use

Ask in plain words, for example: `Which dependency loops are in the folder src?` Kiro calls `cycles` on that folder. Tools from a power ask for approval. In a headless session, name the trusted tools: `--trust-tools="kiro_powers,@hauntmap"`.

## Uninstall

```powershell
kiro-cli powers uninstall hauntmap
```

Uninstall it when you are done, because an installed power is loaded into every later session on the machine.

## Limits

A loop or a relation is a structural fact about static imports under the named preset (`static-value` by default). It is not a correctness, safety or performance claim. The tools read files inside the workspace and never run the analyzed code.
