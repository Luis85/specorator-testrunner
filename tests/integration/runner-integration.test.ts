import { describe, expect, it } from "vitest";
import { buildRunnerTemplates } from "../../src/infrastructure/runner/templates/runner-templates";
import { DEFAULT_SETTINGS } from "../../src/domain/settings/settings";

/**
 * US-048 — Test Runner Integration (FEAT-027).
 *
 * Wires the generated runner templates together and proves they are internally
 * coherent end-to-end: every npm script `TestExecutionService` invokes exists in
 * the generated `package.json`, the scripts point at the config
 * `buildRunnerTemplates` actually emits, and the cucumber feature glob lines up
 * with the configured feature folder. These assertions catch drift between the
 * command layer (`resolveCommand`/`DEFAULT_SETTINGS.runner`) and the template
 * layer (`package.json`/`cucumber.mjs`) before a run can fail in the wild.
 */

const templatesFor = (settings = DEFAULT_SETTINGS) => {
  const templates = buildRunnerTemplates(settings);
  const byPath = new Map(templates.map((t) => [t.path, t.content]));
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

  it("every script delegates to cucumber-js via the generated cucumber.mjs config", () => {
    const { byPath, packageJson } = templatesFor();
    // cucumber.mjs must exist because the scripts pass `--config cucumber.mjs`.
    expect(byPath.has("cucumber.mjs")).toBe(true);
    for (const script of SCRIPTS_INVOKED_BY_EXECUTION) {
      const body = packageJson.scripts[script];
      expect(body, script).toContain("@cucumber/cucumber/bin/cucumber.js");
      expect(body, script).toContain("--config cucumber.mjs");
    }
  });

  it("the smoke script filters @smoke so the demo's smoke suite tag resolves to a run", () => {
    const { packageJson } = templatesFor();
    // The demo Use Case is @smoke-only; the smoke suite tag expression is
    // `@smoke`. The smoke script must filter on that exact tag, or the Smoke
    // suite would run nothing the demo actually carries.
    expect(packageJson.scripts["test:smoke"]).toContain("--tags @smoke");
  });

  it("the ci script writes the JSON report ReportImportService later reads", () => {
    const { byPath, packageJson } = templatesFor();
    // test:ci must emit reports/cucumber-report.json; the cucumber.mjs default
    // format does too — both point at the same artifact path the importer scans.
    expect(packageJson.scripts["test:ci"]).toContain("reports/cucumber-report.json");
    expect(byPath.get("cucumber.mjs")).toContain("json:reports/cucumber-report.json");
  });

  it("declares every runtime dependency the scripts reference", () => {
    const { packageJson } = templatesFor();
    // The scripts invoke `node --import tsx node_modules/@cucumber/cucumber/...`.
    expect(packageJson.devDependencies["@cucumber/cucumber"]).toBeTruthy();
    expect(packageJson.devDependencies["tsx"]).toBeTruthy();
    expect(packageJson.devDependencies["playwright"]).toBeTruthy();
  });

  it("cucumber.mjs feature glob points at the configured feature folder", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      paths: {
        ...DEFAULT_SETTINGS.paths,
        testRunnerPath: "Tools/.testrunner",
        featureFilesPath: "Specs/features",
      },
    };
    const { byPath } = templatesFor(settings);
    // The runner runs with cwd = the runner folder, so the glob must be the
    // relative hop from that folder to the configured feature folder.
    expect(byPath.get("cucumber.mjs")).toContain('paths: ["../../Specs/features/**/*.feature"]');
  });
});
