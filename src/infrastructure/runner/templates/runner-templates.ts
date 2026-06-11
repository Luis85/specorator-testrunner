import type { TemplateFile } from "../../../application/ports/template-writer";
import type { TestHubSettings } from "../../../domain/settings/settings";
import { unsafeVaultPath } from "../../../domain/value-objects/vault-path";
import { relativeVaultPath } from "../../../shared/utils/vault-path";

/**
 * The `.testrunner` standalone Node project (TIS §11, honouring AD-2 npm, AD-5
 * Chromium, AD-6 serial, AD-7 tsx loader, AD-8 local fixture).
 *
 * This is runtime-technology-specific Playwright/Cucumber/Node SOURCE, so it
 * lives in INFRASTRUCTURE (P3-7): the application layer must not embed runtime
 * tech. Generation is reached through the {@link TemplateWriter} port — the
 * `RunnerTemplateWriter` infra adapter exposes `buildRunnerTemplates`, and the
 * application services call the port, never this module. The plain file/dep
 * MANIFEST the validators assert against stays in the application layer
 * (`application/content/runner-manifest.ts`) as contract data.
 *
 * Per TIS §11 there is intentionally NO `playwright.config.ts`: Playwright is
 * driven through the Cucumber `World` (`chromium.launch()` in `world.ts`), not
 * the Playwright Test runner.
 *
 * `overwrite: false` protects user-authored automation (steps, page objects)
 * during a repair (Runtime View RV-8); managed files are re-synced.
 */

const PACKAGE_JSON = `{
  "name": "obsidian-e2e-test-runner",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --import tsx node_modules/@cucumber/cucumber/bin/cucumber.js --config cucumber.mjs",
    "test:smoke": "node --import tsx node_modules/@cucumber/cucumber/bin/cucumber.js --config cucumber.mjs --tags @smoke",
    "test:ci": "node --import tsx node_modules/@cucumber/cucumber/bin/cucumber.js --config cucumber.mjs --format json:reports/cucumber-report.json",
    "install:browsers": "playwright install chromium",
    "install:browsers:ci": "playwright install --with-deps chromium"
  },
  "devDependencies": {
    "@cucumber/cucumber": "^12.0.0",
    "playwright": "^1.60.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0"
  }
}
`;

const TSCONFIG_JSON = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": false,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
`;

// tsx is registered via `node --import tsx` in the npm scripts (the cucumber-js
// documented setup for tsx 4 / Node 20.6+, AD-7), so no deprecated `loader`
// hook here. The runner runs with cwd = the runner folder, so the feature glob
// is the path from the runner folder to the configured feature folder (ADR-0008).
// The glob is emitted via JSON.stringify so it is ALWAYS a safe, fully-escaped
// JS string literal — even if a hostile `featureFilesPath` somehow reaches here
// it cannot break out of the literal and inject code into the module Node loads
// (defence in depth behind PathSafetyPolicy; see SEC-1 / P0-1).
// SHAPE: the options object is the DEFAULT EXPORT ITSELF. Cucumber's ESM
// config loading reads \`(await import(file)).default\` as the options — the
// profile-keyed \`{ default: { … } }\` wrapper (a CJS \`module.exports\` idiom)
// is NOT unwrapped for an ESM default export, so wrapping silently discarded
// the WHOLE config: no step imports (every demo step ran "Undefined"), no
// json report (evidence import found nothing). Found via the first real
// testvault demo run.
const cucumberMjs = (featuresGlob: string): string => `export default {
  import: ["src/support/**/*.ts", "src/steps/**/*.ts"],
  paths: [${JSON.stringify(featuresGlob)}],
  format: [
    "progress",
    "json:reports/cucumber-report.json",
  ],
  // NOTE: the deprecated \`publishQuiet\` option was REMOVED in Cucumber 12
  // (the publish banner it suppressed no longer exists). Cucumber 12 rejects
  // unknown options, so it must not be emitted here (P4-5).
  parallel: 0,
};
`;

const WORLD_TS = `import { World, setWorldConstructor } from "@cucumber/cucumber";
import { Browser, BrowserContext, Page, chromium } from "playwright";

export class TestWorld extends World {
  browser?: Browser;
  context?: BrowserContext;
  page?: Page;

  async openBrowser(): Promise<void> {
    this.browser = await chromium.launch({ headless: true });
    this.context = await this.browser.newContext();
    this.page = await this.context.newPage();
  }

