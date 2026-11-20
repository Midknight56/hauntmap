# Proof: the hauntmap power in one headless Kiro session

Date: 2026-11-20. Machine: the Windows machine of `docs/acceptance/hook-verify-on-stop.md`. Tool: Kiro CLI 3.5.0 (`kiro-cli --version` printed `kiro-cli 3.5.0`), model `auto`, harness V3 (`--v3`). The power is `power/hauntmap/`. Files here: `session-output.txt` (the output of the session) and this page.

## Commands, in the order they ran

From the repository root, in PowerShell, after `pnpm install` and `pnpm build:mcp`:

```powershell
$env:HAUNTMAP_MCP_DIST = (Resolve-Path packages/hauntmap-mcp/dist/index.js).Path
$env:HAUNTMAP_WORKSPACE = (Resolve-Path D:/Projects/kiroween/hauntmap-logs/power-run).Path
kiro-cli powers install power/hauntmap
```

Output: `Installed power "hauntmap"`. Before it, `~/.kiro/powers/installed.json` listed no power.

The throwaway folder `D:/Projects/kiroween/hauntmap-logs/power-run/` held only `manor/`, a copy of `haunts/manor` (40 files) and no `.kiro` folder, so the session had no workspace MCP configuration of its own. Then, from that folder:

```powershell
kiro-cli chat --v3 --no-interactive --trust-workspace --trust-tools="kiro_powers,@hauntmap" "Which dependency loops are in the folder named manor in this directory? List each loop with its files."
```

The prompt names no tool. Exit code 0, 8.8 seconds.

```powershell
kiro-cli powers uninstall hauntmap
```

Output: `Uninstalled power "hauntmap"`. After it, `~/.kiro/powers/installed/hauntmap` did not exist and `installed.json` listed `"installedPowers": []`. The power is therefore not loaded into later sessions on this machine.

## Tool calls seen

Lines of `session-output.txt` that name a tool:

```
[tool] Tool Load
[tool] @hauntmap/hauntmap/cycles
[tool] status: Completed
```

`Tool Load` is Kiro loading the power. `@hauntmap/hauntmap/cycles` is one call of the `cycles` tool of the power's server `hauntmap`; it completed. The output does not print the call's arguments or the raw result, so the folder and preset it used are not shown; the answer names `manor` and the `static-value` preset. No shell call appears in the output.

## What the session answered

One loop under `static-value`, with the members `src/notifications/receipt.ts`, `src/orders/checkout.ts` and `src/payments/charge.ts` (relative to `manor`). `public/demo/manor/before/expected.json` lists a cyclic component with the same three members (the folder copy is of `haunts/manor`, which `pnpm demo:reset` restores from `public/demo/manor/before`). The check of those members against the expected facts was done by reading, not by a test of this session.

## What did not work first

These runs happened while the power was being built. Their output is in `D:/Projects/kiroween/hauntmap-logs/power-run-1.txt` to `power-run-3.txt` and is not copied here.

1. Without `--trust-tools`, the call was refused: `[denied] tool permission approval is not supported in non-interactive mode. Use --trust-tools=kiro_powers to auto-approve this tool, or --trust-all-tools to auto-approve every tool.`
2. With the tool trusted, the first version of `mcp.json` started the server in the folder of the installed power. The tool replied `Root "../.." resolves outside the working directory "C:\Users\adria\.kiro\powers\installed\hauntmap".` and `Root "manor" does not exist or is not a directory.` Kiro copies the power and starts its server there, so the server could not see the session folder. The fix is the variable `HAUNTMAP_WORKSPACE` in `power/hauntmap/mcp.json`, which changes the server's working directory before it loads, and `HAUNTMAP_MCP_DIST` for the server file.
3. A relative path to the server file (`../../packages/hauntmap-mcp/dist/index.js`) cannot work, because the installed copy sits outside the clone. That is why `mcp.json` reads the path from `HAUNTMAP_MCP_DIST`.

## Limits

One session, one prompt, one folder. It shows that the power installs, that Kiro loads it and calls its `cycles` tool on a folder of the session, and that the loop members match the expected facts. It does not show the `analyze`, `who_imports` or `compare` tools, the skill being followed, the IDE route, or any other machine. The result is a structural fact about static imports, not a statement about correctness.
