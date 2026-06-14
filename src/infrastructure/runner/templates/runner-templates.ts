import type { TemplateFile } from "../../../application/ports/template-writer";
import type { TestHubSettings } from "../../../domain/settings/settings";
import {
  TESTRUNNER_MANIFEST_FILE,
  testrunnerManifestContent,
} from "../../../application/content/runner-manifest";
import { unsafeVaultPath } from "../../../domain/value-objects/vault-path";
import { relativeVaultPath } from "../../../shared/utils/vault-path";

/**
 * The `.testrunner` standalone Node project (TIS §11, honouring AD-2 npm, AD-5
 * Chromium, AD-8 local fixture).
 *
 * This is runtime-technology-specific Playwright/playwright-bdd/Node SOURCE, so
 * it lives in INFRASTRUCTURE (P3-7): the application layer must not embed
 * runtime tech. Generation is reached through the {@link TemplateWriter} port —
 * the `RunnerTemplateWriter` infra adapter exposes `buildRunnerTemplates`, and
 * the application services call the port, never this module. The plain file/dep
 * MANIFEST the validators assert against stays in the application layer
 * (`application/content/runner-manifest.ts`) as contract data.
 *
 * The runner is driven by the Playwright Test runner via playwright-bdd:
 * `bddgen` generates Playwright tests from `.feature` files, then
 * `playwright test` executes them. The entry point is `playwright.config.ts`;
 * there is no Cucumber `World` or `hooks.ts`.
 *
 * `overwrite: false` protects user-authored automation (steps, page objects)
 * during a repair (Runtime View RV-8); managed files are re-synced.
 */

const buildPackageJson = (browserArgs: string): string => `{
  "name": "obsidian-e2e-test-runner",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "bddgen && playwright test --pass-with-no-tests",
    "test:smoke": "bddgen && playwright test --grep @smoke --pass-with-no-tests",
    "test:ci": "bddgen && playwright test --pass-with-no-tests",
    "install:browsers": "playwright install ${browserArgs}",
    "install:browsers:ci": "playwright install --with-deps ${browserArgs}"
  },
  "devDependencies": {
    "@playwright/test": "^1.60.0",
    "@types/node": "^22.0.0",
    "playwright": "^1.60.0",
    "playwright-bdd": "^9.0.0",
    "typescript": "^5.6.0"
  }
}
`;

// "Preserve"/"Bundler" (not NodeNext): playwright-bdd resolves extensionless
// relative imports like a bundler. NodeNext made every generated relative import
// an IDE error (ts2835: "needs explicit .js extension") even though the suite
// ran fine — found via real-IDE validation; the e2e-smoke script now typechecks
// the generated runner to lock IDE parity.
const TSCONFIG_JSON = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Preserve",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": false,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
`;

// The runner runs with cwd = the runner folder, so the feature glob is the path
// from the runner folder to the configured feature folder (ADR-0008).
// The glob is emitted via JSON.stringify so it is ALWAYS a safe, fully-escaped
// JS string literal — even if a hostile `featureFilesPath` somehow reaches here
// it cannot break out of the literal and inject code into the module Node loads
// (defence in depth behind PathSafetyPolicy; see SEC-1 / P0-1).
const PLAYWRIGHT_CONFIG = (
  featuresGlob: string,
  featuresRoot: string,
  browsersFallback: string,
): string => `import { defineConfig } from "@playwright/test";
import { defineBddConfig, cucumberReporter } from "playwright-bdd";

