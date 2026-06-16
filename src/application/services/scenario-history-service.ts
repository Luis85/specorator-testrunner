import type { ImportedReport } from "./report-import-service";
import type { SettingsService } from "./settings-service";
import { parseScenarioEvidenceBlock } from "../content/scenario-evidence-block";
import type { AbsoluteFileSystem } from "../ports/absolute-file-system";
import type { VaultFileSystem } from "../ports/vault-file-system";
import type { ExecutionScope, TestRun } from "../../domain/entities/test-run";
import type { ScenarioLatestStatus } from "../../domain/policies/use-case-automation-policy";
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
 * Writes are serialized through a private {@link SerialQueue} (the EPIC-014 §9
 * "third user") so a `record` and a `rebuildIndex` can never interleave on the
 * index file. Best-effort: faults are logged and returned, never thrown into the
 * post-run pipeline.
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
  scenarios: Record<string, ScenarioRecord>;
}

/** `YYYY/MM/<runId>/scenarios.ndjson` relative to the evidence root (ADR-0016). */
const NDJSON_PATTERN = /^(\d{4})\/(\d{2})\/([^/]+)\/scenarios\.ndjson$/;
/** `YYYY/MM/<runId>/summary.md` — the note we fall back to for rebuild (D2). */
const SUMMARY_PATTERN = /^(\d{4})\/(\d{2})\/([^/]+)\/summary\.md$/;

