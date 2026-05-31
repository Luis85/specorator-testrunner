import { resolveRunnerCwd } from "./runner-paths";
import type { SettingsService } from "./settings-service";
import type { SuiteService } from "./suite-service";
import type { AbsoluteFileSystem } from "../ports/absolute-file-system";
import type { ChildProcessRunner } from "../ports/child-process-runner";
import type { ExecutionScope, TestRun } from "../../domain/entities/test-run";
import type { CommandSafetyPolicy } from "../../domain/policies/command-safety-policy";
import type { TestHubSettings } from "../../domain/settings/settings";
import type { RunId } from "../../domain/value-objects/identifiers";
import { appError } from "../../shared/errors/errors";
import { createEvent } from "../../shared/event-bus/create-event";
import type { EventBus } from "../../shared/event-bus/event-bus";
import type { Logger } from "../../shared/logging/logger";
import { err, ok, type Result } from "../../shared/result/result";
import { relativeVaultPath } from "../../shared/utils/vault-path";

/** Test execution contract (TIS §8.10). */
export interface TestExecutionService {
  execute(request: ExecuteTestRequest): Promise<Result<TestRun>>;
  cancel(runId: RunId): Promise<Result<void>>;
  /** Id of the single active run per ADR-0018, or `null` when idle. */
  activeRunId(): RunId | null;
}

export interface ExecuteTestRequest {
  scope: ExecutionScope;
  target: string; // id or path of the scoped entity
}

/** In-flight run state: the single active run per ADR-0018, plus its EN-2 guard. */
interface ActiveRun {
  run: TestRun;
  /** True once a terminal event (completed/failed/cancelled) has been published. */
  terminated: boolean;
}

/** UTC `RUN-YYYY-MM-DD-HHMMSS` id (TIS §3.3). */
const runId = (now: Date): RunId => {
  const iso = now.toISOString(); // 2026-06-01T10:00:00.000Z
  const [date, time] = iso.split("T");
  return `RUN-${date}-${time.slice(0, 8).replace(/:/g, "")}`;
};

/**
 * Drives the runner subprocess and translates its lifecycle into `testrun.*`
 * events (TIS §8.10, UC-011/012/013/014/015).
 *
 * Invariants:
 * - ADR-0018: at most one active run; `execute()` returns `RUN_IN_PROGRESS`
 *   (with `details.activeRunId`) while one is in flight.
 * - EN-2: exactly one terminal event per run — `testrun.completed`,
 *   `testrun.failed` (errored), or `testrun.cancelled` — enforced by the
 *   {@link ActiveRun.terminated} guard so a cancel racing completion cannot
 *   double-emit.
 *
 * Result counts (`TestRunResult`) are imported from the Cucumber report in
 * EPIC-008; here `result` stays undefined and status is derived from the exit
 * code. `env` is left minimal (process-inherited) — Active-Environment env
 * injection (ADR-0013/0014, TIS §13) arrives with SUT environment management.
 */
export class DefaultTestExecutionService implements TestExecutionService {
  private active: ActiveRun | null = null;

