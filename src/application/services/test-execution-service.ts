import { resolveRunnerCwd } from "./runner-paths";
import type { SettingsService } from "./settings-service";
import type { SuiteService } from "./suite-service";
import type { UseCaseService } from "./use-case-service";
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

/**
 * Renders an argv as a human-readable display string for `TestRun.command` and
 * the `testrun.started` event. The runner spawns these args with `shell: false`
 * (the PR #7 decision to rework the runner to argv arrays), so this is for
 * display only — args with spaces are quoted purely for readability, never to
 * survive a shell (TIS §13.2).
 */
const displayCommand = (args: string[]): string =>
  args.map((arg) => (arg.includes(" ") ? `"${arg}"` : arg)).join(" ");

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
 * code. The runner env is built from the Active SUT environment (ADR-0013/0014).
 */
export class DefaultTestExecutionService implements TestExecutionService {
  private active: ActiveRun | null = null;
  // De-dupe run ids within the same UTC second (the id has 1s resolution): the
  // first run keeps the clean id; later same-second runs get a -2/-3/… suffix.
  private lastIdBase: RunId | null = null;
  private idSeq = 0;

  constructor(
    private readonly settingsService: SettingsService,
    private readonly suiteService: SuiteService,
    private readonly useCaseService: UseCaseService,
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

    // Reserve the active slot SYNCHRONOUSLY — before any await — so a second
    // execute() racing in cannot also pass the guard above and start a second
    // process (ADR-0018 single active run). Details are filled in after setup.
    const startedAt = this.now();
    const run: TestRun = {
      id: this.mintRunId(startedAt),
      scope: request.scope,
      target: request.target,
      status: "running",
      startedAt: startedAt.toISOString(),
      command: "",
      workingDirectory: "",
      reportPaths: {},
    };
    const activeRun: ActiveRun = { run, terminated: false };
    this.active = activeRun;

    try {
      const settings = await this.settingsService.load();
      run.workingDirectory = settings.paths.testRunnerPath;

      const command = await this.resolveCommand(request, settings);
      if (!command.ok) return err(command.error);
      const argv = command.value;

      // Defense in depth (TIS §14.2): V1 targets come from trusted vault data;
      // validate the argv (allowed program, no control chars) before spawning.
      // The args are literal under shell: false, so tags/paths with $, & or
      // spaces no longer need quoting and are no longer false-rejected (PR #7).
      const safe = this.commandSafety.assertSafe(argv);
      if (!safe.ok) return err(safe.error);

      const cwd = await resolveRunnerCwd(this.absoluteFs, settings.paths.testRunnerPath);
      if (!cwd.ok) return err(cwd.error);
      // Human-readable display string; the runner is given the raw argv below.
      run.command = displayCommand(argv);

      // A cancel() during setup (settings/command/cwd resolution) already
      // published testrun.cancelled and freed the slot — bail before emitting
      // run events or spawning an untracked process.
      if (activeRun.terminated) return ok(run);

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

      const result = await this.childProcess.runStreaming(
        { args: argv, cwd: cwd.value, env: this.runEnv(settings) },
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

    // Deliberately DO NOT free the slot here: childProcess.cancel() only sends
    // SIGTERM and returns before the runner has actually exited, so a process
    // can still be writing the shared reports dir. The slot is released by
    // execute()'s finally when runStreaming settles (the real close event), so
    // the next run can't overlap a still-terminating one (ADR-0018).
    return ok(undefined);
  }

  /**
   * Builds the runner subprocess env from the Active SUT environment
   * (ADR-0013/0014): `BASE_URL` plus any `auth.env` credentials, injected
   * verbatim. The host process env is merged by the ChildProcessRunner adapter.
   */
  /** Unique run id: clean per-second base, then `-N` for same-second repeats. */
  private mintRunId(now: Date): RunId {
    const base = runId(now);
    if (base === this.lastIdBase) {
      this.idSeq += 1;
      return `${base}-${this.idSeq}`;
    }
    this.lastIdBase = base;
    this.idSeq = 1;
    return base;
  }

  private runEnv(settings: TestHubSettings): Record<string, string> {
    const active = settings.sut.environments[settings.sut.active];
    if (!active) return {};
    return { BASE_URL: active.baseUrl, ...(active.auth?.env ?? {}) };
  }

  /**
   * Resolves the runner argv for a scope (TIS §13.2). Returns a literal argv —
   * tags and feature paths are appended verbatim (AD-4, no quoting/escaping):
   * under shell: false they are passed through as-is, so a path with `$`, `&`,
   * or spaces survives unchanged (the PR #7 decision to rework to argv arrays).
   */
  private async resolveCommand(
    request: ExecuteTestRequest,
    settings: TestHubSettings,
  ): Promise<Result<string[]>> {
    switch (request.scope) {
      case "demo":
        return ok(["npm", "run", "test:smoke"]);
      case "all":
        return ok(["npm", "run", "test"]);
      case "suite": {
        const tags = await this.suiteService.resolveTagExpression(request.target);
        if (!tags.ok) return err(tags.error);
        // Verbatim tag expression as a single literal arg (AD-4, no quoting).
        return ok(["npm", "run", "test", "--", "--tags", tags.value]);
      }
      case "feature":
        // Literal feature path arg; no shell, so no escaping needed.
        return ok(["npm", "run", "test", "--", this.featureArg(settings, request.target)]);
      case "use-case": {
        // UC-011: target the Use Case's declared featureFiles in order, each as
        // a separate literal arg. Falls back to the <UC-id>-*.feature glob when
        // the UC or its links can't be resolved (e.g. a brand-new UC with the
        // standard naming); the glob is expanded by cucumber-js, not a shell.
        const found = await this.useCaseService.findById(request.target);
        const featureFiles = found.ok && found.value ? found.value.featureFiles : [];
        if (featureFiles.length > 0) {
          return ok([
            "npm",
            "run",
            "test",
            "--",
            ...featureFiles.map((path) => this.featureArg(settings, path)),
          ]);
        }
        return ok([
          "npm",
          "run",
          "test",
          "--",
          `${this.featurePrefix(settings)}/${request.target}-*.feature`,
        ]);
      }
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