const testDir = defineBddConfig({
  // The Test Hub sets BDD_FEATURES (NEWLINE-separated, runner-relative paths or a
  // glob) for feature/use-case/all scoped runs so bddgen GENERATES only those
  // features — not every \`.feature\` in the vault. This keeps a scoped run of a
  // valid feature from failing because some other unrelated/malformed feature
  // doesn't parse. Newline is the delimiter because a vault path can contain a
  // comma but never a newline (control chars are rejected by PathSafetyPolicy).
  // Unset → the full glob (run everything).
  features: process.env.BDD_FEATURES ? process.env.BDD_FEATURES.split("\\n") : ${JSON.stringify(featuresGlob)},
  // playwright-bdd rejects any feature file that is not under featuresRoot, and
  // it defaults to the config's own directory (.testrunner). The Test Hub keeps
  // feature files OUTSIDE the runner (in the vault), so point featuresRoot at
  // the configured feature folder — otherwise \`bddgen\` fails: "All feature
  // files should be located underneath featuresRoot."
  featuresRoot: ${JSON.stringify(featuresRoot)},
  steps: "src/steps/**/*.ts",
  // The Test Hub sets BDD_TAGS for suite (tag-expression) runs; bddgen applies
  // the full cucumber tag expression at generation. Undefined runs everything.
  tags: process.env.BDD_TAGS || undefined,
});

// keep in sync with BROWSER_NAMES in settings.ts (generated standalone file can't import it)
const VALID_BROWSERS = new Set(["chromium", "firefox", "webkit"]);
const requestedBrowsers = (process.env.TESTRUNNER_BROWSERS?.split(",").map((b) => b.trim()) ?? [])
  .filter((b) => VALID_BROWSERS.has(b));
const projectBrowsers = requestedBrowsers.length > 0 ? requestedBrowsers : ${browsersFallback};

export default defineConfig({
  testDir,
  reporter: [
    ["list"],
    cucumberReporter("json", {
      outputFile: "reports/cucumber-report.json",
      skipAttachments: false, // CRITICAL: default true drops all embeddings (ADR-0016)
    }),
  ],
  use: { screenshot: "only-on-failure", trace: "retain-on-failure" },
  projects: projectBrowsers.map((name) => ({ name, use: { browserName: name } })),
});
`;

const PATHS_TS = `import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const runnerRoot = resolve(here, "..", "..");

// pathToFileURL produces a valid, URL-encoded file:// URL on every platform
// (e.g. Windows drive letters, spaces) — string-prefixing does not.
export const fixtureUrl = (file: string): string =>
  pathToFileURL(resolve(runnerRoot, "src", "fixtures", file)).href;
`;

const EXAMPLE_PAGE_TS = `import type { Page } from "@playwright/test";
import { fixtureUrl } from "../support/paths";

export class ExamplePage {
  constructor(private readonly page: Page) {}

  async open(): Promise<void> {
    await this.page.goto(fixtureUrl("example.html"));
  }

  async continue(): Promise<void> {
    await this.page.click("#continue");
  }

  async resultText(): Promise<string | null> {
    return this.page.textContent("#result");
  }
}
`;

const EXAMPLE_STEPS_TS = `import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { ExamplePage } from "../pages/ExamplePage";

const { Given, When, Then } = createBdd();

Given("I open the local example page", async ({ page }) => {
  await new ExamplePage(page).open();
});

