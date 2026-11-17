import { defineConfig } from "@playwright/test";

// Two projects, one fresh browser context per test, headless Chromium at 1,280 x 720.
// `prod` runs against the release build (no development hook); `dev` runs against the build made
// with `--mode devhook`, where `window.__hauntmap` exists. The preview ports are 4373 and 4374 (other projects on this PC use 4173, 4174, 4273, 4274, 4473 and 4474);
// set HAUNTMAP_PROD_PORT and HAUNTMAP_DEV_PORT when another server on this PC uses them.
const PROD_SPECS = ["**/landing.spec.ts", "**/keyboard-journey.spec.ts", "**/reduced-motion.spec.ts"];
const PROD_PORT = Number(process.env.HAUNTMAP_PROD_PORT ?? 4373);
const DEV_PORT = Number(process.env.HAUNTMAP_DEV_PORT ?? 4374);

const launchOptions = {
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
};

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: true,
  reporter: [["list"]],
  use: {
    browserName: "chromium",
    headless: true,
    viewport: { width: 1280, height: 720 },
    launchOptions,
  },
  projects: [
    {
      name: "prod",
      testMatch: PROD_SPECS,
      use: { baseURL: `http://localhost:${PROD_PORT}` },
    },
    {
      name: "dev",
      // G1 of snapshot-comparison: the dev project also collects tests/compare/e2e/**. Its testDir is `tests`, and the
      // patterns name the two folders so that tests/pending/** is never collected.
      testDir: "tests",
      testMatch: ["**/tests/e2e/**/*.spec.ts", "**/tests/compare/e2e/**/*.spec.ts"],
      testIgnore: PROD_SPECS,
      use: { baseURL: `http://localhost:${DEV_PORT}` },
    },
  ],
  webServer: [
    {
      command: `pnpm preview --port ${PROD_PORT} --strictPort`,
      url: `http://localhost:${PROD_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `pnpm preview --outDir dist-devhook --port ${DEV_PORT} --strictPort`,
      url: `http://localhost:${DEV_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
