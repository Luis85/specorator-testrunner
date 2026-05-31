import { describe, expect, it } from "vitest";
import { buildGitHubActionsWorkflow } from "../../src/application/content/ci-workflow-content";
import { buildRunnerTemplates } from "../../src/application/content/runner-templates";
import { DEFAULT_SETTINGS } from "../../src/domain/settings/settings";

/**
 * US-050 — Validate CI Scenario (FEAT-028, UC-019/UC-020).
 *
 * "Generated pipeline succeeds" means the GitHub Actions workflow must invoke
 * the EXACT scripts the generated runner project defines, run them with the
 * runner folder as cwd, and source BASE_URL from a GH Actions repository
 * variable (ADR-0011). These assertions tie the workflow text to the runner's
 * `package.json` scripts so the two layers can't drift: if a runner script is
 * renamed or BASE_URL stops being read from a GH variable, the generated CI
 * would silently break — this fails first.
 */

const runnerPackageJson = (settings = DEFAULT_SETTINGS) => {
  const templates = buildRunnerTemplates(settings);
  const pkg = templates.find((t) => t.path === "package.json")?.content ?? "{}";
  return JSON.parse(pkg) as { scripts: Record<string, string> };
};

describe("US-050 CI scenario: workflow and runner scripts stay in lockstep", () => {
  it("runs only scripts the runner package.json actually defines", () => {
    const workflow = buildGitHubActionsWorkflow(DEFAULT_SETTINGS);
    const { scripts } = runnerPackageJson();

    // Every `npm run <script>` the workflow invokes must exist in the runner.
    // Script names are [a-z0-9:-]; this also keeps the doc-comment's
    // backtick-wrapped `npm run test:ci` mention from leaking trailing punctuation.
    const invoked = [...new Set([...workflow.matchAll(/npm run ([a-z0-9:-]+)/g)].map((m) => m[1]))];
    expect(invoked.length).toBeGreaterThan(0);
    for (const script of invoked) {
      expect(scripts[script], `workflow runs "npm run ${script}" but runner has no such script`)
        .toBeTruthy();
    }
    // And specifically the CI entry point both sides agree on.
    expect(invoked).toContain("test:ci");
    expect(scripts["test:ci"]).toBeTruthy();
  });

  it("installs deps with `npm ci` and runs `npm run test:ci` (ADR-0006 standalone)", () => {
    const workflow = buildGitHubActionsWorkflow(DEFAULT_SETTINGS);
    expect(workflow).toContain("npm ci");
    expect(workflow).toContain("npm run test:ci");
  });

  it("reads BASE_URL from a GitHub Actions repository variable (ADR-0011)", () => {
    const workflow = buildGitHubActionsWorkflow(DEFAULT_SETTINGS);
    // BASE_URL must come from a GH Actions *variable*, never be baked in at
    // generation time, so switching Environments can't point CI at a stale URL.
    expect(workflow).toMatch(/BASE_URL:\s*\$\{\{\s*vars\.E2E_BASE_URL\s*\}\}/);
    expect(workflow).not.toContain("localhost");
  });

  it("runs all steps with cwd = the configured runner folder", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      paths: { ...DEFAULT_SETTINGS.paths, testRunnerPath: "Tools/.runner" },
    };
    const workflow = buildGitHubActionsWorkflow(settings);
    // working-directory must track the runner path, or `npm ci`/`npm run test:ci`
    // execute in the repo root where there is no package.json.
    expect(workflow).toContain("working-directory: Tools/.runner");
    expect(workflow).toContain("cache-dependency-path: Tools/.runner/package-lock.json");
  });

  it("honours the configured CI node version", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      ci: { ...DEFAULT_SETTINGS.ci, nodeVersion: "20" },
    };
    const workflow = buildGitHubActionsWorkflow(settings);
    expect(workflow).toContain('node-version: "20"');
  });
});
