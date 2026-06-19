import { evidenceRunFolder } from "./evidence-paths";
import type { ImportedReport } from "./report-import-service";
import type { SettingsService } from "./settings-service";
import { stripScenarioEvidenceBlock } from "../content/scenario-evidence-block";
import type { AbsoluteFileSystem } from "../ports/absolute-file-system";
import type { VaultFileSystem } from "../ports/vault-file-system";
import type { TestRun } from "../../domain/entities/test-run";
import type { ScenarioLatestStatus } from "../../domain/policies/use-case-automation-policy";
import { computeFlakiness, type ScenarioFlakiness } from "../../domain/policies/scenario-flakiness";
import {
  foldEntry,
  isScenarioIndex,
  lineToEntry,
  SCHEMA_VERSION,
  type HistoryLine,
  type ScenarioIndex,
} from "./scenario-history-index";
import { groupRunFolders, resolveRunEntries } from "./scenario-history-source";
import type { VaultPath } from "../../domain/value-objects/identifiers";
import { unsafeVaultPath } from "../../domain/value-objects/vault-path";
import { HISTORY_DEPTH_DEFAULT } from "../../domain/settings/settings";
import { createEvent } from "../../shared/event-bus/create-event";
import type { EventBus } from "../../shared/event-bus/event-bus";
import type { Logger } from "../../shared/logging/logger";
import { ok, type Result } from "../../shared/result/result";
import { SerialQueue } from "../../shared/async/serial-queue";
import { joinVaultPath } from "../../shared/utils/vault-path";

/**
 * Per-scenario run history (US-057, EPIC-014). The authoritative per-run record
 * stays the Evidence notes (ADR-0022); this service maintains two *rebuildable
 * projections* keyed by Scenario Reference (US-056):
 *
 * 1. A committed, git-mergeable per-run NDJSON log written once per run at
 *    `Test Evidence/YYYY/MM/<runId>/scenarios.ndjson` (ADR-0016 partition) — the
 *    AC's "append-only history".
 * 2. A regenerable `.testrunner/history/scenario-index.json` read model giving
 *    each scenario's latest status + last-N results, consumed by the Use Case
 *    roll-up. Rebuilt from the per-run logs (note block as fallback) on demand.
 *
 * Every operation — `record`, `rebuildIndex` AND the `latestStatuses` /
 * `flakiness` reads — is serialized through a private {@link SerialQueue} (the
 * EPIC-014 §9 "third
 * user") so they can never interleave on the index file. Serializing the read
 * too matters because `main.ts` fires a `rebuildIndex` in the background on
 * load (so a git-pulled history surfaces): a roll-up read must queue BEHIND
 * that in-flight rebuild rather than racing it and returning the stale
 * pre-pull index. Best-effort: faults are logged and returned, never thrown
 * into the post-run pipeline.
 */
export interface ScenarioHistoryService {
  /** Records a finished run's per-scenario results (NDJSON log + index update). */
  record(run: TestRun, report: ImportedReport): Promise<Result<void>>;
  /** Latest status per Scenario Reference for the roll-up; rebuilds if absent. */
  latestStatuses(): Promise<Result<Map<string, ScenarioLatestStatus>>>;
  /**
   * Flakiness score per Scenario Reference over the history window (US-058);
   * rebuilds the index if absent, like {@link latestStatuses}. Scenarios with no
   * history are absent from the map.
   */
  flakiness(): Promise<Result<Map<string, ScenarioFlakiness>>>;
  /** Rebuilds the index by scanning the per-run logs (note block fallback). */
  rebuildIndex(): Promise<Result<void>>;
}

export class DefaultScenarioHistoryService implements ScenarioHistoryService {
  private readonly queue = new SerialQueue();

  /**
   * True when the last {@link writeIndex} failed, so the on-disk cache is stale
   * even if its `root`/`depth` still match. Forces {@link loadFreshIndex} to
   * rebuild and serve the in-memory index until a write succeeds (codex P2).
   */
  private indexWriteFailed = false;

