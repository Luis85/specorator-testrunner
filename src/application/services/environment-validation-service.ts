import type { AbsoluteFileSystem } from "../ports/absolute-file-system";
import type { ChildProcessRunner } from "../ports/child-process-runner";
import {
  REQUIRED_RUNNER_DEPENDENCIES,
  TESTRUNNER_MANIFEST_FILE,
  TESTRUNNER_MANIFEST_VERSION,
  VALIDATED_RUNNER_FILES,
} from "../content/runner-manifest";
import { parseManifestVersion, parseManifestBrowsers } from "../content/runner-manifest-version";
import { buildGitHubActionsWorkflow, isNpmCiCommand } from "../content/ci-workflow-content";
import { isSafeCiCommand } from "./pipeline-generation-service";
import { playwrightBrowsersCandidates } from "./runner-paths";
import type { SettingsService } from "./settings-service";
import type { CommandSafetyPolicy } from "../../domain/policies/command-safety-policy";
import type { BrowserName, TestHubSettings } from "../../domain/settings/settings";
import { createEvent } from "../../shared/event-bus/create-event";
import type { EventBus } from "../../shared/event-bus/event-bus";

/** Extracts `<script>` from a `npm run <script> …` command, else null. */
const npmRunScript = (command: string): string | null => {
  const parts = command.trim().split(/\s+/);
  return parts[0] === "npm" && parts[1] === "run" && parts[2] ? parts[2] : null;
};

/** Environment + CI validation contract (TIS §8.3, UC-002 / UC-020). */
export interface EnvironmentValidationService {
  /**
   * @param correlationId optional init/reset flow id stamped onto
   * `testrunner.validated` so a wizard run's events share one id (§19, RV-1).
   */
  validateEnvironment(correlationId?: string): Promise<RunnerValidationResult>;
  validateCiReadiness(settings: TestHubSettings): Promise<CiReadinessResult>;
}

export interface RunnerValidationResult {
  valid: boolean;
  nodeAvailable: boolean;
  packageManagerAvailable: boolean;
  runnerFolderExists: boolean;
  packageJsonExists: boolean;
  dependenciesInstalled: boolean;
  playwrightAvailable: boolean; // package + binary resolve (`npx playwright --version`)
  browsersInstalled: boolean; // every selected runner.browsers entry is cached (US-055)
  issues: RunnerValidationIssue[];
}

export interface RunnerValidationIssue {
  code: string;
  message: string;
  severity: "error" | "warning" | "info";
}

/** The runner probe booleans/lists {@link collectRunnerIssues} maps onto issues. */
interface RunnerProbe {
  nodeAvailable: boolean;
  packageManagerAvailable: boolean;
  runnerFolderExists: boolean;
  missingFiles: string[];
  nodeModulesExists: boolean;
  missingDependencies: string[];
  playwrightAvailable: boolean;
  browsersInstalled: boolean;
  selectedBrowsers: readonly BrowserName[];
}

export interface CiReadinessResult {
  ready: boolean;
  missingItems: string[];
  warnings: string[];
}

