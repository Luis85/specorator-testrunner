import { buildRunnerTemplates } from "../content/runner-templates";
import type { AbsoluteFileSystem } from "../ports/absolute-file-system";
import type {
  ChildProcessRunner,
  RunnerCommandResult,
} from "../ports/child-process-runner";
import type { TemplateWriter } from "../ports/template-writer";
import { resolveRunnerCwd } from "./runner-paths";
import type { CommandSafetyPolicy } from "../../domain/policies/command-safety-policy";
import type { TestHubSettings } from "../../domain/settings/settings";
import type { VaultPath } from "../../domain/value-objects/identifiers";
import { appError, type ErrorCode } from "../../shared/errors/errors";
import { createEvent } from "../../shared/event-bus/create-event";
import type { EventBus } from "../../shared/event-bus/event-bus";
import type { Logger } from "../../shared/logging/logger";
import { err, ok, type Result } from "../../shared/result/result";

/** Runner installation contract (TIS §8.2). */
export interface RunnerInstallationService {
  createRunner(settings: TestHubSettings): Promise<Result<RunnerInstallationResult>>;
  installDependencies(settings: TestHubSettings): Promise<Result<RunnerCommandResult>>;
  installBrowsers(settings: TestHubSettings): Promise<Result<RunnerCommandResult>>;
}

export interface RunnerInstallationResult {
  runnerPath: VaultPath;
  createdFiles: VaultPath[];
}

export class DefaultRunnerInstallationService implements RunnerInstallationService {
  constructor(
    private readonly templates: TemplateWriter,
    private readonly process: ChildProcessRunner,
    private readonly absoluteFs: AbsoluteFileSystem,
    private readonly commandSafety: CommandSafetyPolicy,
    private readonly eventBus: EventBus,
    private readonly logger: Logger,
  ) {}

  async createRunner(settings: TestHubSettings): Promise<Result<RunnerInstallationResult>> {
    const runnerPath = settings.paths.testRunnerPath;
    const written = await this.templates.writeTemplates({
      targetPath: runnerPath,
      templates: buildRunnerTemplates(settings),
    });
    if (!written.ok) {
      return err(
        appError("INIT_FAILED", "Could not write the .testrunner project.", {
          cause: written.error,
        }),
      );
    }

    await this.eventBus.publish(
      createEvent("testrunner.installed", { runnerPath, packageManager: "npm" }),
    );
    this.logger.info("Runner project created", {
      runnerPath,
      files: written.value.writtenFiles.length,
    });
    return ok({ runnerPath, createdFiles: written.value.writtenFiles });
  }

  installDependencies(settings: TestHubSettings): Promise<Result<RunnerCommandResult>> {
    return this.spawnInRunner(
      settings,
      settings.runner.installCommand,
      "NPM_INSTALL_FAILED",
      "dependency installation",
    );
  }

  installBrowsers(settings: TestHubSettings): Promise<Result<RunnerCommandResult>> {
    return this.spawnInRunner(
      settings,
      settings.runner.browserInstallCommand,
      "BROWSER_NOT_INSTALLED",
      "browser installation",
    );
  }

  /** Resolves the runner cwd, guards the argv, spawns, and maps exit codes. */
  private async spawnInRunner(
    settings: TestHubSettings,
    command: string,
    failureCode: ErrorCode,
    label: string,
  ): Promise<Result<RunnerCommandResult>> {
    // The trusted settings command (e.g. "npm install") is a simple space-
    // separated string; split it into a literal argv spawned without a shell
    // (the PR #7 decision to rework the runner to argv arrays).
    const args = command.trim().split(/\s+/);
    const safe = this.commandSafety.assertSafe(args);
    if (!safe.ok) return err(safe.error);

    const cwd = await resolveRunnerCwd(this.absoluteFs, settings.paths.testRunnerPath);
    if (!cwd.ok) return err(cwd.error);

    const result = await this.process.run({ args, cwd: cwd.value });
    if (!result.ok) {
      return err(appError(failureCode, `Failed to start ${label}.`, { cause: result.error }));
    }
    if (result.value.exitCode !== 0) {
      // Route the child's stderr through the redacting logger so any credential
      // value the tool echoed is scrubbed (ADR-0019 / P0-2), and truncate it so
      // a runaway error log can't flood the console.
      this.logger.error(`${label} exited non-zero`, undefined, {
        exitCode: result.value.exitCode,
        stderr: result.value.stderr.slice(0, 2000),
      });
      return err(
        appError(failureCode, `${label} failed (exit ${result.value.exitCode}).`, {
          details: { exitCode: result.value.exitCode, stderr: result.value.stderr },
        }),
      );
    }
    return ok(result.value);
  }
}
