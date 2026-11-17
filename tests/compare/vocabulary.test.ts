import { describe, expect, it } from "vitest";
import { compareSources } from "./sourceFiles";

// 5.9: changes are described with removed, added, changed, imports and only in; never with these words.
const WORDS = /\b(?:broken|breaks|fails|dead|unused|unreachable|safe|risk|rename detected)\b/i;

describe("vocabulary of the comparison (5.9)", () => {
  it("no file of src/features/compare, src/scene/compare or compare.ts uses a forbidden word", () => {
    const hits = compareSources().flatMap(([path, text]) =>
      text.split("\n").flatMap((line, i) => (WORDS.test(line) ? [`${path}:${i + 1}: ${line.trim()}`] : [])),
    );
    expect(hits).toEqual([]);
  });

  it("the detector matches whole words, case-insensitive (a check of the check)", () => {
    expect(WORDS.test("This import is Dead code")).toBe(true);
    expect(WORDS.test("a RISK")).toBe(true);
    expect(WORDS.test("Rename detected")).toBe(true);
    expect(WORDS.test("deadline, safely, failsafe, unsafety")).toBe(false);
  });
});