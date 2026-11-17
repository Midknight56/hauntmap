import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractImports } from "../../src/analysis/parser/extract";
import {
  buildModuleIndex,
  describeUnresolved,
  isValidPackageName,
  resolveSpecifier,
} from "../../src/analysis/parser/resolve";
import { FIXTURES_ROOT, loadFixtureFiles, readExpected } from "../fixtures/load";

interface ExpectedImport {
  from: string;
  specifier: string;
  line: number;
  column: number;
  to: string | null;
  resolution: string;
  reason?: string;
}

const FIXTURES = ["resolve-order", "js-to-ts", "absent", "alias", "external", "case", "same-names"];

describe("resolveSpecifier against the fixtures' expected.json", () => {
  for (const name of FIXTURES) {
    it(`${name}: to, resolution and reason of every import`, () => {
      const dir = join(FIXTURES_ROOT, name);
      const files = loadFixtureFiles(dir);
      const index = buildModuleIndex(files.map((f) => f.path));
      const expected = (readExpected(dir) as unknown as { imports: ExpectedImport[] }).imports;
      const actual: ExpectedImport[] = [];
      for (const file of files) {
        for (const found of extractImports(file.path, file.text).imports) {
          const result = resolveSpecifier(file.path, found.specifier, index);
          actual.push({
            from: file.path,
            specifier: found.specifier,
            line: found.line,
            column: found.column,
            to: result.to,
            resolution: result.resolution,
            ...("reason" in result ? { reason: result.reason } : {}),
          });
        }
      }
      const pick = (items: ExpectedImport[]) =>
        items
          .map(({ from, specifier, to, resolution, reason }) => ({ from, specifier, to, resolution, ...(reason === undefined ? {} : { reason }) }))
          .sort((a, b) => (a.from + a.specifier < b.from + b.specifier ? -1 : 1));
      expect(pick(actual)).toEqual(pick(expected));
    });
  }
});

const resolveIn = (ids: string[], from: string, specifier: string) =>
  resolveSpecifier(from, specifier, buildModuleIndex(ids));

describe("requirement 3.1: candidate order for a relative specifier", () => {
  it("takes the exact file before every suffix", () => {
    expect(resolveIn(["a.ts", "b", "b.ts"], "a.ts", "./b")).toEqual({ resolution: "local", to: "b" });
  });

  it("tries the suffixes .ts, .tsx, .mts, .js, .jsx, .mjs in that order", () => {
    const order = ["b.ts", "b.tsx", "b.mts", "b.js", "b.jsx", "b.mjs"];
    for (let i = 0; i < order.length; i += 1) {
      const present = order.slice(i);
      expect(resolveIn(["a.ts", ...present], "a.ts", "./b"), present.join(",")).toEqual({ resolution: "local", to: order[i] });
    }
  });

  it("tries the suffixes before a directory index", () => {
    expect(resolveIn(["a.ts", "b.js", "b/index.ts"], "a.ts", "./b")).toEqual({ resolution: "local", to: "b.js" });
  });

  it("tries index.ts, index.tsx, index.js, index.jsx in a directory of that name", () => {
    const order = ["b/index.ts", "b/index.tsx", "b/index.js", "b/index.jsx"];
    for (let i = 0; i < order.length; i += 1) {
      const present = order.slice(i);
      expect(resolveIn(["a.ts", ...present], "a.ts", "./b"), present.join(",")).toEqual({ resolution: "local", to: order[i] });
    }
  });

  it("does not try index.mts or index.mjs", () => {
    expect(resolveIn(["a.ts", "b/index.mts", "b/index.mjs"], "a.ts", "./b")).toMatchObject({ resolution: "unresolved", reason: "absent-file" });
  });

  it("resolves ./ and ../ against the directory of the importing module and normalizes the target", () => {
    const ids = ["src/a/x.ts", "src/b/y.ts", "src/z.ts", "root.ts"];
    expect(resolveIn(ids, "src/a/x.ts", "../b/y")).toMatchObject({ to: "src/b/y.ts" });
    expect(resolveIn(ids, "src/a/x.ts", "../../root")).toMatchObject({ to: "root.ts" });
    expect(resolveIn(ids, "src/a/x.ts", "./../z")).toMatchObject({ to: "src/z.ts" });
    expect(resolveIn(ids, "src/a/x.ts", ".")).toMatchObject({ resolution: "unresolved", reason: "absent-file" });
  });

  it("resolves . and .. to a directory index", () => {
    const ids = ["src/index.ts", "src/a/x.ts"];
    expect(resolveIn(ids, "src/a/x.ts", "..")).toMatchObject({ to: "src/index.ts" });
    expect(resolveIn(["a/index.ts", "a/x.ts"], "a/x.ts", ".")).toMatchObject({ to: "a/index.ts" });
  });

  it("resolves the root itself only to a root index file, never to a file named like a suffix", () => {
    expect(resolveIn([".ts", "a.ts"], "a.ts", ".")).toMatchObject({ resolution: "unresolved", reason: "absent-file" });
    expect(resolveIn(["index.ts", "d/a.ts"], "d/a.ts", "..")).toMatchObject({ to: "index.ts" });
  });

  it("stays inside the root: a path above the root is absent", () => {
    expect(resolveIn(["a.ts", "b.ts"], "a.ts", "../b")).toMatchObject({ resolution: "unresolved", reason: "absent-file" });
    expect(resolveIn(["a.ts", "b.ts"], "a.ts", "/b")).toMatchObject({ resolution: "unresolved", reason: "absent-file" });
  });

  it("matches paths case sensitively", () => {
    expect(resolveIn(["a.ts", "Util.ts"], "a.ts", "./util")).toMatchObject({ resolution: "unresolved", reason: "absent-file" });
    expect(resolveIn(["a.ts", "Util.ts"], "a.ts", "./Util")).toMatchObject({ resolution: "local", to: "Util.ts" });
  });
});

