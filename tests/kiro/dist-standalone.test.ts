import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { REPO } from "./appPath";
import { RpcProcess } from "./rpc";

// Requirement 1.2: dist/ alone, copied to a folder under the system temp directory (outside the
// repository, so that no parent package.json or node_modules is found), still starts and answers
// tools/list with the four tool names.

let dir = "";
let server: RpcProcess | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
  dir = "";
});

describe("dist-standalone", () => {
  it("runs from a copy of dist/ with no package.json and no node_modules", async () => {
    dir = mkdtempSync(join(tmpdir(), "hauntmap-dist-"));
    cpSync(join(REPO, "packages", "hauntmap-mcp", "dist"), dir, { recursive: true });
    server = new RpcProcess(join(dir, "index.js"), dir);
    await server.initialize();
    const listed = await server.request("tools/list");
    const names = (listed.result?.tools as { name: string }[]).map((tool) => tool.name);
    expect(names).toEqual(["analyze", "cycles", "who_imports", "compare"]);
  });
});
