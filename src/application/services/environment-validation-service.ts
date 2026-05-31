import type { AbsoluteFileSystem } from "../ports/absolute-file-system";
import type { ChildProcessRunner } from "../ports/child-process-runner";
import { VALIDATED_RUNNER_FILES } from "../content/runner-templates";
import { playwrightBrowsersCandidates, resolveRunnerCwd } from "./runner-paths";
import type { SettingsService } from "./settings-service";
import type { CommandSafetyPolicy } from "../../domain/policies/command-safety-policy";
import type { TestHubSettings } from "../../domain/settings/settings";
import { createEvent } from "../../shared/event-bus/create-event";
import type { EventBus } from "../../shared/event-bus/event-bus";
import { ok, type Result } from "../../shared/result/result";

/** Environment + CI validation contract (TIS §8.3, UC-002 / UC-020). */
export interface EnvironmentValidationService {
  validateEnvironment(): Promise<RunnerValidationResult>;
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
  browsersInstalled: boolean; // Chromium per AD-5
  issues: RunnerValidationIssue[];
}

export interface RunnerValidationIssue {
  code: string;
  message: string;
  severity: "error" | "warning" | "info";
}

export interface CiReadinessResult {
  ready: boolean;
  missingItems: string[];
  warnings: string[];
}

export class DefaultEnvironmentValidationService
  implements EnvironmentValidationService
{
  constructor(
    private readonly settingsService: SettingsService,
    private readonly process: ChildProcessRunner,
    private readonly absoluteFs: AbsoluteFileSystem,
    private readonly commandSafety: CommandSafetyPolicy,
    private readonly eventBus: EventBus,
    private readonly env: Record<string, string | undefined> = {},
    private readonly platform: string = "linux",
  ) {}

  async validateEnvironment(): Promise<RunnerValidationResult> {
    const settings = await this.settingsService.load();
    const base = await this.absoluteFs.getVaultBasePath();
    const issues: RunnerValidationIssue[] = [];

    if (!base.ok) {
      issues.push({ code: "VAULT_PATH_UNKNOWN", message: base.error.message, severity: "error" });
      return this.finish({
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
    const cwd = (await resolveRunnerCwd(this.absoluteFs, settings.paths.testRunnerPath)) as {
      ok: true;
      value: string;
    };

    const nodeAvailable = await this.commandSucceeds(
      `${settings.runner.nodeExecutable} --version`,
      base.value,
    );
    const packageManagerAvailable = await this.commandSucceeds("npm --version", base.value);
    const runnerFolderExists = await this.absoluteFs.existsAbsolute(runnerAbs);
    const missingFiles: string[] = [];
    for (const file of VALIDATED_RUNNER_FILES) {
      if (!(await this.absoluteFs.existsAbsolute(`${runnerAbs}/${file}`))) missingFiles.push(file);
    }
    const packageJsonExists = !missingFiles.includes("package.json");
    const runnerFilesComplete = runnerFolderExists && missingFiles.length === 0;
    const dependenciesInstalled = await this.absoluteFs.existsAbsolute(`${runnerAbs}/node_modules`);
    const playwrightAvailable =
      dependenciesInstalled &&
      (await this.commandSucceeds("npx playwright --version", cwd.value));
    const browsersInstalled = await this.detectBrowsers(runnerAbs);

    if (!nodeAvailable)
      issues.push({ code: "NODE_MISSING", message: "Node.js is not available.", severity: "error" });
    if (!packageManagerAvailable)
      issues.push({ code: "NPM_MISSING", message: "npm is not available.", severity: "error" });
    if (!runnerFolderExists)
      issues.push({ code: "RUNNER_MISSING_FILE", message: "The .testrunner folder is missing.", severity: "error" });
    else
      for (const file of missingFiles)
        issues.push({ code: "RUNNER_MISSING_FILE", message: `.testrunner/${file} is missing.`, severity: "error" });
    if (!dependenciesInstalled)
      issues.push({ code: "DEPENDENCIES_MISSING", message: "Runner dependencies are not installed.", severity: "error" });
    else if (!playwrightAvailable)
      issues.push({ code: "PLAYWRIGHT_MISSING", message: "Playwright is installed but not runnable.", severity: "error" });
    if (!browsersInstalled)
      issues.push({ code: "BROWSER_NOT_INSTALLED", message: "Chromium is not installed.", severity: "error" });

    const valid =
      nodeAvailable &&
      packageManagerAvailable &&
      runnerFolderExists &&
      runnerFilesComplete &&
      dependenciesInstalled &&
      playwrightAvailable &&
      browsersInstalled;

    return this.finish({
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

  async validateCiReadiness(settings: TestHubSettings): Promise<CiReadinessResult> {
    const base = await this.absoluteFs.getVaultBasePath();
    const missingItems: string[] = [];
    const warnings: string[] = [];

    if (!base.ok) {
      missingItems.push("Vault base path could not be resolved.");
    } else {
      const root = base.value.replace(/[/\\]$/, "");
      if (!(await this.absoluteFs.existsAbsolute(`${root}/${settings.ci.workflowPath}`))) {
        missingItems.push(`CI workflow not generated at ${settings.ci.workflowPath}.`);
      }
      if (!(await this.absoluteFs.existsAbsolute(`${root}/${settings.paths.testRunnerPath}/package.json`))) {
        missingItems.push("Runner package.json is missing.");
      }
    }
    if (!settings.ci.nodeVersion.trim()) warnings.push("CI Node version is empty.");

    const result: CiReadinessResult = { ready: missingItems.length === 0, missingItems, warnings };
    await this.eventBus.publish(createEvent("ci.readiness.checked", { result }));
    return result;
  }

  private async finish(result: RunnerValidationResult): Promise<RunnerValidationResult> {
    await this.eventBus.publish(
      createEvent("testrunner.validated", {
        nodeAvailable: result.nodeAvailable,
        packageManagerAvailable: result.packageManagerAvailable,
        playwrightAvailable: result.playwrightAvailable,
        browsersInstalled: result.browsersInstalled,
      }),
    );
    return result;
  }

  private async commandSucceeds(command: string, cwd: string): Promise<boolean> {
    if (!this.commandSafety.assertSafe(command).ok) return false;
    const result = await this.process.run({ command, cwd });
    return result.ok && result.value.exitCode === 0;
  }

  private async detectBrowsers(runnerAbs: string): Promise<boolean> {
    // Look for an actual `chromium-*` browser entry, not just the cache root:
    // a partial cache, or one holding only Firefox/WebKit, must NOT count
    // (the runner only ever launches Chromium, AD-5).
    for (const candidate of playwrightBrowsersCandidates(this.platform, this.env, runnerAbs)) {
      const entries = await this.absoluteFs.listAbsolute(candidate);
      if (entries.some((entry) => entry.toLowerCase().startsWith("chromium"))) return true;
    }
    return false;
  }
}
