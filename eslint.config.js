import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules/**", "dist/**", "packages/*/dist/**", "haunts/**", "coverage/**", "public/**", "tests/fixtures/**/*.ts", "tests/fixtures/**/*.tsx", "tests/fixtures/**/*.js", "tests/fixtures/**/*.jsx", "tests/fixtures/**/*.mjs", "tests/fixtures/**/*.mts", "dist-devhook/**", "playwright-report/**", "test-results/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);