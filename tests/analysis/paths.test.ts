import { describe, expect, it } from "vitest";
import { findCaseGroups, matchesFilePattern, normalizePath } from "../../src/analysis/parser/paths";

describe("normalizePath (requirement 1.5)", () => {
  it("turns backslashes into forward slashes", () => {
    expect(normalizePath("src\\orders\\checkout.ts")).toBe("src/orders/checkout.ts");
  });

  it("removes a leading ./ , repeated ./ and empty or dot segments", () => {
    expect(normalizePath("./a.ts")).toBe("a.ts");
    expect(normalizePath("././a.ts")).toBe("a.ts");
    expect(normalizePath(".//src//./b.ts")).toBe("src/b.ts");
  });

  it("removes a leading slash so the path is relative to the root", () => {
    expect(normalizePath("/src/a.ts")).toBe("src/a.ts");
  });

  it("keeps dot files and the case of every letter", () => {
    expect(normalizePath("./.env.local")).toBe(".env.local");
    expect(normalizePath("Src/Util.ts")).toBe("Src/Util.ts");
  });
});

describe("matchesFilePattern (requirement 1.2)", () => {
  it("matches exact names and the star wildcard against a file name", () => {
    expect(matchesFilePattern(".env", ".env")).toBe(true);
    expect(matchesFilePattern(".env.local", ".env.*")).toBe(true);
    expect(matchesFilePattern("server.pem", "*.pem")).toBe(true);
    expect(matchesFilePattern("id_rsa.pub", "id_rsa*")).toBe(true);
    expect(matchesFilePattern("id_rsa", "id_rsa*")).toBe(true);
  });

  it("does not match other names, and treats regex characters literally", () => {
    expect(matchesFilePattern("env.ts", ".env")).toBe(false);
    expect(matchesFilePattern("envXlocal", ".env.*")).toBe(false);
    expect(matchesFilePattern("a-pem", "*.pem")).toBe(false);
    expect(matchesFilePattern("keyfile.ts", "*.key")).toBe(false);
  });
});

describe("findCaseGroups (requirement 1.6)", () => {
  it("groups paths that differ only in letter case, each group sorted", () => {
    expect(findCaseGroups(["util.ts", "a.ts", "Util.ts", "b/X.ts", "b/x.ts", "b/x.TS"])).toEqual([
      ["Util.ts", "util.ts"],
      ["b/X.ts", "b/x.TS", "b/x.ts"],
    ]);
  });

  it("returns nothing when every path differs in more than case", () => {
    expect(findCaseGroups(["a.ts", "b.ts", "a/b.ts"])).toEqual([]);
  });
});