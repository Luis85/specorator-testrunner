import { resolveRunnerCwd } from "./runner-paths";
import type { SettingsService } from "./settings-service";
import type { SuiteService } from "./suite-service";
import type { UseCaseService } from "./use-case-service";
import type { AbsoluteFileSystem } from "../ports/absolute-file-system";
import type { ChildProcessRunner } from "../ports/child-process-runner";
import type { ExecutionScope, TestRun } from "../../domain/entities/test-run";
import type { CommandSafetyPolicy } from "../../domain/policies/command-safety-policy";
import type { DomainEventType, EventPayloads } from "../../domain/events/domain-event";
import { collectCredentialValues, type TestHubSettings } from "../../domain/settings/settings";
import type { RunId } from "../../domain/value-objects/identifiers";
import { unsafeVaultPath } from "../../domain/value-objects/vault-path";
import { appError } from "../../shared/errors/errors";
import { createEvent } from "../../shared/event-bus/create-event";
import type { EventBus } from "../../shared/event-bus/event-bus";
import type { Logger } from "../../shared/logging/logger";
import { redactSecrets } from "../../shared/logging/redact";
import { err, ok, type Result } from "../../shared/result/result";
import { joinVaultPath, relativeVaultPath } from "../../shared/utils/vault-path";

/** Test execution contract (TIS §8.10). */
export interface TestExecutionService {
  execute(request: ExecuteTestRequest): Promise<Result<TestRun>>;
  cancel(runId: RunId): Promise<Result<void>>;
  /** Id of the single active run per ADR-0018, or `null` when idle. */
  activeRunId(): RunId | null;
  /**
   * ISO start time of the active run, or `null` when idle. Lets a Test Console
   * opened MID-run seed its elapsed timer from the real start instead of the
   * moment the view opened (C6/CQ10).
   */
  activeRunStartedAt(): string | null;
  /**
   * The most recently finished run this session, or `null` before the first run
   * completes. Lets the {@link PostRunCoordinator} (and the "Import report for
   * last run" command) obtain the just-finished run without reconstructing it.
   * ADR-0018 guarantees a single active run, and the bus awaits terminal-event
   * handlers synchronously during publish, so this is stable when the
   * coordinator's terminal-event handler reads it.
   */
  lastRun(): TestRun | null;
  /**
   * Resolves when the active run's process has actually closed (or immediately
   * when idle). Lets the UI cancel-and-wait on unload without tracking the run
   * promise itself.
   */
  whenActiveSettles(): Promise<void>;
  /**
   * Synchronous mutual-exclusion handle the maintenance flows (reset/repair)
   * acquire so a run cannot start while `.testrunner`/settings are being
   * mutated, and vice-versa. See {@link MaintenanceLock}.
   */
  readonly maintenanceLock: MaintenanceLock;
}

/**
 * Synchronous lock that mutually excludes maintenance (UC-003 repair / UC-024
 * reset) and test runs, closing the reset/run TOCTOU (security review L1).
 *
 * Both directions are check-then-act races without it: `reset()`/`repair()`
 * historically checked `activeRunId() !== null` then `await`-ed, and a `runTest`
 * issued in that gap could reserve the single-run slot while maintenance
 * proceeded to mutate `.testrunner`. The lock is consulted/mutated SYNCHRONOUSLY
 * (no `await` between check and set) on both sides, so there is no window:
 *
 * - {@link begin} fails if a run is active OR maintenance is already in
 *   progress, and otherwise flips the flag before any caller `await`.
 * - {@link TestExecutionService.execute} reads {@link inProgress} synchronously
 *   before it reserves its slot and returns `MAINTENANCE_IN_PROGRESS` if set.
 */
