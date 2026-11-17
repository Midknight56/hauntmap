import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules/**", "dist/**", "coverage/**", "public/**", "tests/fixtures/**/*.ts", "tests/fixtures/**/*.tsx", "tests/fixtures/**/*.js", "tests/fixtures/**/*.jsx", "tests/fixtures/**/*.mjs", "tests/fixtures/**/*.mts"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);