describe("requirement 3.2: the JS to TS fallback", () => {
  it("maps ./x.js to x.ts then x.tsx and ./x.mjs to x.mts when the exact file is absent", () => {
    expect(resolveIn(["a.ts", "b.ts", "b.tsx"], "a.ts", "./b.js")).toMatchObject({ to: "b.ts" });
    expect(resolveIn(["a.ts", "b.tsx"], "a.ts", "./b.js")).toMatchObject({ to: "b.tsx" });
    expect(resolveIn(["a.ts", "b.mts"], "a.ts", "./b.mjs")).toMatchObject({ to: "b.mts" });
  });

  it("uses the exact file, not the fallback, when it exists", () => {
    expect(resolveIn(["a.ts", "b.js", "b.ts"], "a.ts", "./b.js")).toMatchObject({ to: "b.js" });
    expect(resolveIn(["a.ts", "b.mjs", "b.mts"], "a.ts", "./b.mjs")).toMatchObject({ to: "b.mjs" });
  });

  it("does not map .mjs to .ts, .js to .mts or .jsx to .tsx", () => {
    expect(resolveIn(["a.ts", "b.ts"], "a.ts", "./b.mjs")).toMatchObject({ reason: "absent-file" });
    expect(resolveIn(["a.ts", "b.mts"], "a.ts", "./b.js")).toMatchObject({ reason: "absent-file" });
    expect(resolveIn(["a.ts", "b.tsx"], "a.ts", "./b.jsx")).toMatchObject({ reason: "absent-file" });
  });
});

describe("requirement 3.3: absent and ambiguous", () => {
  it("records unresolved with reason absent-file and no target", () => {
    expect(resolveIn(["a.ts"], "a.ts", "./missing")).toEqual({ resolution: "unresolved", to: null, reason: "absent-file" });
  });

  it("records ambiguous-candidate when the step that finds a candidate matches paths that differ only in case", () => {
    expect(resolveIn(["a.ts", "Util.ts", "util.ts"], "a.ts", "./util")).toEqual({
      resolution: "unresolved",
      to: null,
      reason: "ambiguous-candidate",
    });
  });

  it("is ambiguous even when one of the paths has the exact case, and for exact files and index files", () => {
    expect(resolveIn(["a.ts", "b.TS", "b.ts"], "a.ts", "./b")).toMatchObject({ reason: "ambiguous-candidate" });
    expect(resolveIn(["a.ts", "X.js", "x.js"], "a.ts", "./x.js")).toMatchObject({ reason: "ambiguous-candidate" });
    expect(resolveIn(["a.ts", "d/Index.ts", "d/index.ts"], "a.ts", "./d")).toMatchObject({ reason: "ambiguous-candidate" });
  });

  it("is not ambiguous when the two case variants are different steps", () => {
    expect(resolveIn(["a.ts", "u.ts", "u.TSX"], "a.ts", "./u")).toMatchObject({ resolution: "local", to: "u.ts" });
  });
});

describe("requirements 3.4 and 3.5: bare specifiers", () => {
  it("records external with a null target for a valid package name, scoped or with a subpath", () => {
    for (const specifier of ["react", "@scope/pkg", "@scope/pkg/sub", "lodash/fp", "left-pad", "pkg.js", "JSONStream"]) {
      expect(resolveIn(["a.ts"], "a.ts", specifier), specifier).toEqual({ resolution: "external", to: null });
    }
  });

  it("never turns an external package into a local module, even when a local file has that name", () => {
    expect(resolveIn(["a.ts", "react.ts", "react/index.ts"], "a.ts", "react")).toEqual({ resolution: "external", to: null });
  });

  it("records alias-not-configured for a bare specifier that is not a valid package name", () => {
    for (const specifier of ["@/lib/format", "~/config/env", "#internal/x", "@scope", "node:fs", "http://example.com/x.js", "Bad Name", "_private"]) {
      expect(resolveIn(["a.ts"], "a.ts", specifier), specifier).toEqual({
        resolution: "unresolved",
        to: null,
        reason: "alias-not-configured",
      });
    }
  });

  it("validates package names", () => {
    expect(isValidPackageName("react")).toBe(true);
    expect(isValidPackageName("@a/b/c/d")).toBe(true);
    expect(isValidPackageName("a//b")).toBe(false);
    expect(isValidPackageName("@/x")).toBe(false);
    expect(isValidPackageName(".hidden")).toBe(false);
    expect(isValidPackageName("")).toBe(false);
  });
});

describe("requirement 3.6: the message of an unresolved import", () => {
  it("names the specifier and the reason in plain words", () => {
    expect(describeUnresolved("absent-file", "./missing")).toContain("./missing");
    expect(describeUnresolved("alias-not-configured", "@/lib/format")).toContain("@/lib/format");
    expect(describeUnresolved("ambiguous-candidate", "./util")).toContain("./util");
    expect(describeUnresolved("absent-file", "./m")).not.toEqual(describeUnresolved("alias-not-configured", "./m"));
  });
});