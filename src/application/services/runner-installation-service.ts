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
      templates: buildRunnerTemplates(),
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

  /** Resolves the runner cwd, guards the command, spawns, and maps exit codes. */
  private async spawnInRunner(
    settings: TestHubSettings,
    command: string,
    failureCode: ErrorCode,
    label: string,
  ): Promise<Result<RunnerCommandResult>> {
    const safe = this.commandSafety.assertSafe(command);
    if (!safe.ok) return err(safe.error);

    const cwd = await resolveRunnerCwd(this.absoluteFs, settings.paths.testRunnerPath);
    if (!cwd.ok) return err(cwd.error);

    const result = await this.process.run({ command, cwd: cwd.value });
    if (!result.ok) {
      return err(appError(failureCode, `Failed to start ${label}.`, { cause: result.error }));
    }
    if (result.value.exitCode !== 0) {
      this.logger.error(`${label} exited non-zero`, undefined, {
        exitCode: result.value.exitCode,
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
