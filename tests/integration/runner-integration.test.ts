import { describe, expect, it } from "vitest";
import { buildRunnerTemplates } from "../../src/infrastructure/runner/templates/runner-templates";
import { DEFAULT_SETTINGS } from "../../src/domain/settings/settings";
import { unsafeVaultPath as vp } from "../../src/domain/value-objects/vault-path";

/**
 * US-048 — Test Runner Integration (FEAT-027).
 *
 * Wires the generated runner templates together and proves they are internally
 * coherent end-to-end: every npm script `TestExecutionService` invokes exists in
 * the generated `package.json`, the scripts point at the config
 * `buildRunnerTemplates` actually emits, and the playwright-bdd feature glob lines
 * up with the configured feature folder. These assertions catch drift between the
 * command layer (`resolveCommand`/`DEFAULT_SETTINGS.runner`) and the template
 * layer (`package.json`/`playwright.config.ts`) before a run can fail in the wild.
 */

const templatesFor = (settings = DEFAULT_SETTINGS) => {
  const templates = buildRunnerTemplates(settings);
  // Key by plain string so lookups can use bare path literals (t.path is a VaultPath).
  const byPath = new Map<string, string>(templates.map((t) => [t.path, t.content]));
  const packageJson = JSON.parse(byPath.get("package.json") ?? "{}") as {
    scripts: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  return { byPath, packageJson };
};

// The scopes TestExecutionService resolves all dispatch into one of these npm
// scripts (test-execution-service.ts resolveCommand) and the runner defaults
// (DEFAULT_SETTINGS.runner) name them too. The generated package.json must
// define every one, or `npm run <script>` fails at run time.
const SCRIPTS_INVOKED_BY_EXECUTION = ["test", "test:smoke", "test:ci"] as const;

describe("US-048 runner integration: scripts the executor invokes exist", () => {
  it("defines every npm script TestExecutionService dispatches", () => {
    const { packageJson } = templatesFor();
    for (const script of SCRIPTS_INVOKED_BY_EXECUTION) {
      expect(packageJson.scripts[script], `package.json missing script "${script}"`).toBeTruthy();
    }
  });

  it("matches the runner command defaults in settings to package.json scripts", () => {
    const { packageJson } = templatesFor();
    // DEFAULT_SETTINGS.runner.*RunCommand are the human-facing command strings;
    // each must reduce to an `npm run <script>` the package.json actually has.
    const commands = {
      default: DEFAULT_SETTINGS.runner.defaultRunCommand,
      smoke: DEFAULT_SETTINGS.runner.smokeRunCommand,
      ci: DEFAULT_SETTINGS.runner.ciRunCommand,
    };
    for (const command of Object.values(commands)) {
      const match = /^npm run (\S+)$/.exec(command);
      expect(match, `"${command}" is not an "npm run <script>" command`).not.toBeNull();
      const script = match?.[1] ?? "";
      expect(packageJson.scripts[script], `no package.json script for "${command}"`).toBeTruthy();
    }
  });

  it("every script chains bddgen then playwright test, and playwright.config.ts exists", () => {
    const { byPath, packageJson } = templatesFor();
    // playwright.config.ts must exist because it is the playwright-bdd entry point.
    expect(byPath.has("playwright.config.ts")).toBe(true);
    for (const script of SCRIPTS_INVOKED_BY_EXECUTION) {
      const body = packageJson.scripts[script];
      expect(body, script).toContain("bddgen");
      expect(body, script).toContain("playwright test");
    }
  });

  it("the smoke script filters @smoke via Playwright --grep flag", () => {
    const { packageJson } = templatesFor();
    // playwright test uses --grep for tag filtering (not --tags); the demo
    // Use Case is @smoke-only, so the smoke script must filter on that exact tag.
    expect(packageJson.scripts["test:smoke"]).toContain("--grep @smoke");
  });

  it("the ci script writes the JSON report ReportImportService later reads", () => {
    const { byPath } = templatesFor();
    // The report path is configured in playwright.config.ts (cucumberReporter),
    // not via a CLI flag — so we verify the config carries the artifact path.
    const config = byPath.get("playwright.config.ts") ?? "";
    expect(config).toContain("reports/cucumber-report.json");
    expect(config).toContain('cucumberReporter("json"');
    // skipAttachments: false is mandatory — the default true silently drops
    // all embeddings (evidence), making the ingested report evidence-empty.
    expect(config).toContain("skipAttachments: false");
  });

  it("declares every runtime dependency the scripts reference", () => {
    const { packageJson } = templatesFor();
    // The scripts invoke `bddgen && playwright test` — these packages must be present.
    expect(packageJson.devDependencies["playwright-bdd"]).toBeTruthy();
    expect(packageJson.devDependencies["@playwright/test"]).toBeTruthy();
    expect(packageJson.devDependencies.playwright).toBeTruthy();
    // V1 cucumber-js deps must be absent — they're no longer used.
    expect(packageJson.devDependencies["@cucumber/cucumber"]).toBeFalsy();
    expect(packageJson.devDependencies.tsx).toBeFalsy();
  });

  it("playwright.config.ts feature glob points at the configured feature folder", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      paths: {
        ...DEFAULT_SETTINGS.paths,
        testRunnerPath: vp("Tools/.testrunner"),
        featureFilesPath: vp("Specs/features"),
      },
    };
    const { byPath } = templatesFor(settings);
    // The runner runs with cwd = the runner folder, so the glob must be the
    // relative hop from that folder to the configured feature folder.
    // The glob is inside a defineBddConfig({ features: "..." }) call in the config.
    expect(byPath.get("playwright.config.ts")).toContain("../../Specs/features/**/*.feature");
  });
});