export interface MaintenanceLock {
  /** True while a maintenance flow holds the lock. */
  inProgress(): boolean;
  /**
   * Acquires the lock synchronously. Returns `RUN_IN_PROGRESS` if a run is
   * active, or `MAINTENANCE_IN_PROGRESS` if another maintenance flow already
   * holds it. On success the caller MUST pair it with {@link end} in a finally.
   */
  begin(): Result<void>;
  /** Releases the lock. Safe to call when not held. */
  end(): void;
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
  /**
   * True once the runner process has actually closed. cancel() refuses after
   * this point: the run is already finishing (only best-effort snapshot I/O
   * remains before the terminal event), so a late cancel must not relabel a
   * completed/failed run as cancelled.
   */
  processClosed: boolean;
  /** Resolves when `execute()` settles (runner process closed) — for unload. */
  completion: Promise<void>;
  settle: () => void;
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

/**
 * Tokenizes a configured runner command into argv with shell-style quoting, so
 * a value like `npm run test -- --format "json:reports/cucumber report.json"`
 * keeps the quoted path as ONE argument (the runner spawns with `shell: false`,
 * so a naive whitespace split would hand Cucumber broken `"json:reports/cucumber`
 * + `report.json"` tokens). Single quotes are literal; double quotes allow `\"`
 * and `\\`. An UNquoted backslash is kept literal so Windows path arguments
 * (e.g. `json:C:\tmp\cucumber.json`) survive — it never escapes outside quotes.
 */
export const tokenizeCommand = (command: string): string[] => {
  const tokens: string[] = [];
  let current: string | null = null;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (
        quote === '"' &&
        ch === "\\" &&
        (command[i + 1] === '"' || command[i + 1] === "\\")
      ) {
        current = (current ?? "") + command[++i];
      } else current = (current ?? "") + ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current = current ?? "";
    } else if (/\s/.test(ch)) {
      if (current !== null) tokens.push(current);
      current = null;
    } else current = (current ?? "") + ch;
  }
  if (current !== null) tokens.push(current);
  return tokens;
};

/** Tokenizes a configured runner command string into argv, or the fallback if blank. */
const toArgv = (command: string, fallback: string[]): string[] => {
  const parts = tokenizeCommand(command);
  return parts.length > 0 ? parts : fallback;
};

/**
 * Appends scoped runner args (tags / feature paths) to a base command. npm uses
 * a single `npm run <script> [-- <args>]` separator, so if the configured base
 * already forwards args with `--`, append after it rather than inserting a
 * second `--` (npm forwards the first; a second would reach Cucumber as a
 * literal end-of-options token and swallow the following `--tags`/paths).
 */
export const appendScopedArgs = (base: string[], scoped: string[]): string[] =>
  base.includes("--") ? [...base, ...scoped] : [...base, "--", ...scoped];

/**
 * A test-execution command must be an `npm run <script>` form (TIS §13.2).
 * CommandSafetyPolicy also accepts install/probe commands (`npm install`,
 * `node --version`, `npx playwright install …`) because validation/maintenance
 * need them, so the run path needs this stricter, context-specific check —
 * otherwise a synced/edited `defaultRunCommand` could make a non-test command
 * exit 0 and be reported as a passing run.
 */
