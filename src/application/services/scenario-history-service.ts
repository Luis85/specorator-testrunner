import type { ImportedReport } from "./report-import-service";
import type { SettingsService } from "./settings-service";
import {
  parseScenarioEvidenceBlock,
  stripScenarioEvidenceBlock,
} from "../content/scenario-evidence-block";
import type { AbsoluteFileSystem } from "../ports/absolute-file-system";
import type { VaultFileSystem } from "../ports/vault-file-system";
import {
  EXECUTION_SCOPES,
  type ExecutionScope,
  type TestRun,
} from "../../domain/entities/test-run";
import {
  SCENARIO_LATEST_STATUSES,
  type ScenarioLatestStatus,
} from "../../domain/policies/use-case-automation-policy";
import type { VaultPath } from "../../domain/value-objects/identifiers";
import { unsafeVaultPath } from "../../domain/value-objects/vault-path";
import { HISTORY_DEPTH_DEFAULT } from "../../domain/settings/settings";
import { createEvent } from "../../shared/event-bus/create-event";
import type { EventBus } from "../../shared/event-bus/event-bus";
import type { Logger } from "../../shared/logging/logger";
import { ok, type Result } from "../../shared/result/result";
import { SerialQueue } from "../../shared/async/serial-queue";
import { joinVaultPath } from "../../shared/utils/vault-path";
import { parseFrontmatter } from "../../shared/utils/frontmatter";

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
 * Every operation — `record`, `rebuildIndex` AND the `latestStatuses` read —
 * is serialized through a private {@link SerialQueue} (the EPIC-014 §9 "third
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
  /** Rebuilds the index by scanning the per-run logs (note block fallback). */
  rebuildIndex(): Promise<Result<void>>;
}

const SCHEMA_VERSION = 1;

/** One per-scenario result line in a per-run `scenarios.ndjson`. */
interface HistoryLine {
  v: number;
  scenarioRef: string;
  runId: string;
  status: ScenarioLatestStatus;
  at: string;
  durationMs?: number;
  scope: ExecutionScope;
}

interface HistoryEntry {
  status: ScenarioLatestStatus;
  runId: string;
  at: string;
  durationMs?: number;
  scope: ExecutionScope;
}

interface ScenarioRecord {
  latest: HistoryEntry;
  recent: HistoryEntry[];
}

interface ScenarioIndex {
  v: number;
  depth: number;
  /**
   * The configured evidence root this projection was built from. A mismatch with
   * the current `paths.evidencePath` means the cache describes a different tree
   * (the user repointed the Evidence folder while the plugin was open), so it is
   * stale and must be rebuilt rather than served (codex P2). Optional for
   * back-compat: an index written before this field is treated as stale once.
   */
  root?: string;
  scenarios: Record<string, ScenarioRecord>;
}

/** `YYYY/MM/<runId>/scenarios.ndjson` relative to the evidence root (ADR-0016). */
const NDJSON_PATTERN = /^(\d{4})\/(\d{2})\/([^/]+)\/scenarios\.ndjson$/;
/** `YYYY/MM/<runId>/summary.md` — the note we fall back to for rebuild (D2). */
const SUMMARY_PATTERN = /^(\d{4})\/(\d{2})\/([^/]+)\/summary\.md$/;

export class DefaultScenarioHistoryService implements ScenarioHistoryService {
  private readonly queue = new SerialQueue();

