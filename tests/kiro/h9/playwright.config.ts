import { defineConfig } from "@playwright/test";

// The H9 app run (docs/demo/h9-session-script.md). It is outside the projects of the root
// playwright.config.ts, because it needs the public/demo/live.json that the analyze-live hook wrote
// during the recorded Kiro session. The person starts the app first: `pnpm dev --port 4375 --strictPort`.
// Run: pnpm exec playwright test --config tests/kiro/h9/playwright.config.ts
const APP_PORT = Number(process.env.HAUNTMAP_H9_PORT ?? 4375);

export default defineConfig({
  testDir: ".",
  testMatch: ["h9-app.spec.ts"],
  outputDir: "../../../.hauntmap/h9-output",
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  reporter: [["list"]],
  use: {
    browserName: "chromium",
    headless: true,
    baseURL: `http://localhost:${APP_PORT}`,
    viewport: { width: 1280, height: 720 },
    video: { mode: "on", size: { width: 1280, height: 720 } },
    launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] },
  },
});