When("I click the {string} button", async ({ page }, label: string) => {
  if (label !== "Continue") throw new Error(\`Unknown button: \${label}\`);
  await new ExamplePage(page).continue();
});

Then("I should see {string}", async ({ page }, expected: string) => {
  await expect(page.locator("#result")).toHaveText(expected);
});
`;

// The fixture script concatenates strings instead of using a template literal:
// a \${...} placeholder inside this TS template literal would be interpolated
// at build time, not in the browser.
const EXAMPLE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Specorator Testrunner — Demo</title>
  </head>
  <body>
    <h1>Specorator Testrunner Demo</h1>
    <button id="continue">Continue</button>
    <div id="result"></div>
    <hr />
    <!-- Guided Tour greeting form: the user's self-authored scenario drives this. -->
    <label for="name">Name</label>
    <input id="name" type="text" />
    <button id="greet">Greet</button>
    <div id="greeting"></div>
    <script>
      document.getElementById("continue").addEventListener("click", () => {
        document.getElementById("result").textContent = "Test completed";
      });
      document.getElementById("greet").addEventListener("click", () => {
        const name = document.getElementById("name").value;
        document.getElementById("greeting").textContent = "Hello, " + name + "!";
      });
    </script>
  </body>
</html>
`;

const README_MD = `# .testrunner

The self-contained Playwright + playwright-bdd runtime generated by the **Obsidian
Specorator Testrunner**. It runs identically inside Obsidian and in CI.

> Managed by the plugin. \`package.json\`, \`tsconfig.json\`, \`playwright.config.ts\`,
> and the support/fixtures files are regenerated on repair. Your step definitions
> (\`src/steps/\`) and page objects (\`src/pages/\`) are never overwritten.

## Run locally

\`\`\`bash
npm install
npm run install:browsers     # one-time download of the configured browsers (AD-5)
npm run test                 # all scenarios
npm run test:smoke           # @smoke only
\`\`\`

## Run in CI

\`\`\`bash
npm ci
npm run install:browsers:ci
npm run test:ci              # writes reports/cucumber-report.json via playwright.config.ts
\`\`\`

The runner is driven by the Playwright Test runner via playwright-bdd: \`bddgen\`
generates Playwright tests from \`.feature\` files, then \`playwright test\` executes
them using \`playwright.config.ts\` as the entry point. Failure screenshots are embedded in \`reports/cucumber-report.json\`; Playwright
traces are saved under \`test-results/\`.
`;

/** All `.testrunner` template files, paths relative to the runner root. */
export const buildRunnerTemplates = (settings: TestHubSettings): TemplateFile[] => {
  // SEC-1 / P0-1: the glob + root are emitted via JSON.stringify inside
  // PLAYWRIGHT_CONFIG so a hostile featureFilesPath cannot escape the literal.
  // featuresRoot is the feature folder relative to the runner (features live
  // outside .testrunner); the glob walks it for `.feature` files.
  const featuresRoot = relativeVaultPath(
    settings.paths.testRunnerPath,
    settings.paths.featureFilesPath,
  );
  const featuresGlob = `${featuresRoot}/**/*.feature`;
  const browserArgs = settings.runner.browsers.join(" ");
  // Bake the validated browser selection as the fallback so `npm run test`
  // (standalone direct run, TESTRUNNER_BROWSERS unset) honours the configured
  // matrix instead of silently defaulting to chromium-only (US-055).
  const browsersFallback = JSON.stringify(settings.runner.browsers);

  return [
    // Template paths are trusted compile-time literals relative to the runner root.
    {
      path: unsafeVaultPath("package.json"),
      content: buildPackageJson(browserArgs),
      overwrite: true,
    },
    {
      path: unsafeVaultPath(TESTRUNNER_MANIFEST_FILE),
      content: testrunnerManifestContent(),
      overwrite: true,
    },
    { path: unsafeVaultPath("tsconfig.json"), content: TSCONFIG_JSON, overwrite: true },
    {
      path: unsafeVaultPath("playwright.config.ts"),
      content: PLAYWRIGHT_CONFIG(featuresGlob, featuresRoot, browsersFallback),
      overwrite: true,
    },
    { path: unsafeVaultPath("README.md"), content: README_MD, overwrite: true },
    { path: unsafeVaultPath("src/support/paths.ts"), content: PATHS_TS, overwrite: true },
    {
      path: unsafeVaultPath("src/fixtures/example.html"),
      content: EXAMPLE_HTML,
      overwrite: true,
    },
    // User-authored automation — preserved on repair (RV-8).
    {
      path: unsafeVaultPath("src/pages/ExamplePage.ts"),
      content: EXAMPLE_PAGE_TS,
      overwrite: false,
    },
    {
      path: unsafeVaultPath("src/steps/example.steps.ts"),
      content: EXAMPLE_STEPS_TS,
      overwrite: false,
    },
  ];
};
