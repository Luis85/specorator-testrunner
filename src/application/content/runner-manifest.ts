/**
 * The `.testrunner` file/dependency MANIFEST — the contract the plugin asserts
 * and validates against (US-010, US-013). These are plain string lists: policy/
 * contract DATA, not runtime-technology source.
 *
 * The playwright-bdd/Node TEMPLATE SOURCE that materialises these files
 * lives in infrastructure (`infrastructure/runner/templates/runner-templates.ts`,
 * P3-7) so the application layer holds no runtime-tech code. This module keeps
 * the data lists in the application layer because validation services (US-013,
 * UC-020) depend on them as a contract, and depending on a tiny data module is
 * cleaner than routing string arrays through the {@link TemplateWriter} port.
 */

/** Files US-010 asserts the generator produces (V2: playwright-bdd runtime). */
export const REQUIRED_RUNNER_FILES = [
  "package.json",
  "tsconfig.json",
  "playwright.config.ts",
  "README.md",
] as const;

/**
 * Managed files a test run depends on; checked by validation (US-013). A run
 * needs the Playwright config, the TS config, the shared path utilities, and
 * the demo fixture — README.md is documentation only, so it is excluded.
 * (V2: cucumber World/hooks replaced by playwright-bdd fixtures; entry points
 * are `bddgen` + `playwright test`.)
 */
export const VALIDATED_RUNNER_FILES = [
  "package.json",
  "tsconfig.json",
  "playwright.config.ts",
  "src/support/paths.ts",
  "src/fixtures/example.html",
] as const;

/**
 * node_modules markers a run depends on (US-013). The generated scripts invoke
 * `bddgen` (from `playwright-bdd`) and `playwright test` (from
 * `@playwright/test`), so both packages must resolve. Playwright itself is also
 * probed via `npx playwright --version`.
 */
export const REQUIRED_RUNNER_DEPENDENCIES = [
  "node_modules/playwright-bdd",
  "node_modules/@playwright/test",
] as const;

/**
 * The `.testrunner` manifest version. Stamped into `testrunner-manifest.json`
 * at generation; read back by validation to detect a runner produced by an
 * older plugin (the Phase 3 playwright-bdd migration keys on this). Bumped
 * whenever the generated runtime shape changes incompatibly.
 */
export const TESTRUNNER_MANIFEST_VERSION = 3;

/** The generated manifest file (vault-relative to the runner root). */
export const TESTRUNNER_MANIFEST_FILE = "testrunner-manifest.json";

/** Canonical manifest content for the current version. */
export const testrunnerManifestContent = (): string =>
  JSON.stringify({ manifestVersion: TESTRUNNER_MANIFEST_VERSION }, null, 2) + "\n";