const isNpmRun = (argv: string[]): boolean => {
  const program = (argv[0]?.split(/[/\\]/).pop() ?? "").replace(/\.(exe|cmd)$/i, "");
  return program === "npm" && argv[1] === "run";
};

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
  // The most recently FINISHED run (terminal event published), exposed via
  // lastRun() so the post-run coordinator and the manual re-import command can
  // read the just-finished run without reconstructing it from event payloads.
  private lastFinishedRun: TestRun | null = null;
  // De-dupe run ids within the same UTC second (the id has 1s resolution): the
  // first run keeps the clean id; later same-second runs get a -2/-3/… suffix.
  private lastIdBase: RunId | null = null;
  private idSeq = 0;
  // Set synchronously while a maintenance flow (reset/repair) holds the lock.
  // execute() reads it before reserving its slot so a run started concurrently
  // with maintenance is rejected with MAINTENANCE_IN_PROGRESS (security L1).
  private maintenanceActive = false;

  readonly maintenanceLock: MaintenanceLock = {
    inProgress: () => this.maintenanceActive,
    begin: () => {
      // Reject if a run is active: maintenance must not mutate `.testrunner`
      // under a live runner (the existing ADR-0018 / P0-3 guard).
      if (this.active) {
        return err(
          appError("RUN_IN_PROGRESS", "A test run is in progress.", {
            details: { activeRunId: this.active.run.id },
          }),
        );
      }
      if (this.maintenanceActive) {
        return err(
          appError("MAINTENANCE_IN_PROGRESS", "A maintenance operation is already in progress."),
        );
      }
      // Synchronous check-then-set: no await between the guards above and this
      // assignment, so a run racing in cannot slip through (security L1 TOCTOU).
      this.maintenanceActive = true;
      return ok(undefined);
    },
    end: () => {
      this.maintenanceActive = false;
    },
  };

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

  activeRunStartedAt(): string | null {
    return this.active?.run.startedAt ?? null;
  }

  lastRun(): TestRun | null {
    return this.lastFinishedRun;
  }

  whenActiveSettles(): Promise<void> {
    return this.active?.completion ?? Promise.resolve();
  }

  async execute(request: ExecuteTestRequest): Promise<Result<TestRun>> {
    // Maintenance (reset/repair) and runs are mutually exclusive (security L1).
    // Read the lock SYNCHRONOUSLY here — before reserving the slot below and
    // before any await — so a run started in the gap between reset()'s active-
    // run check and its mutations cannot reserve the slot (TOCTOU close).
    if (this.maintenanceLock.inProgress()) {
      return err(
        appError(
          "MAINTENANCE_IN_PROGRESS",
          "A maintenance operation is in progress; try again once it completes.",
        ),
      );
    }
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
      // Placeholder filled in below once setup resolves the runner directory.
      workingDirectory: unsafeVaultPath(""),
      reportPaths: {},
    };
    let settle!: () => void;
    const completion = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const activeRun: ActiveRun = {
      run,
      terminated: false,
      processClosed: false,
      completion,
      settle,
    };
    this.active = activeRun;
    // True once `testrun.started` has been published — the catch below must
    // know whether the UI ever saw this run begin (see the catch comment).
    let started = false;

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
      // Delete any prior report so a run that fails BEFORE producing one (bad
      // config, missing deps, glob miss) can't have a previous run's stale
      // report imported and attributed to it (the path is fixed, no run id).
      // deleteAbsolute uses force (an absent file is ok); a real failure
      // (locked/read-only) must abort setup, or the stale report survives and
      // defeats the very cleanup this performs.
      const cleared = await this.absoluteFs.deleteAbsolute(
        `${cwd.value}/reports/cucumber-report.json`,
      );
      if (!cleared.ok) return err(cleared.error);
      // Human-readable display string; the runner is given the raw argv below.
      run.command = displayCommand(argv);

      // A cancel() during setup (settings/command/cwd resolution) already
      // published testrun.cancelled and freed the slot — bail before emitting
      // run events or spawning an untracked process.
      if (activeRun.terminated) return ok(run);

      await this.publish("testrun.requested", run.id, {
        // The catalog's `testrun.requested.scope` is the four public scopes; the
        // internal "demo" scope (a smoke run over demo content) surfaces as
        // "suite" on the bus, which is the suite it executes.
        scope: request.scope === "demo" ? "suite" : request.scope,
        target: request.target,
      });
      await this.publish("testrun.started", run.id, {
        runId: run.id,
        command: run.command,
        workingDirectory: run.workingDirectory,
      });
      started = true;
      this.logger.info("Test run started", { runId: run.id, scope: run.scope });

      // Awaiting the requested/started publishes yields the event loop, so a
      // cancel() can land here after they resolve. Re-check before spawning so
      // we never start an untracked runner the UI already saw as cancelled.
      if (activeRun.terminated) return ok(run);

      // Redact the live console too (security review M1): the runner can echo a
      // configured `auth.env` credential into stdout/stderr (e.g. a login error),
      // so scrub each streamed line with the SAME ADR-0019 helper the Logger uses
      // before publishing testrun.output.received. The secret set is built ONCE
      // per run from the active settings; an empty set makes redactSecrets a
      // no-op pass-through, so a run with no credentials keeps the hot path cheap.
      const runSecrets = new Set(collectCredentialValues(settings));
      const result = await this.childProcess.runStreaming(
        { args: argv, cwd: cwd.value, env: this.runEnv(settings), processId: run.id },
        (output) => {
          void this.publish("testrun.output.received", run.id, {
            runId: run.id,
            stream: output.stream,
            line: redactSecrets(output.line, runSecrets),
          });
        },
      );

      // A cancel that landed mid-flight already published the terminal event.
      // The cancelled process may still have flushed a partial Cucumber report,
      // so snapshot it to reports/<runId>.json before returning — otherwise the
      // (now slot-free) cancelled-run import would race a new run's cleanup of
      // the fixed report and lose/mis-attribute that evidence.
      if (activeRun.terminated) {
        await this.snapshotReport(run, cwd.value);
        return ok(run);
      }
      // The process has closed: from here only best-effort snapshot I/O remains
      // before the terminal event. Mark it so a cancel() racing that I/O window
      // can't relabel this finished run as cancelled.
      activeRun.processClosed = true;

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

      await this.snapshotReport(run, cwd.value);

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
    } catch (cause) {
      // A non-Result throw (a rejecting settings load, an adapter bug) after
      // `testrun.started` would otherwise emit NO terminal event — the console
      // would show "running" forever with Cancel armed, and the rejection would
      // surface as an unhandled promise in the launching click handler (A2).
      // Route it through the EN-2 terminal guard as an errored run — but ONLY
      // when the UI actually saw the run start AND no terminal event has been
      // published yet: a setup throw before `testrun.started` must surface as a
      // plain error Result (fabricating a terminal lifecycle for a run the
      // console never displayed would flip its banner to "Run failed" out of
      // nowhere), and a run already terminated by a racing cancel() must not
      // have its state relabelled "errored" after the bus reported it terminal.
      const message = cause instanceof Error ? cause.message : String(cause);
      if (started && !activeRun.terminated) {
        run.status = "errored";
        this.finish(run, startedAt);
        await this.terminal(activeRun, "testrun.failed", { runId: run.id, reason: message });
      }
      this.logger.error("Test run threw unexpectedly", cause instanceof Error ? cause : undefined, {
        runId: run.id,
      });
      return err(appError("INIT_FAILED", `Test run failed unexpectedly: ${message}`, { cause }));
    } finally {
      // Single-active model: clear the slot once this run settles, but never
      // stomp a newer run (cancel resolves the slot before runStreaming returns).
      if (this.active === activeRun) this.active = null;
      // Let any unload waiter (whenActiveSettles) know the process has closed.
      activeRun.settle();
    }
  }

  async cancel(runId: RunId): Promise<Result<void>> {
    const activeRun = this.active;
    if (activeRun?.run.id !== runId) {
      return err(
        appError("RUN_CANCELLED", `No active test run with id "${runId}" to cancel.`, {
          details: { requestedRunId: runId, activeRunId: activeRun?.run.id },
        }),
      );
    }
    // The process has already closed (terminal snapshot I/O may still be in
    // flight): the run is effectively complete, so refuse to cancel it rather
    // than relabel a completed/failed run as cancelled and suppress its real
    // terminal event (EN-2).
    if (activeRun.processClosed || activeRun.terminated) {
      return err(
        appError("RUN_CANCELLED", `Test run "${runId}" has already finished; nothing to cancel.`, {
          details: { requestedRunId: runId },
        }),
      );
    }

    // Single active process per ADR-0018: the runId is the process handle.
    const cancelled = await this.childProcess.cancel(runId);
    if (!cancelled.ok) return err(cancelled.error);

    // The await above yielded the event loop: the process may have closed and
    // execute() may have published the run's REAL terminal event in that gap.
    // Re-check before mutating, or a completed/failed run gets relabelled
    // "cancelled" in lastRun()/the console meta after the bus already reported
    // it terminal (A1, EN-2).
    if (activeRun.processClosed || activeRun.terminated) {
      return err(
        appError("RUN_CANCELLED", `Test run "${runId}" finished while cancelling.`, {
          details: { requestedRunId: runId },
        }),
      );
    }

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

  /**
   * Snapshots the fixed Cucumber report to a run-specific path
   * (reports/<runId>.json) BEFORE the active slot frees, so a later run's
   * pre-run cleanup of reports/cucumber-report.json can't delete it while the
   * (passed/failed/cancelled) run's evidence import reads it. Best-effort: a
   * run with no report (e.g. spawn fault) simply leaves reportPaths.json unset.
   */
  private async snapshotReport(run: TestRun, cwd: string): Promise<void> {
    const liveReport = await this.absoluteFs.readAbsolute(`${cwd}/reports/cucumber-report.json`);
    if (!liveReport.ok) return;
    const snapshot = await this.absoluteFs.writeAbsolute(
      `${cwd}/reports/${run.id}.json`,
      liveReport.value,
    );
    if (snapshot.ok) {
      run.reportPaths.json = joinVaultPath(run.workingDirectory, "reports", `${run.id}.json`);
    }
  }

  private runEnv(settings: TestHubSettings): Record<string, string> {
    // Object.hasOwn, not a truthy index: an active named "toString"/
    // "constructor" with no such environment defined would otherwise resolve a
    // prototype member (truthy) and build the env from `undefined` fields.
    if (!Object.hasOwn(settings.sut.environments, settings.sut.active)) return {};
    const active = settings.sut.environments[settings.sut.active];
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
    // Honor the user's configured runner commands (a wrapper script, extra
    // Cucumber flags, a different npm script). Scoped runs append their args
    // after the configured base command's tokens (TIS §13.2).
    const base = toArgv(settings.runner.defaultRunCommand, ["npm", "run", "test"]);
    if (!isNpmRun(base)) {
      return err(
        appError(
          "VALIDATION_FAILED",
          `Configured run command must be "npm run <script>": "${settings.runner.defaultRunCommand}".`,
        ),
      );
    }
    switch (request.scope) {
      case "demo": {
        const smoke = toArgv(settings.runner.smokeRunCommand, ["npm", "run", "test:smoke"]);
        if (!isNpmRun(smoke)) {
          return err(
            appError(
              "VALIDATION_FAILED",
              `Configured smoke command must be "npm run <script>": "${settings.runner.smokeRunCommand}".`,
            ),
          );
        }
        return ok(smoke);
      }
      case "all": {
        // ADR-0012: a Use Case with status "deprecated" excludes all of its
        // Features from Run All. The bare `base` runs the runner's config glob
        // over every feature file, so when any UC is deprecated we instead pass
        // the explicit union of the NON-deprecated UCs' feature files (every
        // feature in this system is generated from a UC, so that union is "all
        // features minus the retired ones"). With no deprecated UCs we keep the
        // cheap glob. If the UC index can't be read we fall back to the glob
        // rather than silently running nothing.
        const all = await this.useCaseService.findAll();
        if (all.ok && all.value.some((uc) => uc.status === "deprecated")) {
          const activeFiles = all.value
            .filter((uc) => uc.status !== "deprecated")
            .flatMap((uc) => uc.featureFiles);
          if (activeFiles.length > 0) {
            return ok(
              appendScopedArgs(
                base,
                activeFiles.map((path) => this.featureArg(settings, path)),
              ),
            );
          }
          // Every non-deprecated UC is unautomated (or all UCs are deprecated):
          // there is no active coverage to run, so target a path that matches no
          // feature instead of falling back to the all-features glob.
          return ok(
            appendScopedArgs(base, [
              `${this.featurePrefix(settings)}/__no_active_features__.feature`,
            ]),
          );
        }
        return ok([...base]);
      }
      case "suite": {
        const tags = await this.suiteService.resolveTagExpression(request.target);
        if (!tags.ok) return err(tags.error);
        // Verbatim tag expression as a single literal arg (AD-4, no quoting).
        return ok(appendScopedArgs(base, ["--tags", tags.value]));
      }
      case "feature":
        // Literal feature path arg; no shell, so no escaping needed.
        return ok(appendScopedArgs(base, [this.featureArg(settings, request.target)]));
      case "use-case": {
        // UC-011: target the Use Case's declared featureFiles in order, each as
        // a separate literal arg. Falls back to the <UC-id>-*.feature glob when
        // the UC or its links can't be resolved (e.g. a brand-new UC with the
        // standard naming); the glob is expanded by cucumber-js, not a shell.
        const found = await this.useCaseService.findById(request.target);
        const featureFiles = found.ok && found.value ? found.value.featureFiles : [];
        if (featureFiles.length > 0) {
          return ok(
            appendScopedArgs(
              base,
              featureFiles.map((path) => this.featureArg(settings, path)),
            ),
          );
        }
        return ok(
          appendScopedArgs(base, [`${this.featurePrefix(settings)}/${request.target}-*.feature`]),
        );
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
      : (target.split("/").pop() ?? target);
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
  private async terminal<T extends "testrun.completed" | "testrun.failed" | "testrun.cancelled">(
    activeRun: ActiveRun,
    type: T,
    payload: EventPayloads[T],
  ): Promise<void> {
    if (activeRun.terminated) return;
    activeRun.terminated = true;
    // Record the just-finished run BEFORE publishing the terminal event so a
    // subscriber (the PostRunCoordinator) reading lastRun() inside its
    // synchronously-awaited handler sees this run, not the previous one.
    this.lastFinishedRun = activeRun.run;
    await this.publish(type, activeRun.run.id, payload);
  }

  /** Stamps `correlationId = runId` so a run's events group (Event Catalog §correlation). */
  private publish<T extends DomainEventType>(
    type: T,
    correlationId: RunId,
    payload: EventPayloads[T],
  ): Promise<void> {
    return this.eventBus.publish(createEvent(type, payload, { correlationId }));
  }
}
