import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeTool, createContext, cyclesTool } from "../../packages/hauntmap-mcp/src/tools";
import { loadLoaderRoot, materialize } from "./materialize";

// Requirement 3.7: the analyzed root is never executed. loader-root.json holds postinstall.js,
// which writes a MARKER file beside itself if anything runs it.

const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("no execution of analyzed source", () => {
  it("analyze and cycles read postinstall.js as text and leave no MARKER", async () => {
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "hauntmap-noexec-")));
    temporary.push(workspace);
    mkdirSync(join(workspace, "root"));
    materialize(loadLoaderRoot(), join(workspace, "root"));
    expect(readFileSync(join(workspace, "root", "postinstall.js"), "utf8")).toContain("MARKER");
    const ctx = createContext(workspace);
    const analyzed = await analyzeTool(ctx, { root: "root" });
    expect(analyzed.ok).toBe(true);
    if (analyzed.ok) expect(analyzed.value.modules.map((m) => m.id)).toContain("postinstall.js");
    expect((await cyclesTool(ctx, { root: "root" })).ok).toBe(true);
    expect(existsSync(join(workspace, "root", "MARKER"))).toBe(false);
    expect(existsSync(join(workspace, "MARKER"))).toBe(false);
  });
});
