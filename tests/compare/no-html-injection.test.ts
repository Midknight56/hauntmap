import { describe, expect, it } from "vitest";
import { compareSources } from "./sourceFiles";

// 7.7: every label, path, specifier, hash and message is a React text node.
const FORBIDDEN = /dangerouslySetInnerHTML|\binnerHTML\b|\bouterHTML\b|insertAdjacentHTML|document\.write/;

describe("no HTML injection in the comparison (7.7)", () => {
  it("no file of src/features/compare, src/scene/compare or compare.ts builds markup from strings", () => {
    const files = compareSources();
    expect(files.length).toBeGreaterThan(5);
    expect(files.filter(([, text]) => FORBIDDEN.test(text)).map(([path]) => path)).toEqual([]);
  });

  it("the detector finds each form (a check of the check)", () => {
    for (const bad of ["<div dangerouslySetInnerHTML={{ __html: x }} />", "el.innerHTML = s;", "el.insertAdjacentHTML('beforeend', s)", "document.write(s)"]) {
      expect(FORBIDDEN.test(bad)).toBe(true);
    }
    expect(FORBIDDEN.test("<p>{label}</p>")).toBe(false);
  });
});