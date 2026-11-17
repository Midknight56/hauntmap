import { defineConfig } from "@playwright/test";

// Two projects, one fresh browser context per test, headless Chromium at 1,280 x 720.
// `prod` runs against the release build (no development hook); `dev` runs against the build made
// with `--mode devhook`, where `window.__hauntmap` exists. The preview ports are 4173 and 4174;
// set HAUNTMAP_PROD_PORT and HAUNTMAP_DEV_PORT when another server on this PC uses them.
const PROD_SPECS = ["**/landing.spec.ts", "**/keyboard-journey.spec.ts", "**/reduced-motion.spec.ts"];
const PROD_PORT = Number(process.env.HAUNTMAP_PROD_PORT ?? 4173);
const DEV_PORT = Number(process.env.HAUNTMAP_DEV_PORT ?? 4174);

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
      testMatch: ["**/*.spec.ts"],
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
