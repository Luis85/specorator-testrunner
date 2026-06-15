import type { AbsoluteFileSystem } from "../ports/absolute-file-system";
import type { ChildProcessRunner } from "../ports/child-process-runner";
import {
  REQUIRED_RUNNER_DEPENDENCIES,
  TESTRUNNER_MANIFEST_FILE,
  TESTRUNNER_MANIFEST_VERSION,
  VALIDATED_RUNNER_FILES,
} from "../content/runner-manifest";
import { parseManifestVersion, parseManifestBrowsers } from "../content/runner-manifest-version";
import { playwrightBrowsersCandidates } from "./runner-paths";
import type { SettingsService } from "./settings-service";
import { assessCiReadiness, type CiReadinessResult } from "./ci-readiness";
import type { CommandSafetyPolicy } from "../../domain/policies/command-safety-policy";
import type { BrowserName, TestHubSettings } from "../../domain/settings/settings";
import { createEvent } from "../../shared/event-bus/create-event";
import type { EventBus } from "../../shared/event-bus/event-bus";

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

export type { CiReadinessResult };

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
   * for one of two DISTINCT conditions (both warnings, never blocking):
   *
   *  - `RUNNER_MANIFEST_OUTDATED` — the manifest version is not exactly
   *    {@link TESTRUNNER_MANIFEST_VERSION}: null/older = a runner from an older
   *    Test Hub; NEWER = a vault repaired by a newer plugin then opened here
   *    (downgrade / Obsidian Sync). The generated runtime SHAPE changed, so
   *    {@link MaintenanceService.repair} must reinstall dependencies (and, for a
   *    genuine V1 runner, clean-cut).
   *  - `RUNNER_BROWSERS_OUTDATED` — the version is current but the stamped
   *    browser set differs from settings (order-insensitive), or the stamp is
   *    missing on a current manifest (older build of this version). Repair heals
   *    this via its unconditional `createRunner` (re-stamp + regenerate the baked
   *    config/scripts) + `installBrowsers`, with NO dependency reinstall.
   *
   * Keeping the codes separate is deliberate: repair keys its (offline-fragile)
   * `npm install` on the version code, so a browser-only change must NOT reuse it
   * or a browser-only repair would fail offline despite healthy node_modules.
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
        message: "The .testrunner is outdated (Test Hub version changed) — run Repair to update.",
      };
    }
    // Version is current — flag browser-selection drift (order-insensitive), or a
    // missing stamp from an older build of this version, as its OWN code.
    const stampedBrowsers = parseManifestBrowsers(content);
    const sorted = (arr: readonly string[]) => [...arr].sort().join(",");
    if (stampedBrowsers === undefined || sorted(stampedBrowsers) !== sorted(settingsBrowsers)) {
      return {
        code: "RUNNER_BROWSERS_OUTDATED",
        severity: "warning",
        message: "The .testrunner browser selection is out of date — run Repair to update.",
      };
    }
    return null;
  }

  async validateCiReadiness(settings: TestHubSettings): Promise<CiReadinessResult> {
    const result = await assessCiReadiness(settings, {
      absoluteFs: this.absoluteFs,
      commandSafety: this.commandSafety,
    });
    // Event Catalog payload: { ready, missingItems } (UC-020).
    await this.eventBus.publish(
      createEvent("ci.readiness.checked", {
        ready: result.ready,
        missingItems: result.missingItems,
      }),
    );
    return result;
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
