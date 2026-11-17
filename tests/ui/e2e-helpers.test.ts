import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Page } from "@playwright/test";
import { expected, shot } from "../e2e/helpers";

const HERE = dirname(fileURLToPath(import.meta.url));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("tests/e2e/helpers.ts (the parts that need no browser)", () => {
  it("expected() maps the wing keys of expected.json to wing paths", () => {
    const manor = expected();
    expect(manor.wings).toEqual({
      "src/catalog": 8,
      "src/config": 4,
      "src/notifications": 5,
      "src/orders": 9,
      "src/payments": 7,
      "src/shared": 7,
    });
    expect(manor.modules).toHaveLength(40);
    expect(manor.imports).toHaveLength(72);
    expect(manor.cycles["static-value"]).toHaveLength(1);
  });

  it("shot() writes nothing unless HAUNTMAP_SHOTS is 1", async () => {
    const screenshot = vi.fn(async () => Buffer.alloc(0));
    const page = { screenshot } as unknown as Page;
    vi.stubEnv("HAUNTMAP_SHOTS", "");
    await shot(page, "docs/acceptance/img/never.png");
    expect(screenshot).not.toHaveBeenCalled();
    vi.stubEnv("HAUNTMAP_SHOTS", "1");
    await shot(page, "docs/acceptance/img/yes.png");
    expect(screenshot).toHaveBeenCalledTimes(1);
    expect(screenshot).toHaveBeenCalledWith({ path: "docs/acceptance/img/yes.png" });
  });

  it("imports nothing from src/scene", () => {
    const text = readFileSync(join(HERE, "..", "e2e", "helpers.ts"), "utf8");
    expect(text).not.toMatch(/from\s+["'][^"']*src\/scene/);
    expect(text).not.toMatch(/from\s+["'][^"']*\.\.\/\.\.\/src\/scene/);
  });
});
