import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO } from "./appPath";

// Requirements of .kiro/specs/kiro-extensions: the power, the custom agent, the hook proof and
// the README claims. Reads files only; it starts no Kiro session.

function text(...parts: string[]): string {
  return readFileSync(join(REPO, ...parts), "utf8");
}
function json<T>(...parts: string[]): T {
  return JSON.parse(text(...parts)) as T;
}

/** The tool names that packages/hauntmap-mcp/src/index.ts registers. */
function serverTools(): string[] {
  const source = text("packages", "hauntmap-mcp", "src", "index.ts");
  const block = source.slice(source.indexOf("const TOOLS"), source.indexOf("export function toolList"));
  return [...block.matchAll(/^ {4}name: "(\w+)",$/gm)].map((match) => match[1] as string);
}

const POWER = ["power", "hauntmap"];
const WRITE_OR_SHELL = /^(write|fs_write|fs_append|edit|str_replace|shell|bash|execute_bash|execute_pwsh|execute|delete|code|knowledge|@builtin|\*|@\*)$/i;

describe("the MCP server (the source of tool names)", () => {
  it("registers analyze, cycles, who_imports and compare", () => {
    expect(serverTools()).toEqual(["analyze", "cycles", "who_imports", "compare"]);
  });
});

describe("1 the power in power/hauntmap", () => {
  it("1.1 has a plugin.json with the required fields", () => {
    const plugin = json<Record<string, unknown>>(...POWER, "plugin.json");
    expect(plugin.$schema).toBe("https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
    expect(plugin.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(plugin.name).toBe("hauntmap");
    expect(plugin.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(typeof plugin.description).toBe("string");
    expect(typeof (plugin.author as { name?: unknown }).name).toBe("string");
    const keywords = plugin.keywords as string[];
    expect(Array.isArray(keywords)).toBe(true);
    expect(keywords.length).toBeGreaterThanOrEqual(4);
    for (const word of keywords) expect(word.trim()).not.toBe("");
  });

  it("1.2 has an mcp.json that starts the hauntmap-mcp server with no path of this machine", () => {
    const mcp = json<{ mcpServers: Record<string, { type?: string; command: string; args?: string[] }> }>(...POWER, "mcp.json");
    const servers = Object.values(mcp.mcpServers);
    expect(servers.length).toBeGreaterThanOrEqual(1);
    const raw = text(...POWER, "mcp.json");
    // The installed power is a copy that Kiro starts in its own folder, so the server file and the
    // workspace come from two variables that the README names (observed in task 2).
    expect(raw).toContain("${HAUNTMAP_MCP_DIST}");
    expect(raw).toContain("${HAUNTMAP_WORKSPACE}");
    expect(text(...POWER, "README.md")).toContain("packages/hauntmap-mcp/dist/index.js");
    expect(existsSync(join(REPO, "packages", "hauntmap-mcp", "src", "index.ts"))).toBe(true);
    expect(raw).not.toMatch(/(^|[^A-Za-z])[A-Za-z]:[\\/]/); // a drive path such as D:/ or C:\, not the s:// of https://
    expect(raw).not.toMatch(/adria/i);
    for (const server of servers) expect(typeof server.command).toBe("string");
  });

  it("1.3 has a skill that holds the refactor rule and names only real tools", () => {
    const skills = join(REPO, ...POWER, "skills");
    const folders = readdirSync(skills, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    expect(folders.length).toBeGreaterThanOrEqual(1);
    const real = serverTools();
    for (const folder of folders) {
      const body = text(...POWER, "skills", folder.name, "SKILL.md");
      const front = /^---\n([\s\S]*?)\n---\n/.exec(body);
      expect(front, `${folder.name} front matter`).not.toBeNull();
      expect(front?.[1]).toMatch(/^name: ./m);
      expect(front?.[1]).toMatch(/^description: ./m);
      expect(body).toContain("cycles");
      expect(body).toContain("compare");
      expect(body).toMatch(/before/i);
      expect(body).toMatch(/not a (claim|correctness)/i);
      for (const match of body.matchAll(/`(analyze|cycles|who_imports|compare|[a-z_]+)\(/g)) {
        expect(real, `tool ${match[1]} in ${folder.name}`).toContain(match[1]);
      }
    }
  });

  it("1.4 has a README with the install command, the needs and the uninstall command", () => {
    const readme = text(...POWER, "README.md");
    expect(readme).toContain("kiro-cli powers install");
    expect(readme).toContain("kiro-cli powers uninstall hauntmap");
    expect(readme).toContain("pnpm install");
    expect(readme).toContain("pnpm build:mcp");
    expect(readme).toMatch(/Node/);
  });

  it("1.5 has saved proof of one headless session and of the uninstall", () => {
    const dir = join(REPO, "docs", "acceptance", "power-session");
    expect(existsSync(join(dir, "README.md"))).toBe(true);
    const proof = text("docs", "acceptance", "power-session", "README.md");
    expect(proof).toContain("kiro-cli powers install");
    expect(proof).toContain("kiro-cli powers uninstall hauntmap");
    expect(proof).toContain("--no-interactive");
    expect(proof).toMatch(/## Tool calls seen/);
    expect(existsSync(join(dir, "session-output.txt"))).toBe(true);
  });
});

describe("2 the custom agent haunt-reviewer", () => {
  const path = [".kiro", "agents", "haunt-reviewer.json"];
  interface Agent {
    name: string;
    description: string;
    tools: string[];
    prompt: string;
    includeMcpJson?: boolean;
    permissions?: { rules?: { capability: string; effect: string }[] };
    allowedTools?: string[];
    toolsSettings?: unknown;
  }

  it("2.1 parses and has a name, a description and a prompt", () => {
    const agent = json<Agent>(...path);
    expect(agent.name).toBe("haunt-reviewer");
    expect(agent.description.length).toBeGreaterThan(10);
    expect(agent.prompt.length).toBeGreaterThan(50);
  });

  it("2.2 lists file reads and real HauntMap tools only, with no write or shell tool", () => {
    const agent = json<Agent>(...path);
    const real = serverTools().map((name) => `@hauntmap/${name}`);
    expect(agent.tools.length).toBeGreaterThanOrEqual(2);
    expect(agent.tools).toContain("read");
    for (const tool of real) expect(agent.tools, tool).toContain(tool);
    for (const tool of agent.tools) {
      expect(tool, tool).not.toMatch(WRITE_OR_SHELL);
      expect(["read", ...real], tool).toContain(tool);
    }
    for (const rule of agent.permissions?.rules ?? []) {
      expect(["shell", "write", "edit"], `rule ${rule.capability}`).not.toContain(rule.capability);
    }
    expect(agent.allowedTools).toBeUndefined();
    expect(agent.toolsSettings).toBeUndefined();
  });

  it("2.3 tells the agent to call cycles on both folders, then compare, and to report the import line", () => {
    const { prompt } = json<Agent>(...path);
    expect(prompt).toContain("cycles");
    expect(prompt).toContain("compare");
    expect(prompt).toMatch(/before/);
    expect(prompt).toMatch(/after/);
    expect(prompt).toMatch(/import line/);
    expect(prompt.indexOf("cycles")).toBeLessThan(prompt.indexOf("compare"));
    expect(prompt).toMatch(/not a (claim|correctness)/i);
  });

  it("2.5 has saved proof of one headless run that reports the removed relation and loops 1 to 0", () => {
    const dir = ["docs", "acceptance", "haunt-reviewer-session"];
    expect(existsSync(join(REPO, ...dir, "README.md"))).toBe(true);
    const proof = text(...dir, "README.md");
    expect(proof).toContain("kiro-cli agent validate");
    expect(proof).toContain("--agent haunt-reviewer");
    expect(proof).toContain("--no-interactive");
    expect(existsSync(join(REPO, ...dir, "session-output.txt"))).toBe(true);
    const output = text(...dir, "session-output.txt");
    expect(output).toContain("src/notifications/receipt.ts");
    expect(output).toContain("src/orders/checkout.ts");
    expect(output).toMatch(/1\s*(→|->|to)\s*0/);
  });
});

describe("3 the hook proof", () => {
  it("3.1 docs/acceptance/hook-verify-on-stop.md records a headless run in which the hook fired", () => {
    const proof = text("docs", "acceptance", "hook-verify-on-stop.md");
    expect(proof).toMatch(/## Headless observation of 2026-11-\d\d/);
    expect(proof).toContain("--no-interactive");
    expect(proof).toMatch(/Result: (fired|not observed)/);
  });
});

describe("4 the README claims", () => {
  const readme = text("README.md");
  const claimedProof = [...readme.matchAll(/`(docs\/acceptance\/[^`\s]+)`/g)].map((match) => match[1] as string);

  it("4.1 names the power, the agent and the hook proof files, and each file exists", () => {
    for (const file of ["docs/acceptance/power-session/", "docs/acceptance/haunt-reviewer-session/", "docs/acceptance/hook-verify-on-stop.md"]) {
      expect(claimedProof, file).toContain(file);
    }
    for (const file of claimedProof) expect(existsSync(join(REPO, file)), file).toBe(true);
  });

  it("4.2 no longer says Not used for custom agents or powers", () => {
    const agents = /### Custom agents\n([\s\S]*?)\n### /.exec(readme)?.[1] ?? "";
    const powers = /### Kiro powers\n([\s\S]*?)\n## /.exec(readme)?.[1] ?? "";
    expect(agents).toContain("haunt-reviewer");
    expect(powers).toContain("power/hauntmap");
    expect(agents).not.toMatch(/Not used/);
    expect(powers).not.toMatch(/Not used/);
  });

  it("4.3 says that typecheck-on-save was not seen to run in the CLI, or that it was, with a proof file", () => {
    const hooks = /### Agent hooks\n([\s\S]*?)\n### /.exec(readme)?.[1] ?? "";
    expect(hooks).toContain("typecheck-on-save");
    expect(hooks).toMatch(/Kiro IDE/);
  });

  it("4.4 has no dash between words in the new README text", () => {
    for (const heading of ["### Custom agents", "### Kiro powers"]) {
      const start = readme.indexOf(heading);
      const section = readme.slice(start, readme.indexOf("\n#", start + 5));
      expect(section, heading).not.toMatch(/\s[\u2013\u2014-]\s|[\u2013\u2014]/);
    }
  });
});
