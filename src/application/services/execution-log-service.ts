import type { SettingsService } from "./settings-service";
import type { AbsoluteFileSystem } from "../ports/absolute-file-system";
import { isTestRunStatus, type TestRun } from "../../domain/entities/test-run";
import {
  prependCapped,
  toExecutionLogEntry,
  type ExecutionLogEntry,
} from "../../domain/entities/execution-log";
import { runnerHistoryFilePath } from "./runner-history-path";
import { HISTORY_DEPTH_DEFAULT } from "../../domain/settings/settings";
import { appError } from "../../shared/errors/errors";
import type { Logger } from "../../shared/logging/logger";
import { err, ok, type Result } from "../../shared/result/result";
import { SerialQueue } from "../../shared/async/serial-queue";

/** File name of the durable execution log under `<testRunnerPath>/history`. */
const LOG_FILE_NAME = "execution-log.json";

/**
 * Shape guard for a persisted log element. The file is a regenerable,
 * hand-editable projection, so a parsed array may hold a malformed item — this
 * keeps only entries whose CONSUMED fields are sound: the `runId` the dedupe in
 * {@link prependCapped} keys on, plus the `status` and `finishedAt` the last-run
 * line projects. A partial entry like `{ "runId": "RUN-X" }` would otherwise pass
 * and make `projectLastRun` throw on an `undefined` status (codex P2). The
 * remaining fields (scope/target/durationMs/result) are carried through unread,
 * so they are not validated here — a stricter check would reject benign
 * forward-compatible fields.
 */
const isExecutionLogEntry = (value: unknown): value is ExecutionLogEntry =>
  typeof value === "object" &&
  value !== null &&
  "runId" in value &&
  typeof value.runId === "string" &&
  "status" in value &&
  isTestRunStatus(value.status) &&
  "finishedAt" in value &&
  typeof value.finishedAt === "string" &&
  value.finishedAt !== "";

/**
 * The durable execution log (E1, ADR-0032). Records every terminal run —
 * independent of evidence — so a later read can serve an honest "last run"
 * verdict the evidence-derived history sources cannot (they skip runs that
 * produced no evidence: an `errored` spawn fault or a `cancelled` run).
 *
 * The read path ships with its consumer (the Overview health hero's last-run
 * verdict, E1 PR2): {@link latest} reads the newest recorded entry so no export
 * is dead.
 */
export interface ExecutionLogService {
  /** Records a terminal run into the durable log. Best-effort; never rejects. */
  record(run: TestRun): Promise<Result<void>>;
  /**
   * The newest recorded entry (the head of the newest-first log), or `null` when
   * the log is absent, empty, or unreadable. Tolerant: a missing/corrupt/non-array
   * file reads as `null` rather than rejecting — the log is a regenerable
   * projection, so the hero degrades to "no last run" rather than erroring.
   */
  latest(): Promise<ExecutionLogEntry | null>;
  /**
   * Resolves when every enqueued log write has settled. Maintenance (reset/repair)
   * drains this UNDER the maintenance lock before it deletes/re-syncs the runner
   * folder, so a fire-and-forget write from the previous run cannot re-materialise
   * `<runner>/history/execution-log.json` after the runtime was removed — mirroring
   * the post-run import drain (ADR-0032).
   */
  whenSettled(): Promise<void>;
}

/**
 * {@link AbsoluteFileSystem}-backed {@link ExecutionLogService}. The log is a
 * single newest-first JSON array at
 * `<vaultBase>/<settings.paths.testRunnerPath>/history/execution-log.json`,
 * capped at {@link HISTORY_DEPTH_DEFAULT}.
 *
 * It uses the ABSOLUTE filesystem, not the vault filesystem, because the log
 * lives under `.testrunner` — a dot-folder Obsidian does NOT index. The vault
 * adapter's `writeFile` resolves an existing unindexed file as `null` (no
 * `TFile`) and falls through to `create`, which throws on an existing path, so
 * every record after the first would fail. The regenerable
 * `scenario-index.json` read model writes through the same absolute path for
 * exactly this reason (DefaultScenarioHistoryService).
 *
 * Each {@link record} is a read-modify-write serialized through one
 * {@link SerialQueue} so back-to-back terminal runs cannot clobber each other's
 * append. Best-effort throughout: a missing or corrupt file reads as empty
 * (logged `warn`), and a write fault returns `err` without throwing.
 */
