import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO } from "./appPath";

// Requirements 7.1 and 7.4: .kiro/steering/refactoring.md.

const text = readFileSync(join(REPO, ".kiro", "steering", "refactoring.md"), "utf8");
const lines = text.replace(/\n$/, "").split("\n");

describe("refactoring.md", () => {
  it("7.1 starts with the front matter inclusion: always and is under 60 lines", () => {
    expect(lines[0]).toBe("---");
    expect(lines[1]).toBe("inclusion: always");
    expect(lines[2]).toBe("---");
    expect(lines.length).toBeLessThan(60);
  });

  it("7.1 names the four tools, the server and the before and after rules", () => {
    for (const needle of ["`hauntmap`", "`analyze`", "`cycles`", "`who_imports`", "`compare`", "cycles(root, \"static-value\")", "compare(rootBefore, rootAfter)", "public/demo/manor/before", ".hauntmap/before/<name>", "compare was not run", "Removed relations", "Added relations", "pnpm demo:reset"]) {
      expect(text, needle).toContain(needle);
    }
  });

  it("7.4 states no expected result of the session", () => {
    for (const forbidden of ["receipt.ts", "checkout.ts", "charge.ts", "exactly one removed", "1 → 0"]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });
});
