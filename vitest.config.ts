import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const exclude = ["**/node_modules/**", "tests/pending/**"];

// Two projects: `node` runs every tests/**/*.test.ts file; `jsdom` runs tests/**/*.test.tsx and the
// DOM-touching tests/ui files named *.dom.test.ts.
export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          include: ["tests/**/*.test.ts"],
          exclude: [...exclude, "tests/**/*.dom.test.ts"],
          testTimeout: 30_000,
          globalSetup: ["tests/kiro/globalSetup.ts"],
        },
      },
      {
        plugins: [react()],
        test: {
          name: "jsdom",
          environment: "jsdom",
          include: ["tests/**/*.test.tsx", "tests/**/*.dom.test.ts"],
          exclude,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