  async closeBrowser(): Promise<void> {
    await this.page?.close();
    await this.context?.close();
    await this.browser?.close();
  }
}

setWorldConstructor(TestWorld);
`;

const HOOKS_TS = `import { After, Before, Status } from "@cucumber/cucumber";
import { TestWorld } from "./world";

Before(async function (this: TestWorld) {
  await this.openBrowser();
});

// On failure, capture a screenshot and attach it to the Cucumber report before
// the browser closes. Attachments are written into the JSON report's
// embeddings, which the Test Hub imports as screenshot evidence (US-033/034).
After(async function (this: TestWorld, scenario) {
  if (scenario.result?.status === Status.FAILED && this.page) {
    try {
      this.attach(await this.page.screenshot(), "image/png");
    } catch {
      // A page already crashed/closed shouldn't fail teardown.
    }
  }
  await this.closeBrowser();
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

const EXAMPLE_PAGE_TS = `import { Page } from "playwright";
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

const EXAMPLE_STEPS_TS = `import { Given, Then, When } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { ExamplePage } from "../pages/ExamplePage";
import { TestWorld } from "../support/world";

Given("I open the local example page", async function (this: TestWorld) {
  if (!this.page) throw new Error("Page not initialized");
  const example = new ExamplePage(this.page);
  await example.open();
});

When("I click the {string} button", async function (this: TestWorld, label: string) {
  if (!this.page) throw new Error("Page not initialized");
  if (label !== "Continue") throw new Error(\`Unsupported button: \${label}\`);
  const example = new ExamplePage(this.page);
  await example.continue();
});

Then("I should see {string}", async function (this: TestWorld, expected: string) {
  if (!this.page) throw new Error("Page not initialized");
  const example = new ExamplePage(this.page);
  for (let attempt = 0; attempt < 20; attempt++) {
    if ((await example.resultText()) === expected) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(await example.resultText(), expected);
});
`;

// The fixture script concatenates strings instead of using a template literal:
// a \${...} placeholder inside this TS template literal would be interpolated
// at build time, not in the browser.
const EXAMPLE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Obsidian E2E Test Hub — Demo</title>
  </head>
  <body>
    <h1>Obsidian E2E Test Hub Demo</h1>
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

The self-contained Playwright + Cucumber-JS runtime generated by the **Obsidian
E2E Test Hub**. It runs identically inside Obsidian and in CI.

> Managed by the plugin. \`package.json\`, \`tsconfig.json\`, \`cucumber.mjs\`, and the
> support/fixtures files are regenerated on repair. Your step definitions
> (\`src/steps/\`) and page objects (\`src/pages/\`) are never overwritten.

## Run locally

\`\`\`bash
npm install
npm run install:browsers     # one-time Chromium download (AD-5)
npm run test                 # all scenarios
npm run test:smoke           # @smoke only
\`\`\`

## Run in CI

\`\`\`bash
npm ci
npm run install:browsers:ci
npm run test:ci              # writes reports/cucumber-report.json
\`\`\`

Playwright is driven through the Cucumber \`World\` (\`src/support/world.ts\`), not
the Playwright Test runner, so there is no \`playwright.config.ts\` (TIS §11).
Tests run serially in V1 (\`parallel: 0\`, AD-6).
`;

/** All `.testrunner` template files, paths relative to the runner root. */
export const buildRunnerTemplates = (settings: TestHubSettings): TemplateFile[] => [
  // Template paths are trusted compile-time literals relative to the runner root.
  { path: unsafeVaultPath("package.json"), content: PACKAGE_JSON, overwrite: true },
  { path: unsafeVaultPath("tsconfig.json"), content: TSCONFIG_JSON, overwrite: true },
  {
    path: unsafeVaultPath("cucumber.mjs"),
    content: cucumberMjs(
      `${relativeVaultPath(settings.paths.testRunnerPath, settings.paths.featureFilesPath)}/**/*.feature`,
    ),
    overwrite: true,
  },
  { path: unsafeVaultPath("README.md"), content: README_MD, overwrite: true },
  { path: unsafeVaultPath("src/support/world.ts"), content: WORLD_TS, overwrite: true },
  { path: unsafeVaultPath("src/support/hooks.ts"), content: HOOKS_TS, overwrite: true },
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