export class DefaultScenarioHistoryService implements ScenarioHistoryService {
  private readonly queue = new SerialQueue();

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
    return this.queue.run(() => this.rebuildInternal());
  }

  async latestStatuses(): Promise<Result<Map<string, ScenarioLatestStatus>>> {
    let index = await this.readIndex();
    if (!index) {
      // No (or unreadable) index — reconstruct it from the committed logs once.
      await this.rebuildIndex();
      index = await this.readIndex();
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
    const at = run.finishedAt ?? run.startedAt;
    const lines: HistoryLine[] = [];
    for (const scenario of report.scenarioResults) {
      // Results with no resolved Scenario Reference (US-056 fallback) are shown in
      // the note but NOT aggregated into history (ADR-0022).
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

    if (lines.length === 0) {
      this.logger.info("No scenario references to record for run history", { runId: run.id });
      return ok(undefined);
    }

    // 1) Write the committed per-run NDJSON log (write-once; overwrite so a
    // re-import of the same run refreshes its log deterministically).
    const logPath = this.ndjsonPath(run, settings.paths.evidencePath);
    const folder = unsafeVaultPath(logPath.slice(0, logPath.lastIndexOf("/")));
    const folderCreated = await this.vaultFs.createFolder(folder);
    if (!folderCreated.ok) {
      this.logger.warn("Could not create scenario history folder", {
        runId: run.id,
        reason: folderCreated.error.message,
      });
      return ok(undefined); // best-effort; the roll-up degrades, never errors
    }
    const ndjson = lines.map((line) => JSON.stringify(line)).join("\n") + "\n";
    const written = await this.vaultFs.writeFile(logPath, ndjson);
    if (!written.ok) {
      this.logger.warn("Could not write scenario history log", {
        runId: run.id,
        reason: written.error.message,
      });
      return ok(undefined);
    }

    // 2) Fold the run into the index read model.
    const depth = this.depth(settings.automation.historyDepth);
    const index = (await this.readIndex()) ?? { v: SCHEMA_VERSION, depth, scenarios: {} };
    index.depth = depth;
    for (const line of lines) this.fold(index, line.scenarioRef, lineToEntry(line), depth);
    await this.writeIndex(index);

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

  private async rebuildInternal(): Promise<Result<void>> {
    const settings = await this.settingsService.load();
    const root = settings.paths.evidencePath;
    const depth = this.depth(settings.automation.historyDepth);
    const index: ScenarioIndex = { v: SCHEMA_VERSION, depth, scenarios: {} };

    // A fresh/uninitialized vault has no Evidence root yet. Do NOT write the
    // index here: the absolute FS would create `.testrunner/history/...` before
    // the user has initialized the Test Hub, dirtying the vault and leaving a
    // partial runner folder for validation to trip over (codex P2). With no
    // history to project, an absent index is correct — latestStatuses() returns
    // an empty map.
    if (!(await this.vaultFs.exists(root))) return ok(undefined);
    const listed = await this.vaultFs.listFilesRecursive(root);
    if (!listed.ok) {
      this.logger.warn("Could not list evidence for history rebuild", {
        reason: listed.error.message,
      });
      return ok(undefined);
    }

    // Group per run folder; the YYYY/MM/<runId> layout encodes recency, so a
    // descending sort visits runs newest-first (matches RunHistoryService).
    const folders = new Map<string, { ndjson?: VaultPath; summary?: VaultPath }>();
    for (const path of listed.value) {
      const relative = path.slice(root.length + 1);
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
    const keys = [...folders.keys()].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));

    for (const key of keys) {
      const { ndjson, summary } = folders.get(key) ?? {};
      const entries = ndjson
        ? await this.entriesFromLog(ndjson)
        : summary
          ? await this.entriesFromNote(summary)
          : [];
      for (const { ref, entry } of entries) this.fold(index, ref, entry, depth);
    }

    await this.writeIndex(index);
    this.logger.info("Scenario history index rebuilt", {
      runs: keys.length,
      scenarios: Object.keys(index.scenarios).length,
    });
    return ok(undefined);
  }

  /** Parses a per-run NDJSON log into ref+entry pairs (skips malformed lines). */
  private async entriesFromLog(path: VaultPath): Promise<{ ref: string; entry: HistoryEntry }[]> {
    const read = await this.vaultFs.readFile(path);
    if (!read.ok) return [];
    const out: { ref: string; entry: HistoryEntry }[] = [];
    for (const raw of read.value.split("\n")) {
      const trimmed = raw.trim();
      if (trimmed === "") continue;
      try {
        const line = JSON.parse(trimmed) as HistoryLine;
        if (typeof line.scenarioRef === "string" && typeof line.status === "string") {
          out.push({ ref: line.scenarioRef, entry: lineToEntry(line) });
        }
      } catch {
        // A hand-edited/corrupt line is skipped — the Markdown stays authoritative.
      }
    }
    return out;
  }

  /** Fallback rebuild source (D2): the note's `testrunner-scenarios` block. */
  private async entriesFromNote(path: VaultPath): Promise<{ ref: string; entry: HistoryEntry }[]> {
    const read = await this.vaultFs.readFile(path);
    if (!read.ok) return [];
    const frontmatter = parseFrontmatter(read.value);
    const runId = asString(frontmatter.run_id) ?? "";
    const at = asString(frontmatter.created_at) ?? "";
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

  private depth(configured: number | undefined): number {
    return configured !== undefined && Number.isFinite(configured) && configured > 0
      ? Math.floor(configured)
      : HISTORY_DEPTH_DEFAULT;
  }

  /** `Test Evidence/YYYY/MM/<runId>/scenarios.ndjson` from the run start (ADR-0016). */
  private ndjsonPath(run: TestRun, root: VaultPath): VaultPath {
    const started = new Date(run.startedAt);
    const valid = Number.isNaN(started.getTime()) ? this.now() : started;
    const year = String(valid.getUTCFullYear());
    const month = String(valid.getUTCMonth() + 1).padStart(2, "0");
    return joinVaultPath(root, year, month, run.id, "scenarios.ndjson");
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
      const parsed = JSON.parse(read.value) as ScenarioIndex;
      if (parsed && typeof parsed === "object" && parsed.scenarios) return parsed;
      return null;
    } catch {
      return null;
    }
  }

  private async writeIndex(index: ScenarioIndex): Promise<void> {
    const path = await this.indexAbsolutePath();
    if (!path) return;
    const written = await this.absoluteFs.writeAbsolute(path, JSON.stringify(index, null, 2));
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