export class DefaultEnvironmentValidationService implements EnvironmentValidationService {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly process: ChildProcessRunner,
    private readonly absoluteFs: AbsoluteFileSystem,
    private readonly commandSafety: CommandSafetyPolicy,
    private readonly eventBus: EventBus,
    private readonly env: Record<string, string | undefined> = {},
    private readonly platform = "linux",
  ) {}

  async validateEnvironment(correlationId?: string): Promise<RunnerValidationResult> {
    const settings = await this.settingsService.load();
    const base = await this.absoluteFs.getVaultBasePath();
    const issues: RunnerValidationIssue[] = [];

    if (!base.ok) {
      issues.push({ code: "VAULT_PATH_UNKNOWN", message: base.error.message, severity: "error" });
      return this.finish(correlationId, {
        valid: false,
        nodeAvailable: false,
        packageManagerAvailable: false,
        runnerFolderExists: false,
        packageJsonExists: false,
        dependenciesInstalled: false,
        playwrightAvailable: false,
        browsersInstalled: false,
        issues,
      });
    }

    const runnerAbs = `${base.value.replace(/[/\\]$/, "")}/${settings.paths.testRunnerPath}`;

    const nodeAvailable = await this.commandSucceeds(
      [settings.runner.nodeExecutable, "--version"],
      base.value,
    );
    const packageManagerAvailable = await this.commandSucceeds(["npm", "--version"], base.value);
    const runnerFolderExists = await this.absoluteFs.existsAbsolute(runnerAbs);
    const missingFiles: string[] = [];
    for (const file of VALIDATED_RUNNER_FILES) {
      if (!(await this.absoluteFs.existsAbsolute(`${runnerAbs}/${file}`))) missingFiles.push(file);
    }
    const packageJsonExists = !missingFiles.includes("package.json");
    const runnerFilesComplete = runnerFolderExists && missingFiles.length === 0;

    const nodeModulesExists = await this.absoluteFs.existsAbsolute(`${runnerAbs}/node_modules`);
    const missingDependencies: string[] = [];
    if (nodeModulesExists) {
      for (const dep of REQUIRED_RUNNER_DEPENDENCIES) {
        if (!(await this.absoluteFs.existsAbsolute(`${runnerAbs}/${dep}`)))
          missingDependencies.push(dep);
      }
    }
    const dependenciesInstalled = nodeModulesExists && missingDependencies.length === 0;
    const playwrightAvailable =
      dependenciesInstalled &&
      (await this.commandSucceeds(["npx", "playwright", "--version"], runnerAbs));
    const browsersInstalled = await this.detectBrowsers(runnerAbs, settings.runner.browsers);

    issues.push(
      ...(await this.collectRunnerIssues(
        runnerAbs,
        {
          nodeAvailable,
          packageManagerAvailable,
          runnerFolderExists,
          missingFiles,
          nodeModulesExists,
          missingDependencies,
          playwrightAvailable,
          browsersInstalled,
          selectedBrowsers: settings.runner.browsers,
        },
        settings.runner.browsers,
      )),
    );

    const valid =
      nodeAvailable &&
      packageManagerAvailable &&
      runnerFolderExists &&
      runnerFilesComplete &&
      dependenciesInstalled &&
      playwrightAvailable &&
      browsersInstalled;

    return this.finish(correlationId, {
      valid,
      nodeAvailable,
      packageManagerAvailable,
      runnerFolderExists,
      packageJsonExists,
      dependenciesInstalled,
      playwrightAvailable,
      browsersInstalled,
      issues,
    });
  }

  /**
   * Maps the runner probe booleans onto the ordered issue list (US-013). Pulled
   * out of {@link validateEnvironment} so that function stays a flat orchestration
   * (load → probe → collect → finish) rather than a long branching tail; the
   * `valid` flag is still derived from the booleans, not from these issues, so a
   * manifest advisory (a warning) never flips an otherwise-healthy runner.
   */
  private async collectRunnerIssues(
    runnerAbs: string,
    probe: RunnerProbe,
    settingsBrowsers: readonly string[],
  ): Promise<RunnerValidationIssue[]> {
    const issues: RunnerValidationIssue[] = [];
    if (!probe.nodeAvailable)
      issues.push({
        code: "NODE_MISSING",
        message: "Node.js is not available.",
        severity: "error",
      });
    if (!probe.packageManagerAvailable)
      issues.push({ code: "NPM_MISSING", message: "npm is not available.", severity: "error" });
    if (!probe.runnerFolderExists)
      issues.push({
        code: "RUNNER_MISSING_FILE",
        message: "The .testrunner folder is missing.",
        severity: "error",
      });
    else {
      for (const file of probe.missingFiles)
        issues.push({
          code: "RUNNER_MISSING_FILE",
          message: `.testrunner/${file} is missing.`,
          severity: "error",
        });
      // Only probe the manifest when the folder exists, so a wholly-missing
      // runner (already an error above) doesn't also emit a manifest advisory.
      const advisory = await this.manifestAdvisory(runnerAbs, settingsBrowsers);
      if (advisory) issues.push(advisory);
    }
    if (!probe.nodeModulesExists)
      issues.push({
        code: "DEPENDENCIES_MISSING",
        message: "Runner dependencies are not installed.",
        severity: "error",
      });
    else if (probe.missingDependencies.length > 0)
      for (const dep of probe.missingDependencies)
        issues.push({
          code: "DEPENDENCIES_MISSING",
          message: `.testrunner/${dep} is missing.`,
          severity: "error",
        });
    else if (!probe.playwrightAvailable)
      issues.push({
        code: "PLAYWRIGHT_MISSING",
        message: "Playwright is installed but not runnable.",
        severity: "error",
      });
    if (!probe.browsersInstalled)
      issues.push({
        code: "BROWSER_NOT_INSTALLED",
        message: `Selected browser(s) not installed: ${probe.selectedBrowsers.join(", ")}.`,
        severity: "error",
      });
    return issues;
  }

  /**
   * Reads the on-disk `testrunner-manifest.json` and returns a repair advisory
   * when its version is not exactly {@link TESTRUNNER_MANIFEST_VERSION} OR when
   * the stamped browsers differ from the current settings (browser-selection drift).
   * Any non-equal version is a repair signal: null/older = a runner from an older
   * Test Hub; NEWER = a vault repaired by a newer plugin then opened here
   * (downgrade / Obsidian Sync). A missing or mismatched browsers stamp on an
   * otherwise-current manifest also triggers repair (US-055). Warn, never blocking.
   */
  private async manifestAdvisory(
    runnerAbs: string,
    settingsBrowsers: readonly string[],
  ): Promise<RunnerValidationIssue | null> {
    const manifestRead = await this.absoluteFs.readAbsolute(
      `${runnerAbs}/${TESTRUNNER_MANIFEST_FILE}`,
    );
    const content = manifestRead.ok ? manifestRead.value : undefined;
    const manifestVersion = parseManifestVersion(content);
    if (manifestVersion !== TESTRUNNER_MANIFEST_VERSION) {
      return {
        code: "RUNNER_MANIFEST_OUTDATED",
        severity: "warning",
        message:
          "The .testrunner is outdated (version or browser selection changed) — run Repair to update.",
      };
    }
    // Version is current — check for browser-selection drift (order-insensitive).
    const stampedBrowsers = parseManifestBrowsers(content);
    if (stampedBrowsers === undefined) {
      // Current manifests always stamp browsers; missing = generated by an older build.
      return {
        code: "RUNNER_MANIFEST_OUTDATED",
        severity: "warning",
        message:
          "The .testrunner is outdated (version or browser selection changed) — run Repair to update.",
      };
    }
    const sorted = (arr: readonly string[]) => [...arr].sort().join(",");
    if (sorted(stampedBrowsers) !== sorted(settingsBrowsers)) {
      return {
        code: "RUNNER_MANIFEST_OUTDATED",
        severity: "warning",
        message:
          "The .testrunner is outdated (version or browser selection changed) — run Repair to update.",
      };
    }
    return null;
  }

  async validateCiReadiness(settings: TestHubSettings): Promise<CiReadinessResult> {
    // US-041 / UC-020: a pragmatic, I/O-light pre-flight that a developer can
    // run before pushing — does the repo hold everything a vanilla CI checkout
    // needs to install and run the standalone runner (ADR-0006)?
    const base = await this.absoluteFs.getVaultBasePath();
    const missingItems: string[] = [];
    const warnings: string[] = [];

    // V1 only generates/validates GitHub Actions (PipelineGenerationService
    // refuses other providers). For azure-devops / none, the GitHub workflow
    // checks below are meaningless, so report not-ready rather than passing on a
    // stale `.github/workflows/e2e.yml` (UC-019/020).
    if (settings.ci.provider !== "github-actions") {
      missingItems.push(
        `CI provider "${settings.ci.provider}" is not supported in V1 (only "github-actions").`,
      );
    }

    if (!base.ok) {
      missingItems.push("Vault base path could not be resolved.");
    } else {
      const root = base.value.replace(/[/\\]$/, "");
      // The generated workflow + a CI checkout use POSIX separators, so a
      // Windows-configured `e2e\runner` is checked out at `e2e/runner`.
      // Normalize before probing or the readiness check would report the
      // runner files missing even though the workflow points at the real folder.
      const runnerRel = settings.paths.testRunnerPath.replace(/\\/g, "/");
      const runnerAbs = `${root}/${runnerRel}`;
      await this.collectCiRunnerItems(settings, runnerRel, runnerAbs, missingItems, warnings);
      await this.collectCiWorkflowItems(settings, root, missingItems, warnings);
    }

    // The generated workflow ALWAYS sets BASE_URL from `${{ vars.E2E_BASE_URL }}`
    // (ADR-0011), never from local settings — so CI runs with an empty BASE_URL
    // unless that repository variable exists, regardless of the local active URL.
    // We can't read CI variables, so always warn to set it.
    warnings.push(
      "Ensure repository variable E2E_BASE_URL is set; CI reads BASE_URL from it, not from local settings (ADR-0011).",
    );
    const active = settings.sut.environments[settings.sut.active];
    if (!active?.baseUrl.trim()) {
      warnings.push("Active environment has no local BASE_URL configured.");
    }
    // The workflow injects every auth.env key configured across environments as
    // `${{ secrets.<KEY> }}` (ADR-0014). We can't read CI secrets, so warn that
    // each must exist as a repository secret or authenticated suites run with
    // empty credentials despite a ready report.
    const authKeys = [
      ...new Set(
        Object.values(settings.sut.environments).flatMap((e) => Object.keys(e.auth?.env ?? {})),
      ),
    ].sort();
    if (authKeys.length > 0) {
      warnings.push(
        `Set repository secrets for configured auth credentials: ${authKeys.join(", ")} (ADR-0014).`,
      );
    }
    if (!settings.ci.nodeVersion.trim()) warnings.push("CI Node version is empty.");

    const result: CiReadinessResult = { ready: missingItems.length === 0, missingItems, warnings };
    // Event Catalog payload: { ready, missingItems } (UC-020).
    await this.eventBus.publish(
      createEvent("ci.readiness.checked", {
        ready: result.ready,
        missingItems: result.missingItems,
      }),
    );
    return result;
  }

  /**
   * Probes the runner project a CI checkout installs and runs (US-041/UC-020):
   * the managed files, package.json + its CI script, and the install lockfile.
   * Extracted from {@link validateCiReadiness} so that function stays a flat
   * sequence of probes; pushes onto the shared `missingItems`/`warnings`.
   */
  private async collectCiRunnerItems(
    settings: TestHubSettings,
    runnerRel: string,
    runnerAbs: string,
    missingItems: string[],
    warnings: string[],
  ): Promise<void> {
    // The runner project must exist and be committable (US-042 standalone).
    if (!(await this.absoluteFs.existsAbsolute(runnerAbs))) {
      missingItems.push(`Runner folder is missing at ${runnerRel}.`);
    }
    // The CI `test:ci` script runs `bddgen && playwright test` against the
    // generated config, so a runner missing any managed file (playwright.config.ts,
    // paths, tsconfig) fails CI immediately. Verify the same files
    // the local validator checks (package.json is asserted in detail below).
    for (const file of VALIDATED_RUNNER_FILES) {
      if (file === "package.json") continue;
      if (!(await this.absoluteFs.existsAbsolute(`${runnerAbs}/${file}`))) {
        missingItems.push(`Runner file ${file} is missing (the CI test:ci script needs it).`);
      }
    }
    // package.json + the npm script the generated CI job invokes (US-041/
    // UC-020). The job runs the configured `runner.ciRunCommand` (default
    // `npm run test:ci`). Only validate a package script when that command
    // actually parses as `npm run <script>`; a custom non-npm command (e.g.
    // `npx playwright test …`) doesn't depend on a package script, so skip it.
    const effectiveCiCommand = settings.runner.ciRunCommand.trim() || "npm run test:ci";
    // Generate CI Workflow refuses commands that aren't a shell-safe npm
    // ci/run shape, so readiness must flag the same ones rather than
    // green-light a config the generator would reject.
    // Generation requires the run command to invoke an npm SCRIPT (not an
    // install), so readiness must flag the same — npmRunScript returns null
    // for a non-`npm run` command, which also leaves the script unverified.
    if (
      !isSafeCiCommand(effectiveCiCommand, this.commandSafety) ||
      npmRunScript(effectiveCiCommand) === null
    ) {
      missingItems.push(
        `CI run command "${effectiveCiCommand}" is not supported by Generate CI Workflow.`,
      );
    }
    await this.collectCiPackageScriptItem(
      runnerAbs,
      npmRunScript(effectiveCiCommand),
      effectiveCiCommand,
      missingItems,
    );
    // Lockfile: required only by an install command that needs one. The
    // default `npm ci` fails without it (US-041), but a runner configured to
    // use e.g. `npm install --no-package-lock` doesn't, so don't reject that
    // valid CI config.
    const effectiveCiInstall = settings.runner.ciInstallCommand.trim() || "npm ci";
    if (!isSafeCiCommand(effectiveCiInstall, this.commandSafety)) {
      missingItems.push(
        `CI install command "${effectiveCiInstall}" is not supported by Generate CI Workflow.`,
      );
    }
    if (
      isNpmCiCommand(effectiveCiInstall) &&
      !(await this.absoluteFs.existsAbsolute(`${runnerAbs}/package-lock.json`))
    ) {
      missingItems.push("Runner package-lock.json is missing (npm ci needs a lockfile).");
    }
    // node_modules being committed defeats `npm ci`; warn rather than block.
    if (await this.absoluteFs.existsAbsolute(`${runnerAbs}/node_modules`)) {
      warnings.push("Runner node_modules is present; ensure it is git-ignored, not committed.");
    }
  }

  /**
   * Verifies the runner package.json exists and (when the CI command is an
   * `npm run <script>`) carries that script. Split out of
   * {@link collectCiRunnerItems} to keep the JSON parse/IO branching isolated.
   */
  private async collectCiPackageScriptItem(
    runnerAbs: string,
    ciScript: string | null,
    effectiveCiCommand: string,
    missingItems: string[],
  ): Promise<void> {
    const pkgPath = `${runnerAbs}/package.json`;
    if (!(await this.absoluteFs.existsAbsolute(pkgPath))) {
      missingItems.push("Runner package.json is missing.");
      return;
    }
    if (ciScript === null) return;
    const pkg = await this.absoluteFs.readAbsolute(pkgPath);
    if (!pkg.ok) {
      // Couldn't read it (permissions / transient I/O) — can't confirm the
      // CI script, so don't silently report ready.
      missingItems.push("Runner package.json could not be read to verify the CI script.");
      return;
    }
    try {
      const parsed = JSON.parse(pkg.value) as { scripts?: Record<string, unknown> };
      if (typeof parsed.scripts?.[ciScript] !== "string") {
        missingItems.push(
          `Runner package.json has no "${ciScript}" script (the CI job runs ${effectiveCiCommand}).`,
        );
      }
    } catch {
      missingItems.push("Runner package.json is not valid JSON.");
    }
  }

  /**
   * Validates the generated GitHub Actions workflow (path shape, existence, and
   * drift) a CI run discovers (UC-019 → UC-020). Extracted from
   * {@link validateCiReadiness}; pushes onto the shared `missingItems`/`warnings`.
   */
  private async collectCiWorkflowItems(
    settings: TestHubSettings,
    root: string,
    missingItems: string[],
    warnings: string[],
  ): Promise<void> {
    // The CI workflow itself must have been generated (UC-019 → UC-020).
    // Generation normalizes `\`→`/` before writing (so a Windows-configured
    // `.github\workflows\e2e.yml` is written to the POSIX path GitHub finds);
    // normalize here too or the readiness probe would miss the generated file.
    const workflowRel = settings.ci.workflowPath.replace(/\\/g, "/");
    // Generation refuses a traversal/absolute workflowPath (it would write
    // outside the repo); reject it here too rather than probing outside the
    // vault and possibly reporting ready for a path Generate CI Workflow won't
    // accept.
    if (
      workflowRel.trim() === "" ||
      workflowRel.startsWith("/") ||
      /^[A-Za-z]:/.test(workflowRel) ||
      workflowRel.split("/").includes("..")
    ) {
      missingItems.push(
        `CI workflow path is invalid (must be repo-relative, no ".."): ${workflowRel}.`,
      );
      return;
    }
    if (!/^\.github\/workflows\/[^/]+\.ya?ml$/.test(workflowRel)) {
      // GitHub Actions only discovers `.yml`/`.yaml` files directly under
      // `.github/workflows/`; anything else never runs even if it exists
      // (matches generation's rule).
      missingItems.push(
        `CI workflow must be a .yml/.yaml file under ".github/workflows/" to be discovered by Actions: ${workflowRel}.`,
      );
      return;
    }
    if (!(await this.absoluteFs.existsAbsolute(`${root}/${workflowRel}`))) {
      missingItems.push(`CI workflow not generated at ${workflowRel}.`);
      return;
    }
    // The workflow exists, but settings (runner path, CI commands, node
    // version, auth keys) may have changed since it was generated, leaving a
    // stale working-directory/command that fails in Actions. Compare it to
    // what generation would write now and warn (not block) if it drifted.
    const existing = await this.absoluteFs.readAbsolute(`${root}/${workflowRel}`);
    if (existing.ok && existing.value !== buildGitHubActionsWorkflow(settings)) {
      warnings.push(
        "CI workflow is out of date with current settings; re-run Generate CI Workflow.",
      );
    }
  }

  private async finish(
    correlationId: string | undefined,
    result: RunnerValidationResult,
  ): Promise<RunnerValidationResult> {
    await this.eventBus.publish(
      createEvent(
        "testrunner.validated",
        {
          nodeAvailable: result.nodeAvailable,
          packageManagerAvailable: result.packageManagerAvailable,
          playwrightAvailable: result.playwrightAvailable,
          browsersInstalled: result.browsersInstalled,
        },
        { correlationId },
      ),
    );
    return result;
  }

  private async commandSucceeds(args: string[], cwd: string): Promise<boolean> {
    // argv spawned without a shell (the PR #7 rework to argv arrays).
    if (!this.commandSafety.assertSafe(args).ok) return false;
    const result = await this.process.run({ args, cwd });
    return result.ok && result.value.exitCode === 0;
  }

  private async detectBrowsers(
    runnerAbs: string,
    browsers: readonly BrowserName[],
  ): Promise<boolean> {
    // Require every selected browser to have a cache entry (AD-5, US-055).
    // Previously only Chromium was checked; now the selected browser set drives
    // validation so a firefox-only or webkit-only install is correctly accepted.
    const found = new Set<string>();
    for (const candidate of playwrightBrowsersCandidates(this.platform, this.env, runnerAbs)) {
      const entries = await this.absoluteFs.listAbsolute(candidate);
      for (const browser of browsers) {
        if (entries.some((entry) => entry.toLowerCase().startsWith(browser))) found.add(browser);
      }
    }
    return browsers.every((browser) => found.has(browser));
  }
}
