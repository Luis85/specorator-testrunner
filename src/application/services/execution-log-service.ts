import type { SettingsService } from "./settings-service";
import type { VaultFileSystem } from "../ports/vault-file-system";
import type { TestRun } from "../../domain/entities/test-run";
import {
  prependCapped,
  toExecutionLogEntry,
  type ExecutionLogEntry,
} from "../../domain/entities/execution-log";
import type { VaultPath } from "../../domain/value-objects/identifiers";
import { unsafeVaultPath } from "../../domain/value-objects/vault-path";
import { HISTORY_DEPTH_DEFAULT } from "../../domain/settings/settings";
import { appError } from "../../shared/errors/errors";
import type { Logger } from "../../shared/logging/logger";
import { err, ok, type Result } from "../../shared/result/result";
import { SerialQueue } from "../../shared/async/serial-queue";
import { joinVaultPath } from "../../shared/utils/vault-path";

/** File name of the durable execution log under `<testRunnerPath>/history`. */
const LOG_FILE_NAME = "execution-log.json";

/**
 * Minimal shape guard for a persisted log element. The file is a regenerable,
 * hand-editable projection, so a parsed array may hold a malformed item; this
 * keeps only objects carrying the `runId` the dedupe in {@link prependCapped}
 * keys on. Entries are otherwise carried through unread, so a stricter check
 * would reject benign forward-compatible fields.
 */
const isExecutionLogEntry = (value: unknown): value is ExecutionLogEntry =>
  typeof value === "object" &&
  value !== null &&
  "runId" in value &&
  typeof value.runId === "string";

/**
 * The durable execution log (E1, ADR-0032). Records every terminal run —
 * independent of evidence — so a later read can serve an honest "last run"
 * verdict the evidence-derived history sources cannot (they skip runs that
 * produced no evidence: an `errored` spawn fault or a `cancelled` run).
 *
 * THIS increment is record-only; the read path (`latest`/`list`) ships with its
 * consumer in a follow-up so no export is dead.
 */
export interface ExecutionLogService {
  /** Records a terminal run into the durable log. Best-effort; never rejects. */
  record(run: TestRun): Promise<Result<void>>;
}

/**
 * Vault-file-backed {@link ExecutionLogService}. The log is a single newest-first
 * JSON array at `<settings.paths.testRunnerPath>/history/execution-log.json`,
 * capped at {@link HISTORY_DEPTH_DEFAULT}. Each {@link record} is a read-modify-
 * write serialized through one {@link SerialQueue} so back-to-back terminal runs
 * cannot clobber each other's append (mirroring DefaultScenarioHistoryService).
 * Best-effort throughout: a missing or corrupt file reads as empty (logged
 * `warn`), and a write fault returns `err` without throwing.
 */
export class DefaultExecutionLogService implements ExecutionLogService {
  // Back-to-back runs each read-modify-write the same file; serialize so the
  // second record sees the first's write rather than the pre-record state.
  private readonly queue = new SerialQueue();

  constructor(
    private readonly settingsService: SettingsService,
    private readonly vaultFs: VaultFileSystem,
    private readonly logger: Logger,
  ) {}

  async record(run: TestRun): Promise<Result<void>> {
    return this.queue.run(() => this.recordInternal(run));
  }

  private async recordInternal(run: TestRun): Promise<Result<void>> {
    const settings = await this.settingsService.load();
    const path = this.logPath(settings.paths.testRunnerPath);
    const existing = await this.readLog(path);
    const next = prependCapped(existing, toExecutionLogEntry(run), HISTORY_DEPTH_DEFAULT);

    // Ensure the `history` folder exists before writing — the VaultFileSystem
    // adapter creates the ancestor chain (mirrors DefaultScenarioHistoryService).
    const folder = unsafeVaultPath(path.slice(0, path.lastIndexOf("/")));
    const folderCreated = await this.vaultFs.createFolder(folder);
    if (!folderCreated.ok) {
      this.logger.warn("Could not create execution log folder", {
        runId: run.id,
        reason: folderCreated.error.message,
      });
      return err(
        appError("EVIDENCE_WRITE_FAILED", "Could not create the execution log folder.", {
          cause: folderCreated.error,
        }),
      );
    }

    const written = await this.vaultFs.writeFile(path, JSON.stringify(next, null, 2));
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
  private async readLog(path: VaultPath): Promise<ExecutionLogEntry[]> {
    const read = await this.vaultFs.readFile(path);
    if (!read.ok) return []; // no file yet (fresh vault) — start empty
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

  /** `<testRunnerPath>/history/execution-log.json`. */
  private logPath(testRunnerPath: VaultPath): VaultPath {
    return joinVaultPath(testRunnerPath, "history", LOG_FILE_NAME);
  }
}
