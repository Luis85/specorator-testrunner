import { describe, expect, it } from "vitest";
import { buildGitHubActionsWorkflow } from "../src/application/content/ci-workflow-content";
import { DEFAULT_SETTINGS } from "../src/domain/settings/settings";

describe("buildGitHubActionsWorkflow", () => {
  it("reads BASE_URL from a repository variable, never baked in (ADR-0011)", () => {
    const yaml = buildGitHubActionsWorkflow(DEFAULT_SETTINGS);
    expect(yaml).toContain("BASE_URL: ${{ vars.E2E_BASE_URL }}");
    // The active environment URL must NOT leak into the generated workflow.
    expect(yaml).not.toContain(DEFAULT_SETTINGS.sut.environments.demo.baseUrl);
  });

  it("exposes configured auth.env keys as CI secrets (matches local runEnv)", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      sut: {
        ...DEFAULT_SETTINGS.sut,
        environments: {
          ...DEFAULT_SETTINGS.sut.environments,
          staging: {
            baseUrl: "https://staging.example.com",
            auth: { kind: "env", env: { E2E_USERNAME: "u", E2E_PASSWORD: "p" } },
          },
        },
      },
    } as typeof DEFAULT_SETTINGS;
    const yaml = buildGitHubActionsWorkflow(settings);
    expect(yaml).toContain("E2E_USERNAME: ${{ secrets.E2E_USERNAME }}");
    expect(yaml).toContain("E2E_PASSWORD: ${{ secrets.E2E_PASSWORD }}");
    // Secret VALUES are never baked in.
    expect(yaml).not.toContain("u\n");
    // Secrets are scoped to the "Run tests" STEP, not the job — install/Playwright
    // steps must not receive credentials (their lifecycle scripts could read them).
    const installToRun = yaml.slice(
      yaml.indexOf("Install dependencies"),
      yaml.indexOf("Run tests"),
    );
    expect(installToRun).not.toContain("secrets.");
    expect(installToRun).not.toContain("BASE_URL");
  });

  it("emits no auth env lines when no environment configures auth", () => {
    const yaml = buildGitHubActionsWorkflow(DEFAULT_SETTINGS);
    expect(yaml).not.toContain("secrets.");
  });

  it("never overrides BASE_URL from a configured auth.env key", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      sut: {
        ...DEFAULT_SETTINGS.sut,
        environments: {
          ...DEFAULT_SETTINGS.sut.environments,
          staging: {
            baseUrl: "https://staging.example.com",
            auth: { kind: "env", env: { BASE_URL: "x", E2E_TOKEN: "t" } },
          },
        },
      },
    } as typeof DEFAULT_SETTINGS;
    const yaml = buildGitHubActionsWorkflow(settings);
    // BASE_URL stays mapped from the repository variable, never from secrets.
    expect(yaml).toContain("BASE_URL: ${{ vars.E2E_BASE_URL }}");
    expect(yaml).not.toContain("secrets.BASE_URL");
    expect(yaml).toContain("E2E_TOKEN: ${{ secrets.E2E_TOKEN }}");
  });

  it("runs the standalone runner commands in the runner folder (US-042, ADR-0006)", () => {
    const yaml = buildGitHubActionsWorkflow(DEFAULT_SETTINGS);
    expect(yaml).toContain(`working-directory: ${DEFAULT_SETTINGS.paths.testRunnerPath}`);
    expect(yaml).toContain("npm ci");
    expect(yaml).toContain("npx playwright install --with-deps chromium");
    expect(yaml).toContain("npm run test:ci");
  });

  it("renders the configured ciRunCommand instead of the default test:ci", () => {
    const yaml = buildGitHubActionsWorkflow({
      ...DEFAULT_SETTINGS,
      runner: { ...DEFAULT_SETTINGS.runner, ciRunCommand: "npm run e2e:ci" },
    });
    expect(yaml).toContain("run: npm run e2e:ci");
    expect(yaml).not.toContain("run: npm run test:ci");
  });

  it("renders the configured ciInstallCommand instead of the default npm ci", () => {
    const yaml = buildGitHubActionsWorkflow({
      ...DEFAULT_SETTINGS,
      runner: { ...DEFAULT_SETTINGS.runner, ciInstallCommand: "npm install --no-audit" },
    });
    expect(yaml).toContain("run: npm install --no-audit");
  });

  it("enables the npm cache only for the lockfile-based default npm ci", () => {
    const defaultYaml = buildGitHubActionsWorkflow(DEFAULT_SETTINGS);
    expect(defaultYaml).toContain("cache: npm");
    expect(defaultYaml).toContain("cache-dependency-path:");

    const customYaml = buildGitHubActionsWorkflow({
      ...DEFAULT_SETTINGS,
      runner: { ...DEFAULT_SETTINGS.runner, ciInstallCommand: "npm install" },
    });
    expect(customYaml).not.toContain("cache: npm");
    expect(customYaml).not.toContain("cache-dependency-path:");
  });

  it("uses the configured Node version and checks out the repo", () => {
    const yaml = buildGitHubActionsWorkflow({
      ...DEFAULT_SETTINGS,
      ci: { ...DEFAULT_SETTINGS.ci, nodeVersion: "20" },
    });
    expect(yaml).toContain("actions/checkout@v4");
    expect(yaml).toContain('node-version: "20"');
  });

  it("falls back to a default Node version when blank", () => {
    const yaml = buildGitHubActionsWorkflow({
      ...DEFAULT_SETTINGS,
      ci: { ...DEFAULT_SETTINGS.ci, nodeVersion: "  " },
    });
    expect(yaml).toContain('node-version: "22"');
  });
});