  constructor(
    private readonly settingsService: SettingsService,
    private readonly vaultFs: VaultFileSystem,
    private readonly absoluteFs: AbsoluteFileSystem,
    private readonly eventBus: EventBus,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async record(run: TestRun, report: ImportedReport): Promise<Result<void>> {
    return this.queue.run(() => this.recordInternal(run, report));
  }

  async rebuildIndex(): Promise<Result<void>> {
    return this.queue.run(async () => {
      await this.rebuildInternal();
      return ok(undefined);
    });
  }

  async latestStatuses(): Promise<Result<Map<string, ScenarioLatestStatus>>> {
    // Queued so the read is ordered behind any in-flight record/rebuild (e.g.
    // the load-time rebuild main.ts fires after a git pull) and never observes
    // a stale index mid-rebuild (codex P2).
    return this.queue.run(() => this.latestStatusesInternal());
  }

  async flakiness(): Promise<Result<Map<string, ScenarioFlakiness>>> {
    // Queued for the same reason as latestStatuses: ordered behind any in-flight
    // record/rebuild so it never scores a half-rebuilt index (codex P2).
    return this.queue.run(() => this.flakinessInternal());
  }

  private async latestStatusesInternal(): Promise<Result<Map<string, ScenarioLatestStatus>>> {
    const index = await this.loadFreshIndex();
    const map = new Map<string, ScenarioLatestStatus>();
    if (index) {
      for (const [ref, record] of Object.entries(index.scenarios)) {
        map.set(ref, record.latest.status);
      }
    }
    return ok(map);
  }

  private async flakinessInternal(): Promise<Result<Map<string, ScenarioFlakiness>>> {
    const index = await this.loadFreshIndex();
    const map = new Map<string, ScenarioFlakiness>();
    if (index) {
      for (const [ref, record] of Object.entries(index.scenarios)) {
        map.set(ref, computeFlakiness(record.recent.map((entry) => entry.status)));
      }
    }
    return ok(map);
  }

  /**
   * Returns the current index for a read model, rebuilt when stale. Shared by
   * {@link latestStatusesInternal} and {@link flakinessInternal} so both read the
   * SAME freshly-validated projection. The index is reconstructed from the
   * committed logs when it is absent, was built from a different Evidence root
   * (repointed `paths.evidencePath`), was built at a different history depth, OR a
   * prior index write failed (so the on-disk cache is stale even though its
   * root/depth still match — codex P2). `rebuildInternal` is called directly, NOT
   * the queued `rebuildIndex`: callers already hold the queue slot, so re-entering
   * `queue.run` here would deadlock.
   */
  private async loadFreshIndex(): Promise<ScenarioIndex | null> {
    const settings = await this.settingsService.load();
    const root = this.normalizeRoot(settings.paths.evidencePath);
    const depth = this.depth(settings.automation.historyDepth);
    let index = await this.readIndex();
    if (index?.root !== root || index?.depth !== depth || this.indexWriteFailed) {
      // Serve the freshly rebuilt IN-MEMORY index — it reflects the committed logs
      // even when the disk write failed (read-only `.testrunner` / disk full), so
      // a failed cache write never serves stale data (codex P2). Only fall back to
      // a disk re-read if the rebuild couldn't build (listing failure).
      index = (await this.rebuildInternal()) ?? (await this.readIndex());
      // Still mismatched (e.g. listing failed and the disk cache is stale)? Don't
      // serve it — degrade to empty rather than the previous tree/window.
      if (index?.root !== root || index?.depth !== depth) index = null;
    }
    return index;
  }

  private async recordInternal(run: TestRun, report: ImportedReport): Promise<Result<void>> {
    const settings = await this.settingsService.load();
    const root = this.normalizeRoot(settings.paths.evidencePath);
    const lines = this.buildHistoryLines(run, report);

    if (lines.length === 0) {
      await this.handleZeroRefImport(run, root);
      return ok(undefined);
    }

    // Best-effort: a failed log write degrades the roll-up but never errors, and
    // leaves the index untouched (nothing was committed to fold/rebuild from).
    if (!(await this.writeRunLog(run, root, lines))) return ok(undefined);

    const depth = this.depth(settings.automation.historyDepth);
    await this.updateIndexAfterRecord(run, root, depth, lines);

    await this.eventBus.publish(
      createEvent(
        "scenario.history.recorded",
        { runId: run.id, scenarioCount: lines.length },
        { correlationId: run.id },
      ),
    );
    this.logger.info("Scenario history recorded", { runId: run.id, scenarios: lines.length });
    return ok(undefined);
  }

  /**
   * Projects a finished run's report into per-scenario history lines. Results with
   * no resolved Scenario Reference (US-056 fallback) are shown in the note but NOT
   * aggregated into history (ADR-0022), so they are skipped here.
   */
  private buildHistoryLines(run: TestRun, report: ImportedReport): HistoryLine[] {
    const at = run.finishedAt ?? run.startedAt;
    const lines: HistoryLine[] = [];
    for (const scenario of report.scenarioResults) {
      if (!scenario.scenarioRef) continue;
      lines.push({
        v: SCHEMA_VERSION,
        scenarioRef: scenario.scenarioRef,
        runId: run.id,
        status: scenario.status,
        at,
        ...(scenario.durationMs !== undefined ? { durationMs: scenario.durationMs } : {}),
        scope: run.scope,
      });
    }
    return lines;
  }

  /**
   * Handles an import that resolved zero Scenario References. A RE-import must
   * retract this run's prior contribution; otherwise its old NDJSON log and index
   * entries linger and a later rebuild resurrects the stale results (codex P2).
   * The retraction skips the normal path's `scenario.history.recorded` event, so
   * emit it (count 0) when something was actually retracted — open Use Case views
   * relying on it re-derive even with `updateUseCaseFrontmatterAfterRun` off. A
   * genuine first-time zero-ref run retracts nothing → stay silent so a no-op
   * import doesn't churn the views (codex P2).
   */
  private async handleZeroRefImport(run: TestRun, root: VaultPath): Promise<void> {
    this.logger.info("No scenario references to record for run history", { runId: run.id });
    if (!(await this.retractRun(run, root))) return;
    await this.eventBus.publish(
      createEvent(
        "scenario.history.recorded",
        { runId: run.id, scenarioCount: 0 },
        { correlationId: run.id },
      ),
    );
  }

  /**
   * Writes the committed per-run NDJSON log (write-once; overwrite so a re-import
   * of the same run refreshes its log deterministically). Returns false on a
   * folder/file write failure so the caller skips the index update (best-effort).
   */
  private async writeRunLog(run: TestRun, root: VaultPath, lines: HistoryLine[]): Promise<boolean> {
    const logPath = this.ndjsonPath(run, root);
    const folder = unsafeVaultPath(logPath.slice(0, logPath.lastIndexOf("/")));
    const folderCreated = await this.vaultFs.createFolder(folder);
    if (!folderCreated.ok) {
      this.logger.warn("Could not create scenario history folder", {
        runId: run.id,
        reason: folderCreated.error.message,
      });
      return false;
    }
    const ndjson = lines.map((line) => JSON.stringify(line)).join("\n") + "\n";
    const written = await this.vaultFs.writeFile(logPath, ndjson);
    if (!written.ok) {
      this.logger.warn("Could not write scenario history log", {
        runId: run.id,
        reason: written.error.message,
      });
      return false;
    }
    return true;
  }

  /**
   * Updates the index read model after a successful log write. A FIRST import
   * folds the run in incrementally — the fast steady-state path. A RE-import (the
   * run already contributed), a missing/corrupt index, an index built from a
   * different Evidence root or history depth, OR a prior index write that failed
   * instead rebuilds from the authoritative committed logs (the new log was
   * rewritten above, so it is included). Rebuilding is what keeps re-imports
   * correct: it handles a changed/emptied ref set, restores depth-trimmed older
   * results for a ref this run drops, re-applies a changed depth across ALL refs,
   * and recovers runs whose index write failed — none of which an in-place patch
   * can see (codex P2). A transient listing failure returns null; flag the cache
   * stale so the next read retries rather than serving pre-reimport statuses.
   */
  private async updateIndexAfterRecord(
    run: TestRun,
    root: VaultPath,
    depth: number,
    lines: HistoryLine[],
  ): Promise<void> {
    const existing = await this.readIndex();
    if (
      existing?.root !== root ||
      existing?.depth !== depth ||
      this.indexWriteFailed ||
      this.indexHasRun(existing, run.id)
    ) {
      const rebuilt = await this.rebuildInternal();
      if (!rebuilt) this.indexWriteFailed = true;
      return;
    }
    existing.depth = depth;
    for (const line of lines) foldEntry(existing, line.scenarioRef, lineToEntry(line), depth);
    await this.writeIndex(existing);
  }

  /**
   * Rebuilds the index from the committed logs and returns the freshly built
   * in-memory index — even when the disk write fails — so callers can serve fresh
   * data without re-reading a possibly-stale file (codex P2). Returns `null` only
   * when it could not build (a transient Evidence-listing failure), so the caller
   * falls back to the existing on-disk cache rather than discarding it.
   */
  private async rebuildInternal(): Promise<ScenarioIndex | null> {
    const settings = await this.settingsService.load();
    const root = this.normalizeRoot(settings.paths.evidencePath);
    const depth = this.depth(settings.automation.historyDepth);
    const index: ScenarioIndex = { v: SCHEMA_VERSION, depth, root, scenarios: {} };

    // A fresh/uninitialized vault has no Evidence root yet. Do NOT materialize
    // the index here: the absolute FS would create `.testrunner/history/...`
    // before the user has initialized the Test Hub, dirtying the vault and
    // leaving a partial runner folder for validation to trip over (codex P2).
    // But if an index ALREADY exists (a previously-populated vault whose Evidence
    // root was since deleted or repointed), CLEAR it — otherwise latestStatuses()
    // keeps serving phantom history that no longer exists under the configured
    // root (codex P2). With no history to project, an empty index is correct.
    // An empty root is the VAULT ROOT (configured `evidencePath: "."`); it always
    // exists, so skip the absent-root check and list from the root (codex P2).
    if (root !== "" && !(await this.vaultFs.exists(root))) {
      if (await this.readIndex()) await this.writeIndex(index);
      return index; // empty, current root/depth — there is no history to project
    }
    const listed = await this.vaultFs.listFilesRecursive(root);
    if (!listed.ok) {
      this.logger.warn("Could not list evidence for history rebuild", {
        reason: listed.error.message,
      });
      return null; // couldn't build — caller keeps the existing cache
    }

    // The YYYY/MM/<runId> layout encodes recency, so a descending sort visits
    // runs newest-first (matches RunHistoryService).
    const folders = groupRunFolders(listed.value, root);
    const keys = [...folders.keys()].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
    for (const key of keys) {
      const entries = await resolveRunEntries(this.vaultFs, folders.get(key) ?? {});
      for (const { ref, entry } of entries) foldEntry(index, ref, entry, depth);
    }

    // The Evidence root exists but may still be EMPTY (a fresh vault whose user
    // created the folder but never ran). Persisting here would create
    // `.testrunner/history/scenario-index.json` before the Test Hub is
    // initialized — the same partial `.testrunner` state the absent-root guard
    // above avoids. Only materialize the index when there is history to project,
    // or an index ALREADY exists (a populated vault whose logs were since removed —
    // then writing the empty index correctly clears the stale cache) (codex P2).
    if (keys.length > 0 || (await this.readIndex())) {
      await this.writeIndex(index);
    }
    this.logger.info("Scenario history index rebuilt", {
      runs: keys.length,
      scenarios: Object.keys(index.scenarios).length,
    });
    return index;
  }

  /** True when any scenario record still retains a result contributed by `runId`. */
  private indexHasRun(index: ScenarioIndex | null, runId: string): boolean {
    return (
      index !== null &&
      Object.values(index.scenarios).some((record) =>
        record.recent.some((entry) => entry.runId === runId),
      )
    );
  }

  /**
   * Retracts a run whose re-import now resolves ZERO Scenario References: deletes
   * its per-run NDJSON log, then rebuilds the index from the REMAINING committed
   * logs. Rebuilding (rather than an in-place purge) restores any depth-trimmed
   * older results for the refs this run touched and drops refs that were only
   * this run's (codex P2). `deleteFile` is idempotent and the rebuild only runs
   * when an index already exists, so a first-time zero-ref run on a fresh vault
   * materializes nothing.
   */
  private async retractRun(run: TestRun, evidenceRoot: VaultPath): Promise<boolean> {
    const deleted = await this.vaultFs.deleteFile(this.ndjsonPath(run, evidenceRoot));
    if (!deleted.ok) {
      this.logger.warn("Could not delete scenario history log on retract", {
        runId: run.id,
        reason: deleted.error.message,
      });
    }
    // Also tombstone the colocated note's scenario block. With Markdown
    // generation off the note isn't regenerated on re-import, so a rebuild would
    // otherwise fall back to its stale block and resurrect the very results this
    // retraction removed (codex P2). When Markdown is on, evidence generation
    // already rewrote the note this import, so this is a no-op.
    await this.stripNoteScenarioBlock(run, evidenceRoot);
    // Only an EXISTING index could hold this run's prior contribution; a
    // first-time zero-ref run has nothing to retract. Returns whether a
    // retraction against existing history occurred so the caller can notify views.
    if (!(await this.readIndex())) return false;
    const rebuilt = await this.rebuildInternal();
    // A transient listing failure leaves the on-disk index still holding the
    // run; flag the cache stale so the next read retries rather than serving the
    // un-retracted statuses (mirrors the record path, codex P2).
    if (!rebuilt) this.indexWriteFailed = true;
    return true;
  }

  /** Strips the stale `testrunner-scenarios` block from a run's note, if any. */
  private async stripNoteScenarioBlock(run: TestRun, evidenceRoot: VaultPath): Promise<void> {
    const notePath = this.summaryPath(run, evidenceRoot);
    const read = await this.vaultFs.readFile(notePath);
    if (!read.ok) return; // no note (or unreadable) — nothing to strip
    const stripped = stripScenarioEvidenceBlock(read.value);
    if (stripped === read.value) return; // no block present
    const written = await this.vaultFs.writeFile(notePath, stripped);
    if (!written.ok) {
      this.logger.warn("Could not strip scenario block from note on retract", {
        runId: run.id,
        reason: written.error.message,
      });
    }
  }

  private depth(configured: number | undefined): number {
    // Require an effective window of at least 1: a fractional value in (0,1)
    // would floor to 0, producing trimmed records with no `latest` (codex P2).
    // Settings load already rejects non-integers, but guard here too so the
    // projection is never corrupted regardless of how settings were supplied.
    return configured !== undefined && Number.isFinite(configured) && configured >= 1
      ? Math.floor(configured)
      : HISTORY_DEPTH_DEFAULT;
  }

  /**
   * Canonical Evidence root: drops empty (`Test//Evidence`), `.` (`Test
   * Evidence/.`), and trailing-slash segments. `joinVaultPath` and the Obsidian
   * adapter canonicalize the paths they BUILD/LIST, but `rebuildInternal` slices
   * listed paths by `root.length` and the index persists `root` for its
   * staleness check — both need the SAME canonical form the listing returns, or
   * a non-canonical configured root drops path characters (leaving the rebuilt
   * index empty) or churns the cache (codex P2). `..` can't appear — PathSafety
   * and joinVaultPath reject traversal upstream.
   */
  private normalizeRoot(root: VaultPath): VaultPath {
    return unsafeVaultPath(
      root
        .split("/")
        .filter((segment) => segment !== "" && segment !== ".")
        .join("/"),
    );
  }

  /** `Test Evidence/YYYY/MM/<runId>` from the run start (ADR-0016 partition). */
  private runFolder(run: TestRun, root: VaultPath): VaultPath {
    return evidenceRunFolder(root, run, this.now);
  }

  /** `…/<runId>/scenarios.ndjson` — the committed per-run history log. */
  private ndjsonPath(run: TestRun, root: VaultPath): VaultPath {
    return joinVaultPath(this.runFolder(run, root), "scenarios.ndjson");
  }

  /** `…/<runId>/summary.md` — the colocated Evidence note (rebuild fallback). */
  private summaryPath(run: TestRun, root: VaultPath): VaultPath {
    return joinVaultPath(this.runFolder(run, root), "summary.md");
  }

  private async indexAbsolutePath(): Promise<string | undefined> {
    const base = await this.absoluteFs.getVaultBasePath();
    if (!base.ok) return undefined;
    const settings = await this.settingsService.load();
    const runner = settings.paths.testRunnerPath;
    return `${base.value.replace(/[/\\]$/, "")}/${runner}/history/scenario-index.json`;
  }

  private async readIndex(): Promise<ScenarioIndex | null> {
    const path = await this.indexAbsolutePath();
    if (!path) return null;
    if (!(await this.absoluteFs.existsAbsolute(path))) return null;
    const read = await this.absoluteFs.readAbsolute(path);
    if (!read.ok) return null;
    try {
      const parsed: unknown = JSON.parse(read.value);
      // Validate the SHAPE, not just JSON-ness: this cache is regenerable and
      // can be hand-edited or left partially written. A parseable-but-malformed
      // index (e.g. `scenarios` an array, or a record missing latest/recent)
      // must read as absent so the rebuild path runs, rather than passing here
      // and crashing a later `entry.latest.status` / `record.recent` deref
      // (codex P2).
      return isScenarioIndex(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private async writeIndex(index: ScenarioIndex): Promise<void> {
    const path = await this.indexAbsolutePath();
    if (!path) return;
    const written = await this.absoluteFs.writeAbsolute(path, JSON.stringify(index, null, 2));
    // Track whether the on-disk cache reflects what we just built: a failed write
    // leaves a stale file that latestStatuses must not serve from the fast path.
    this.indexWriteFailed = !written.ok;
    if (!written.ok) {
      this.logger.warn("Could not write scenario history index", {
        reason: written.error.message,
      });
    }
  }
}
