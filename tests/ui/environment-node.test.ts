import { describe, expect, it } from "vitest";

describe("node project", () => {
  it("runs *.test.ts files without a DOM", () => {
    expect(typeof document).toBe("undefined");
    expect(typeof window).toBe("undefined");
  });
});
