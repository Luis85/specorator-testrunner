import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["main.js", "node_modules/", "dist/", "build/", "coverage/", ".claude/"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ["**/*.ts"],
  })),
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.eslint.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      // Port/adapter and Obsidian view methods (`onOpen`, `onClose`, fakes,
      // repositories) implement async interface signatures even when a given
      // implementation has no `await`; requiring one would force behavioral
      // contortions, so this stylistic rule is disabled.
      "@typescript-eslint/require-await": "off",
      // Allow intentionally-unused args/vars when prefixed with `_`.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    // Test files exercise fakes/partial mocks and read JSON as `unknown`;
    // relax the unsafe-* rules that are noisy and low-value in tests.
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },
);