  /**
   * True when the last {@link writeIndex} failed, so the on-disk cache is stale
   * even if its `root`/`depth` still match. Forces {@link latestStatusesInternal}
   * to rebuild and serve the in-memory index until a write succeeds (codex P2).
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

  private async latestStatusesInternal(): Promise<Result<Map<string, ScenarioLatestStatus>>> {
    const settings = await this.settingsService.load();
    const root = this.normalizeRoot(settings.paths.evidencePath);
    const depth = this.depth(settings.automation.historyDepth);
    let index = await this.readIndex();
    // Reconstruct from the committed logs when the index is absent, was built from
    // a different Evidence root (repointed paths.evidencePath), was built at a
    // different history depth, OR a prior index write failed (so the on-disk cache
    // is stale even though its root/depth still match — codex P2). rebuildInternal
    // is called directly, NOT the queued rebuildIndex: we already hold the queue
    // slot, so re-entering queue.run here would deadlock.
    if (index?.root !== root || index?.depth !== depth || this.indexWriteFailed) {
      // Serve the freshly rebuilt IN-MEMORY index — it reflects the committed logs
      // even when the disk write failed (read-only `.testrunner` / disk full), so
      // a failed cache write never serves stale statuses (codex P2). Only fall
      // back to a disk re-read if the rebuild couldn't build (listing failure).
      index = (await this.rebuildInternal()) ?? (await this.readIndex());
      // Still mismatched (e.g. listing failed and the disk cache is stale)? Don't
      // serve it — degrade to an empty map rather than the previous tree/window.
      if (index?.root !== root || index?.depth !== depth) index = null;
    }
    const map = new Map<string, ScenarioLatestStatus>();
    if (index) {
      for (const [ref, entry] of Object.entries(index.scenarios)) {
        map.set(ref, entry.latest.status);
      }
    }
    return ok(map);
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
    for (const line of lines) this.fold(existing, line.scenarioRef, lineToEntry(line), depth);
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
    const folders = this.groupRunFolders(listed.value, root);
    const keys = [...folders.keys()].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
    for (const key of keys) {
      const entries = await this.resolveRunEntries(folders.get(key) ?? {});
      for (const { ref, entry } of entries) this.fold(index, ref, entry, depth);
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

  /**
   * Groups the listed Evidence files into per-run folders keyed `YYYY/MM/<runId>`,
   * pairing each run's NDJSON log with its colocated note. The prefix is
   * `root + "/"`, or "" at the vault root, so the relative path is computed
   * exactly regardless of root (codex P2).
   */
  private groupRunFolders(
    paths: VaultPath[],
    root: VaultPath,
  ): Map<string, { ndjson?: VaultPath; summary?: VaultPath }> {
    const prefix = root === "" ? "" : `${root}/`;
    const folders = new Map<string, { ndjson?: VaultPath; summary?: VaultPath }>();
    for (const path of paths) {
      if (!path.startsWith(prefix)) continue;
      const relative = path.slice(prefix.length);
      const nd = NDJSON_PATTERN.exec(relative);
      if (nd) {
        const key = `${nd[1]}/${nd[2]}/${nd[3]}`;
        folders.set(key, { ...folders.get(key), ndjson: path });
        continue;
      }
      const sm = SUMMARY_PATTERN.exec(relative);
      if (sm) {
        const key = `${sm[1]}/${sm[2]}/${sm[3]}`;
        folders.set(key, { ...folders.get(key), summary: path });
      }
    }
    return folders;
  }

  /**
   * Resolves a run folder's ref+entry pairs. Prefers the NDJSON log, but falls
   * back to the colocated note when the log is unusable OR partially corrupt —
   * empty, all-skipped, or with any malformed/mid-line-truncated line (external
   * corruption or a partial write). Rebuilding from a truncated subset would
   * silently drop the run's later scenarios even though the note's
   * `testrunner-scenarios` block can still hold the full run (codex P2). A normal
   * run never leaves an empty/partial log: record writes the lines atomically or
   * the zero-ref path deletes it.
   */
  private async resolveRunEntries(folder: {
    ndjson?: VaultPath;
    summary?: VaultPath;
  }): Promise<{ ref: string; entry: HistoryEntry }[]> {
    const { ndjson, summary } = folder;
    if (ndjson) {
      const log = await this.entriesFromLog(ndjson);
      if ((log.entries.length === 0 || log.hadError) && summary) {
        return this.entriesFromNote(summary);
      }
      return log.entries;
    }
    if (summary) return this.entriesFromNote(summary);
    return [];
  }

