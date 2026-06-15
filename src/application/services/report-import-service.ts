import { resolveRunnerCwd } from "./runner-paths";
import type { SettingsService } from "./settings-service";
import type { AbsoluteFileSystem } from "../ports/absolute-file-system";
import type { ParsedReport, ReportParser } from "../ports/report-parser";
import type { TestRun } from "../../domain/entities/test-run";
import type { RunId, VaultPath } from "../../domain/value-objects/identifiers";
import { appError } from "../../shared/errors/errors";
import { createEvent } from "../../shared/event-bus/create-event";
import type { EventBus } from "../../shared/event-bus/event-bus";
import type { Logger } from "../../shared/logging/logger";
import { err, ok, type Result } from "../../shared/result/result";
import { joinVaultPath, relativeVaultPath } from "../../shared/utils/vault-path";

export type { ScenarioResult } from "../ports/report-parser";

/** Report import contract (TIS §8.11, UC-016, US-032/033/034). */
export interface ReportImportService {
  import(run: TestRun): Promise<Result<ImportedReport>>;
}

export interface ImportedReport extends ParsedReport {
  runId: RunId;
  /**
   * Feature file contents captured at run start (vault-relative path → content),
   * present when the run wrote a snapshot. Lets scenario-identity resolution use
   * the content that actually ran instead of the live (possibly edited) file
   * (US-056).
   */
  featureSnapshot?: Record<string, string>;
}

const REPORT_FILE = "reports/cucumber-report.json";

/**
 * Imports the Cucumber JSON report a finished run wrote to `.testrunner/reports`
 * (TIS §8.11). Reads via {@link AbsoluteFileSystem} because the reports folder
 * lives outside the vault index (TIS §9.4); delegates parsing to an injected
 * {@link ReportParser} and emits artifact REFERENCES (US-033/034 — links, never
 * copies, ADR-0016).
 *
 * Emits `report.imported`, or `report.import.failed` (returning
 * `REPORT_NOT_FOUND` / `REPORT_PARSE_FAILED`) on a read/parse fault. (The old
 * `report.detected` emission — meant to trigger a never-built filesystem
 * watcher — was removed; the in-process PostRunCoordinator now drives the
 * import from the terminal run event.)
 */
export class DefaultReportImportService implements ReportImportService {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly absoluteFs: AbsoluteFileSystem,
    private readonly parser: ReportParser,
    private readonly eventBus: EventBus,
    private readonly logger: Logger,
  ) {}

  async import(run: TestRun): Promise<Result<ImportedReport>> {
    // Use the runner directory THIS run actually spawned in (recorded on the
    // TestRun), not the current settings — a testRunnerPath changed mid-run or
    // before a manual re-import must not read a different runner's report.
    const runnerPath = run.workingDirectory;
    // Prefer the run-specific snapshot the executor wrote (reports/<runId>.json)
    // so a concurrent run's cleanup of the fixed report can't race this import;
    // fall back to the fixed path for manual re-imports of older runs.
    const reportFile = run.reportPaths.json
      ? relativeVaultPath(runnerPath, run.reportPaths.json)
      : REPORT_FILE;
    // VaultPath used for artifact references + event payloads (vault-relative).
    const reportVaultPath = run.reportPaths.json ?? joinVaultPath(runnerPath, REPORT_FILE);

    const cwd = await resolveRunnerCwd(this.absoluteFs, runnerPath);
    if (!cwd.ok) return err(cwd.error);
    const reportAbsPath = `${cwd.value.replace(/[/\\]$/, "")}/${reportFile}`;

    const read = await this.absoluteFs.readAbsolute(reportAbsPath);
    if (!read.ok) {
      return this.fail(run.id, reportVaultPath, read.error.message, "REPORT_NOT_FOUND");
    }

    const parsed = this.parser.parse(read.value, {
      runId: run.id,
      runnerPath,
      reportVaultPath,
    });
    if (!parsed.ok) {
      return this.fail(
        run.id,
        reportVaultPath,
        parsed.error.message,
        "REPORT_PARSE_FAILED",
        parsed.error.cause,
      );
    }

    const featureSnapshot = await this.loadFeatureSnapshot(run, cwd.value);
    const report: ImportedReport = {
      runId: run.id,
      ...parsed.value,
      ...(featureSnapshot ? { featureSnapshot } : {}),
    };

    await this.eventBus.publish(
      createEvent(
        "report.imported",
        {
          runId: run.id,
          reportPath: reportVaultPath,
          scenarioResults: report.scenarioResults.length,
        },
        { correlationId: run.id },
      ),
    );
    this.logger.info("Report imported", {
      runId: run.id,
      scenarios: report.scenarioResults.length,
      ...report.result,
    });
    return ok(report);
  }

  /**
   * Reads the run-start feature snapshot (US-056), if the run wrote one. Keyed by
   * vault-relative feature path. Best-effort: a missing or malformed snapshot
   * returns undefined and the resolver falls back to the live vault files.
   */
  private async loadFeatureSnapshot(
    run: TestRun,
    cwd: string,
  ): Promise<Record<string, string> | undefined> {
    if (!run.reportPaths.features) return undefined;
    const rel = relativeVaultPath(run.workingDirectory, run.reportPaths.features);
    const read = await this.absoluteFs.readAbsolute(`${cwd.replace(/[/\\]$/, "")}/${rel}`);
    if (!read.ok) return undefined;
    try {
      return JSON.parse(read.value) as Record<string, string>;
    } catch {
      this.logger.warn("Feature snapshot is not valid JSON; ignoring", { runId: run.id });
      return undefined;
    }
  }

  /** Publishes `report.import.failed` and returns the matching error result. */
  private async fail(
    runId: RunId,
    reportPath: VaultPath,
    reason: string,
    code: "REPORT_NOT_FOUND" | "REPORT_PARSE_FAILED",
    cause?: unknown,
  ): Promise<Result<ImportedReport>> {
    await this.eventBus.publish(
      createEvent("report.import.failed", { runId, reportPath, reason }, { correlationId: runId }),
    );
    this.logger.warn("Report import failed", { runId, reportPath, reason });
    return err(appError(code, reason, { details: { runId, reportPath }, cause }));
  }
}
