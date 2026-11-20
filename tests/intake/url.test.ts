import { describe, expect, it } from "vitest";
import { parseGithubUrl } from "../../src/features/github/url";
import { SUBFOLDER_REJECTED, URL_FORMAT } from "../../src/features/github/messages";

// 7.2: the accepted forms and the two rejections. A rejection makes no request (the function is pure).

describe("parseGithubUrl accepts (7.2)", () => {
  it.each([
    ["https://github.com/octo/cat", "octo", "cat", null],
    ["https://github.com/octo/cat/", "octo", "cat", null],
    ["https://github.com/octo/cat.git", "octo", "cat", null],
    ["https://github.com/octo/cat.git/", "octo", "cat", null],
    ["  https://github.com/octo/cat  ", "octo", "cat", null],
    ["https://github.com/octo/cat/tree/main", "octo", "cat", "main"],
    ["https://github.com/octo/cat/tree/v1.2.3/", "octo", "cat", "v1.2.3"],
    ["https://github.com/a_b.c-d/e_f.g-h/tree/rel_1-2", "a_b.c-d", "e_f.g-h", "rel_1-2"],
  ])("%s", (input, owner, repo, ref) => {
    expect(parseGithubUrl(input)).toEqual({ ok: true, owner, repo, ref });
  });
});

describe("parseGithubUrl rejects (7.2)", () => {
  it.each([
    ["https://github.com/octo/cat/tree/main/src", true],
    ["https://github.com/octo/cat/tree/feature/x", true],
    ["https://github.com/octo/cat/tree/a/b/c/", true],
    ["https://github.com/octo/cat/blob/main/x.ts", false],
    ["https://github.com/octo/cat/issues", false],
    ["https://github.com/octo/cat/tree", false],
  ])("a subfolder or other path: %s (ref field shown: %s)", (input, showRefField) => {
    expect(parseGithubUrl(input)).toEqual({ ok: false, message: SUBFOLDER_REJECTED, showRefField });
  });

  it.each([
    "",
    "   ",
    "octo/cat",
    "github.com/octo/cat",
    "http://github.com/octo/cat",
    "https://gitlab.com/octo/cat",
    "https://www.github.com/octo/cat",
    "https://github.com",
    "https://github.com/",
    "https://github.com/octo",
    "https://github.com/octo/",
    "https://github.com//cat",
    "https://github.com/octo/cat//",
    "https://github.com/octo/cat?x=1",
    "https://github.com/octo/cat#top",
    "https://github.com/octo/ca t",
    "https://github.com/octo/.git",
    "https://github.com/octo/cat/tree/a%20b",
    "https://github.com/../cat",
    "https://github.com/octo/..",
    "https://github.com/octo/cat/tree/..",
  ])("any other string: %j", (input) => {
    expect(parseGithubUrl(input)).toEqual({ ok: false, message: URL_FORMAT, showRefField: false });
  });

  it("keeps the repository name when the path continues after a .git name", () => {
    expect(parseGithubUrl("https://github.com/octo/cat.git/tree/main")).toEqual({ ok: true, owner: "octo", repo: "cat.git", ref: "main" });
  });
});
