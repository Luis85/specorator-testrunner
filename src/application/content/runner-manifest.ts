/**
 * The `.testrunner` file/dependency MANIFEST — the contract the plugin asserts
 * and validates against (US-010, US-013). These are plain string lists: policy/
 * contract DATA, not runtime-technology source.
 *
 * The Playwright/Cucumber/Node TEMPLATE SOURCE that materialises these files
 * lives in infrastructure (`infrastructure/runner/templates/runner-templates.ts`,
 * P3-7) so the application layer holds no runtime-tech code. This module keeps
 * the data lists in the application layer because validation services (US-013,
 * UC-020) depend on them as a contract, and depending on a tiny data module is
 * cleaner than routing string arrays through the {@link TemplateWriter} port.
 */

/** Files US-010 asserts the generator produces. */
export const REQUIRED_RUNNER_FILES = [
  "package.json",
  "tsconfig.json",
  "cucumber.mjs",
  "README.md",
] as const;

/**
 * Managed files a test run depends on; checked by validation (US-013). A run
 * needs the config, the TS config tsx reads, the Cucumber support layer, and
 * the demo fixture — README.md is documentation only, so it is excluded.
 */
export const VALIDATED_RUNNER_FILES = [
  "package.json",
  "tsconfig.json",
  "cucumber.mjs",
  "src/support/world.ts",
  "src/support/hooks.ts",
  "src/support/paths.ts",
  "src/fixtures/example.html",
] as const;

/**
 * node_modules markers a run depends on (US-013). The generated scripts invoke
 * `node --import tsx node_modules/@cucumber/cucumber/bin/cucumber.js`, so both
 * the Cucumber CLI entry and the tsx package must resolve; Playwright is probed
 * separately via `npx playwright --version`.
 */
export const REQUIRED_RUNNER_DEPENDENCIES = [
  "node_modules/@cucumber/cucumber/bin/cucumber.js",
  "node_modules/tsx",
] as const;
