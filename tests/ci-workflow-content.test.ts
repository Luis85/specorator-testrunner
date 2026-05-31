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

  it("runs the standalone runner commands in the runner folder (US-042, ADR-0006)", () => {
    const yaml = buildGitHubActionsWorkflow(DEFAULT_SETTINGS);
    expect(yaml).toContain(`working-directory: ${DEFAULT_SETTINGS.paths.testRunnerPath}`);
    expect(yaml).toContain("npm ci");
    expect(yaml).toContain("npx playwright install --with-deps chromium");
    expect(yaml).toContain("npm run test:ci");
  });

  it("uses the configured Node version and checks out the repo", () => {
    const yaml = buildGitHubActionsWorkflow({
      ...DEFAULT_SETTINGS,
      ci: { ...DEFAULT_SETTINGS.ci, nodeVersion: "20" },
    });
    expect(yaml).toContain("actions/checkout@v4");
    expect(yaml).toContain("node-version: 20");
  });

  it("falls back to a default Node version when blank", () => {
    const yaml = buildGitHubActionsWorkflow({
      ...DEFAULT_SETTINGS,
      ci: { ...DEFAULT_SETTINGS.ci, nodeVersion: "  " },
    });
    expect(yaml).toContain("node-version: 22");
  });
});
