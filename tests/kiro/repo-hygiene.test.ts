import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { REPO } from "./appPath";

// Requirement 10.6: .kiro and the live snapshot are committed; .hauntmap/ is not.

function ignored(path: string): boolean {
  const result = spawnSync("git", ["check-ignore", "-q", "--no-index", path], { cwd: REPO });
  if (result.status !== 0 && result.status !== 1) throw new Error(`git check-ignore failed for ${path}: ${String(result.stderr)}`);
  return result.status === 0;
}

describe(".gitignore", () => {
  it.each([".kiro/hooks/verify-on-stop.json", ".kiro/settings/mcp.json", ".kiro/steering/refactoring.md", ".kiro", "public/demo/live.json", "haunts/manor/src/index.ts", "docs/kiro-log.md"])("does not ignore %s", (path) => {
    expect(ignored(path)).toBe(false);
  });

  it.each([".hauntmap/live.json", ".hauntmap/before/manor/a.ts"])("ignores %s", (path) => {
    expect(ignored(path)).toBe(true);
  });
});
