import { describe, expect, it } from "vitest";
import { DEFAULT_ANALYSIS_OPTIONS } from "../../src/contracts/options";

describe("DEFAULT_ANALYSIS_OPTIONS", () => {
  it("has the documented defaults", () => {
    expect(DEFAULT_ANALYSIS_OPTIONS).toEqual({
      preset: "static-value",
      includeExtensions: [".js", ".jsx", ".ts", ".tsx", ".mjs", ".mts"],
      excludeDirectories: [".git", "node_modules", "dist", "build", "out", ".next", "coverage"],
      excludeFilePatterns: [".env", ".env.*", "*.pem", "*.key", "id_rsa*"],
      maxFiles: 1000,
      maxFileBytes: 1048576,
      maxTotalBytes: 26214400,
      jsToTsFallback: true,
    });
  });
});