export class DefaultExecutionLogService implements ExecutionLogService {
  // Back-to-back runs each read-modify-write the same file; serialize so the
  // second record sees the first's write rather than the pre-record state.
  private readonly queue = new SerialQueue();

  constructor(
    private readonly settingsService: SettingsService,
    private readonly absoluteFs: AbsoluteFileSystem,
    private readonly logger: Logger,
  ) {}

  async record(run: TestRun): Promise<Result<void>> {
    return this.queue.run(() => this.recordInternal(run));
  }

  /** Drains the write queue (see {@link ExecutionLogService.whenSettled}). */
  whenSettled(): Promise<void> {
    return this.queue.whenSettled();
  }

  async latest(): Promise<ExecutionLogEntry | null> {
    // Read THROUGH the same queue as record(), so a latest() triggered by the
    // terminal-event refresh observes the just-enqueued (fire-and-forget) write
    // rather than the pre-write head. For an `errored`/`cancelled`-no-report run
    // there is no later dashboard refresh to correct a stale read (codex P2).
    return this.queue.run(() => this.latestInternal());
  }

  private async latestInternal(): Promise<ExecutionLogEntry | null> {
    const path = await this.logPath();
    // No vault base path (non-desktop): there is nowhere the log could live.
    if (path === undefined) return null;
    // Reuse the SAME tolerant read `record` uses (absent/corrupt/non-array →
    // empty), so the read path can't drift from the write path's parse rules.
    const entries = await this.readLog(path);
    return entries[0] ?? null;
  }

  private async recordInternal(run: TestRun): Promise<Result<void>> {
    const path = await this.logPath();
    if (path === undefined) {
      // No vault base path (non-desktop): there is nowhere to write the log.
      this.logger.warn("Execution log path unavailable; skipping record", { runId: run.id });
      return err(appError("EVIDENCE_WRITE_FAILED", "Could not resolve the execution log path."));
    }
    const existing = await this.readLog(path);
    const next = prependCapped(existing, toExecutionLogEntry(run), HISTORY_DEPTH_DEFAULT);

    // writeAbsolute creates the `history` ancestor chain (mkdir -p) and OVERWRITES
    // an existing file — the behaviour the unindexed `.testrunner` path needs.
    const written = await this.absoluteFs.writeAbsolute(path, JSON.stringify(next, null, 2));
    if (!written.ok) {
      this.logger.warn("Could not write execution log", {
        runId: run.id,
        reason: written.error.message,
      });
      return err(
        appError("EVIDENCE_WRITE_FAILED", "Could not write the execution log.", {
          cause: written.error,
        }),
      );
    }
    return ok(undefined);
  }

  /**
   * Reads the log, tolerating an absent OR corrupt file by treating it as empty
   * (logged `warn`) — the log is an append-only projection, so a partial/hand-
   * edited blob must not error a record, just start the list fresh. Each element
   * is validated by {@link isExecutionLogEntry} so a malformed entry is dropped
   * rather than poisoning a later re-record's dedupe.
   */
  private async readLog(path: string): Promise<ExecutionLogEntry[]> {
    if (!(await this.absoluteFs.existsAbsolute(path))) return []; // no file yet — start empty
    const read = await this.absoluteFs.readAbsolute(path);
    if (!read.ok) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(read.value);
    } catch {
      this.logger.warn("Execution log was unparseable; treating as empty", { path });
      return [];
    }
    if (!Array.isArray(parsed)) {
      this.logger.warn("Execution log was not an array; treating as empty", { path });
      return [];
    }
    return parsed.filter(isExecutionLogEntry);
  }

  /** `<vaultBase>/<testRunnerPath>/history/execution-log.json` (or `undefined`). */
  private logPath(): Promise<string | undefined> {
    return runnerHistoryFilePath(this.absoluteFs, this.settingsService, LOG_FILE_NAME);
  }
}