  constructor(
    private readonly settingsService: SettingsService,
    private readonly suiteService: SuiteService,
    private readonly childProcess: ChildProcessRunner,
    private readonly absoluteFs: AbsoluteFileSystem,
    private readonly commandSafety: CommandSafetyPolicy,
    private readonly eventBus: EventBus,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  activeRunId(): RunId | null {
    return this.active?.run.id ?? null;
  }

  async execute(request: ExecuteTestRequest): Promise<Result<TestRun>> {
    // ADR-0018: reject overlapping runs; caller must cancel(activeRunId) first.
    if (this.active) {
      return err(
        appError("RUN_IN_PROGRESS", "A test run is already in progress.", {
          details: { activeRunId: this.active.run.id },
        }),
      );
    }

    const settings = await this.settingsService.load();

    const command = await this.resolveCommand(request, settings);
    if (!command.ok) return err(command.error);

    // Defense in depth (TIS §14.2): V1 targets come from trusted vault data,
    // but the tag expression / feature paths are interpolated, so screen the
    // resolved string before it reaches a shell.
    const safe = this.commandSafety.assertSafe(command.value);
    if (!safe.ok) return err(safe.error);

    const cwd = await resolveRunnerCwd(this.absoluteFs, settings.paths.testRunnerPath);
    if (!cwd.ok) return err(cwd.error);

    const startedAt = this.now();
    const run: TestRun = {
      id: runId(startedAt),
      scope: request.scope,
      target: request.target,
      status: "running",
      startedAt: startedAt.toISOString(),
      command: command.value,
      workingDirectory: settings.paths.testRunnerPath,
      reportPaths: {},
    };
    const activeRun: ActiveRun = { run, terminated: false };
    this.active = activeRun;

    await this.publish("testrun.requested", run.id, {
      scope: request.scope,
      target: request.target,
    });
    await this.publish("testrun.started", run.id, {
      runId: run.id,
      command: run.command,
      workingDirectory: run.workingDirectory,
    });
    this.logger.info("Test run started", { runId: run.id, scope: run.scope });

    try {
      const result = await this.childProcess.runStreaming(
        { command: command.value, cwd: cwd.value, env: {} },
        (output) => {
          void this.publish("testrun.output.received", run.id, {
            runId: run.id,
            stream: output.stream,
            line: output.line,
          });
        },
      );

      // A cancel that landed mid-flight already published the terminal event.
      if (activeRun.terminated) return ok(run);

      if (!result.ok) {
        // Spawn fault (crash / missing dependency): errored, never completed.
        run.status = "errored";
        this.finish(run, startedAt);
        await this.terminal(activeRun, "testrun.failed", {
          runId: run.id,
          reason: result.error.message,
        });
        return ok(run);
      }

      const { exitCode } = result.value;
      run.status = exitCode === 0 ? "passed" : "failed";
      this.finish(run, startedAt, result.value.durationMs);

      if (run.scope === "suite") {
        // UC-013 supporting event, before the terminal event.
        await this.publish("suite.executed", run.id, {
          suiteId: run.target,
          runId: run.id,
        });
      }

      await this.terminal(activeRun, "testrun.completed", {
        runId: run.id,
        status: run.status,
        durationMs: run.durationMs ?? 0,
        passed: 0,
        failed: 0,
        skipped: 0,
      });
      return ok(run);
    } finally {
      // Single-active model: clear the slot once this run settles, but never
      // stomp a newer run (cancel resolves the slot before runStreaming returns).
      if (this.active === activeRun) this.active = null;
    }
  }

  async cancel(runId: RunId): Promise<Result<void>> {
    const activeRun = this.active;
    if (!activeRun || activeRun.run.id !== runId) {
      return err(
        appError("RUN_CANCELLED", `No active test run with id "${runId}" to cancel.`, {
          details: { requestedRunId: runId, activeRunId: activeRun?.run.id },
        }),
      );
    }

    // Single active process per ADR-0018: the runId is the process handle.
    const cancelled = await this.childProcess.cancel(runId);
    if (!cancelled.ok) return err(cancelled.error);

    activeRun.run.status = "cancelled";
    this.finish(activeRun.run, new Date(activeRun.run.startedAt));
    await this.terminal(activeRun, "testrun.cancelled", { runId });
    this.logger.info("Test run cancelled", { runId });

    // Free the slot now so the next execute() can start without awaiting the
    // (already-cancelled) child's runStreaming promise to settle.
    if (this.active === activeRun) this.active = null;
    return ok(undefined);
  }

  /** Resolves the runner command for a scope (TIS §13.2). */
  private async resolveCommand(
    request: ExecuteTestRequest,
    settings: TestHubSettings,
  ): Promise<Result<string>> {
    switch (request.scope) {
      case "demo":
        return ok("npm run test:smoke");
      case "all":
        return ok("npm run test");
      case "suite": {
        const tags = await this.suiteService.resolveTagExpression(request.target);
        if (!tags.ok) return err(tags.error);
        return ok(`npm run test -- --tags "${tags.value}"`);
      }
      case "feature":
        return ok(`npm run test -- ${this.featureArg(settings, request.target)}`);
      case "use-case":
        return ok(
          `npm run test -- ${this.featurePrefix(settings)}/${request.target}-*.feature`,
        );
    }
  }

  /** Runner-relative path to a single Feature file (TIS §13.2 `feature`). */
  private featureArg(settings: TestHubSettings, target: string): string {
    const prefix = settings.paths.featureFilesPath;
    // Accept a vault path or a bare basename; reduce to the file relative to
    // the configured features folder, then re-anchor to the runner cwd.
    const basename = target.startsWith(`${prefix}/`)
      ? target.slice(prefix.length + 1)
      : target.split("/").pop() ?? target;
    return `${this.featurePrefix(settings)}/${basename}`;
  }

  /** Runner-cwd-relative features folder, e.g. `../Specifications/features`. */
  private featurePrefix(settings: TestHubSettings): string {
    return relativeVaultPath(settings.paths.testRunnerPath, settings.paths.featureFilesPath);
  }

  private finish(run: TestRun, startedAt: Date, durationMs?: number): void {
    const finishedAt = this.now();
    run.finishedAt = finishedAt.toISOString();
    run.durationMs = durationMs ?? finishedAt.getTime() - startedAt.getTime();
  }

  /** Publishes a terminal event once, honouring the EN-2 single-terminal guard. */
  private async terminal(
    activeRun: ActiveRun,
    type: "testrun.completed" | "testrun.failed" | "testrun.cancelled",
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (activeRun.terminated) return;
    activeRun.terminated = true;
    await this.publish(type, activeRun.run.id, payload);
  }

  /** Stamps `correlationId = runId` so a run's events group (Event Catalog §correlation). */
  private publish(
    type: Parameters<typeof createEvent>[0],
    correlationId: RunId,
    payload: Record<string, unknown>,
  ): Promise<void> {
    return this.eventBus.publish(createEvent(type, payload, { correlationId }));
  }
}