  /**
   * Parses a per-run NDJSON log into ref+entry pairs. Reports `hadError` when a
   * non-empty line failed to parse or had the wrong shape (corruption or a
   * mid-line truncated write), so the caller can prefer the colocated note
   * rather than rebuild from a partial subset (codex P2).
   */
  private async entriesFromLog(
    path: VaultPath,
  ): Promise<{ entries: { ref: string; entry: HistoryEntry }[]; hadError: boolean }> {
    const read = await this.vaultFs.readFile(path);
    if (!read.ok) return { entries: [], hadError: true };
    const entries: { ref: string; entry: HistoryEntry }[] = [];
    let hadError = false;
    for (const raw of read.value.split("\n")) {
      const trimmed = raw.trim();
      if (trimmed === "") continue;
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (isHistoryLine(parsed)) {
          entries.push({ ref: parsed.scenarioRef, entry: lineToEntry(parsed) });
        } else {
          // Parsed but violates the v1 schema (bad status union, missing
          // runId/at, unknown scope, …) — a hand-edited or sync-corrupted line.
          // Mark errored so the rebuild prefers the authoritative note instead of
          // storing a non-union status the roll-up would mis-read (codex P2).
          hadError = true;
        }
      } catch {
        // A hand-edited/corrupt/truncated line — the Markdown stays authoritative.
        hadError = true;
      }
    }
    return { entries, hadError };
  }

  /** Fallback rebuild source (D2): the note's `testrunner-scenarios` block. */
  private async entriesFromNote(path: VaultPath): Promise<{ ref: string; entry: HistoryEntry }[]> {
    const read = await this.vaultFs.readFile(path);
    if (!read.ok) return [];
    const frontmatter = parseFrontmatter(read.value);
    const runId = asString(frontmatter.run_id) ?? "";
    // Prefer run_at (the run's completion time) so fold()'s newest-wins ordering
    // matches the NDJSON history; created_at is the note/import time and would
    // mis-order a re-imported older run (codex P2). Older notes lack run_at.
    const at = asString(frontmatter.run_at) ?? asString(frontmatter.created_at) ?? "";
    const scope = (asString(frontmatter.scope) as ExecutionScope) ?? "all";
    return parseScenarioEvidenceBlock(read.value).map((block) => ({
      ref: block.ref,
      entry: {
        status: block.status,
        runId,
        at,
        ...(block.durationMs !== undefined ? { durationMs: block.durationMs } : {}),
        scope,
      },
    }));
  }

  /**
   * Folds one result into a scenario's record: de-dupes by runId (idempotent
   * re-imports), keeps `recent` newest-first trimmed to `depth`, and sets
   * `latest` to the newest-by-timestamp entry.
   */
  private fold(index: ScenarioIndex, ref: string, entry: HistoryEntry, depth: number): void {
    const existing = index.scenarios[ref];
    const recent = (existing?.recent ?? []).filter((e) => e.runId !== entry.runId);
    recent.push(entry);
    recent.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    const trimmed = recent.slice(0, depth);
    index.scenarios[ref] = { latest: trimmed[0], recent: trimmed };
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
    const started = new Date(run.startedAt);
    const valid = Number.isNaN(started.getTime()) ? this.now() : started;
    const year = String(valid.getUTCFullYear());
    const month = String(valid.getUTCMonth() + 1).padStart(2, "0");
    return joinVaultPath(root, year, month, run.id);
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

const lineToEntry = (line: HistoryLine): HistoryEntry => ({
  status: line.status,
  runId: line.runId,
  at: line.at,
  ...(line.durationMs !== undefined ? { durationMs: line.durationMs } : {}),
  scope: line.scope,
});

const asString = (value: string | string[] | undefined): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

const VALID_STATUSES = new Set<string>(SCENARIO_LATEST_STATUSES);
const VALID_SCOPES = new Set<string>(EXECUTION_SCOPES);

/**
 * Strict v1 schema guard for one NDJSON history line. A line that parses as JSON
 * but violates the schema — status outside the {@link ScenarioLatestStatus}
 * union, blank/missing `scenarioRef`/`runId`/`at`, unknown `scope`, or a
 * non-numeric `durationMs` — is rejected so the rebuild marks the log errored and
 * prefers the authoritative note, rather than storing a corrupt status the
 * roll-up would silently mis-read (codex P2).
 */
const isHistoryLine = (value: unknown): value is HistoryLine => {
  if (typeof value !== "object" || value === null) return false;
  const line = value as Record<string, unknown>;
  return (
    typeof line.scenarioRef === "string" &&
    line.scenarioRef !== "" &&
    typeof line.runId === "string" &&
    line.runId !== "" &&
    typeof line.at === "string" &&
    line.at !== "" &&
    typeof line.status === "string" &&
    VALID_STATUSES.has(line.status) &&
    typeof line.scope === "string" &&
    VALID_SCOPES.has(line.scope) &&
    (line.durationMs === undefined || typeof line.durationMs === "number")
  );
};

/**
 * Strict guard for a persisted {@link HistoryEntry}. Applies the SAME schema
 * validation as {@link isHistoryLine} (status union, non-blank runId/at, scope
 * union, numeric durationMs) so a parseable-but-corrupt cache — e.g. a hand-
 * edited/sync-mangled `status: "failed "` — is rejected and the index rebuilt
 * from the authoritative logs, rather than served and mis-read by the roll-up
 * (codex P2).
 */
const isHistoryEntry = (value: unknown): value is HistoryEntry => {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.status === "string" &&
    VALID_STATUSES.has(entry.status) &&
    typeof entry.runId === "string" &&
    entry.runId !== "" &&
    typeof entry.at === "string" &&
    entry.at !== "" &&
    typeof entry.scope === "string" &&
    VALID_SCOPES.has(entry.scope) &&
    (entry.durationMs === undefined || typeof entry.durationMs === "number")
  );
};

/**
 * Structural guard for a persisted {@link ScenarioIndex}. Rejects a
 * parseable-but-malformed cache (e.g. `scenarios` not a plain object, or a
 * record missing a usable `latest`/`recent`) so {@link DefaultScenarioHistoryService}
 * rebuilds from the committed logs instead of crashing a later deref (codex P2).
 */
const isScenarioIndex = (value: unknown): value is ScenarioIndex => {
  if (typeof value !== "object" || value === null) return false;
  const scenarios = (value as { scenarios?: unknown }).scenarios;
  if (typeof scenarios !== "object" || scenarios === null || Array.isArray(scenarios)) return false;
  return Object.values(scenarios as Record<string, unknown>).every((record) => {
    if (typeof record !== "object" || record === null) return false;
    const { latest, recent } = record as { latest?: unknown; recent?: unknown };
    return isHistoryEntry(latest) && Array.isArray(recent) && recent.every(isHistoryEntry);
  });
};
