import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO } from "./appPath";

// Requirements 6.1, 6.2, 6.5 and 6.7. The hook files of .kiro/hooks, the citation guard and the
// strings of scripts/demo-live.ts.

interface Hook {
  name: string;
  trigger: string;
  matcher?: string;
  action: { type: string; command: string };
  timeout: number;
}
interface HookFile {
  version: string;
  hooks: Hook[];
}

function readHooks(file: string): HookFile {
  return JSON.parse(readFileSync(join(REPO, ".kiro", "hooks", file), "utf8")) as HookFile;
}
function readLogRows(): string[] {
  return readFileSync(join(REPO, "docs", "kiro-log.md"), "utf8").split("\n").filter((line) => line.startsWith("|"));
}

const TRIGGERS = ["Stop", "PostFileSave"];

describe("6.1 verify-on-stop.json", () => {
  const file = readHooks("verify-on-stop.json");
  it("has one hook named verify-on-stop with the command pnpm verify (or pnpm verify:fast), timeout 600 and a command action", () => {
    expect(file.version).toBe("v1");
    expect(file.hooks).toHaveLength(1);
    const hook = file.hooks[0] as Hook;
    expect(hook.name).toBe("verify-on-stop");
    expect(["pnpm verify", "pnpm verify:fast"]).toContain(hook.action.command);
    expect(hook.action.type).toBe("command");
    expect(hook.timeout).toBe(600);
    expect(hook.matcher).toBeUndefined();
    expect(TRIGGERS).toContain(hook.trigger);
  });
});

describe("6.1 and 6.2 analyze-live.json", () => {
  it("has at most the two scaffold entries, each running pnpm demo:live with timeout 120", () => {
    const file = readHooks("analyze-live.json");
    expect(file.version).toBe("v1");
    expect(file.hooks.length).toBeGreaterThanOrEqual(1);
    expect(file.hooks.length).toBeLessThanOrEqual(2);
    for (const hook of file.hooks) {
      expect(["analyze-live", "analyze-live-on-save"]).toContain(hook.name);
      expect(hook.action).toEqual({ type: "command", command: "pnpm demo:live" });
      expect(hook.timeout).toBe(120);
      expect(TRIGGERS).toContain(hook.trigger);
    }
    expect(new Set(file.hooks.map((h) => h.name)).size).toBe(file.hooks.length);
    const save = file.hooks.find((h) => h.name === "analyze-live-on-save");
    if (save !== undefined) {
      expect(save.trigger).toBe("PostFileSave");
      expect(save.matcher).toBe("^haunts/manor/.*\\.(js|jsx|ts|tsx|mjs|mts)$");
    }
  });

  it("every hook file of the repository uses command actions only", () => {
    for (const name of ["verify-on-stop.json", "analyze-live.json", "typecheck-on-save.json"]) {
      for (const hook of readHooks(name).hooks) expect(hook.action.type, `${name}: ${hook.name}`).toBe("command");
    }
  });
});

describe("6.5 observation before citation", () => {
  const rows = readLogRows();
  for (const name of ["verify-on-stop", "analyze-live"]) {
    it(`${name} is cited in README.md or docs/write-up.md only with an observation row`, () => {
      const cited = ["README.md", join("docs", "write-up.md")].some((file) => existsSync(join(REPO, file)) && readFileSync(join(REPO, file), "utf8").includes(name));
      const observed = rows.some((row) => row.includes(`hook observation ${name}`));
      if (cited) expect(observed, `${name} is cited without a row`).toBe(true);
      else expect(true).toBe(true);
    });
  }

  it("the observation row of verify-on-stop names the trigger of the file, or says not observed", () => {
    const row = rows.find((r) => r.includes("hook observation verify-on-stop"));
    if (row === undefined) return; // task 2 appends it
    const trigger = (readHooks("verify-on-stop.json").hooks[0] as Hook).trigger;
    expect(row.includes("not observed") || row.includes(trigger), row).toBe(true);
  });

  it("there is at most one observation row for each hook file of the spec", () => {
    for (const name of ["verify-on-stop", "analyze-live"]) {
      expect(rows.filter((r) => r.includes(`kiro-integration, task`) && r.includes(`hook observation ${name}`)).length).toBeLessThanOrEqual(1);
    }
  });
});

describe("6.7 scripts/demo-live.ts", () => {
  it("names the one command and the one output verbatim", () => {
    const source = readFileSync(join(REPO, "scripts", "demo-live.ts"), "utf8");
    expect(source.split("analyze haunts/manor --out public/demo/live.json")).toHaveLength(2);
    expect([...source.matchAll(/--out\s+(\S+)/g)].map((m) => m[1]?.replace(/["';,)]+$/, ""))).toEqual(["public/demo/live.json"]);
  });
});

describe(".kiro/hooks/README.md follows the revision of 2026-11-16", () => {
  const readme = readFileSync(join(REPO, ".kiro", "hooks", "README.md"), "utf8");

  it.each(["Crew", "worktree", "integrator", "1.4.62", "kiro/FORMAT.md", "HAUNTMAP_FAST=1", "screenshot", ".png", "cmp public"])("no longer mentions %s", (text) => {
    expect(readme.toLowerCase()).not.toContain(text.toLowerCase());
  });

  it("names pnpm verify:fast, settles the trigger names and keeps its sections", () => {
    expect(readme).toContain("pnpm verify:fast");
    expect(readme).toContain("Stop");
    expect(readme).toContain("PostFileSave");
    expect(readme).toContain("revision-2026-11-16");
    for (const heading of ["## Fields marked *verify*", "## Observation before citation"]) expect(readme).toContain(heading);
    for (const file of ["verify-on-stop.json", "typecheck-on-save.json", "analyze-live.json"]) expect(readme).toContain(file);
    expect(readme).toContain("transcript excerpt");
  });
});
