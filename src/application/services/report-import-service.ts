import { resolveRunnerCwd } from "./runner-paths";
import type { SettingsService } from "./settings-service";
import type { AbsoluteFileSystem } from "../ports/absolute-file-system";
import type { EvidenceArtifact } from "../../domain/entities/evidence";
import type { TestRun, TestRunResult } from "../../domain/entities/test-run";
import type { RunId, VaultPath } from "../../domain/value-objects/identifiers";
import { appError } from "../../shared/errors/errors";
import { createEvent } from "../../shared/event-bus/create-event";
import type { EventBus } from "../../shared/event-bus/event-bus";
import type { Logger } from "../../shared/logging/logger";
import { err, ok, type Result } from "../../shared/result/result";
import { joinVaultPath } from "../../shared/utils/vault-path";

/** Report import contract (TIS §8.11, UC-016, US-032/033/034). */
export interface ReportImportService {
  import(run: TestRun): Promise<Result<ImportedReport>>;
}

export interface ImportedReport {
  runId: RunId;
  result: TestRunResult;
  scenarioResults: ScenarioResult[];
  artifacts: EvidenceArtifact[];
}

export interface ScenarioResult {
  feature: string; // human-readable feature name (display)
  featureUri?: string; // feature file path (e.g. features/UC-001-x.feature) for UC linking
  scenario: string;
  status: "passed" | "failed" | "skipped";
  durationMs?: number;
  errorMessage?: string;
}

/**
 * Cucumber-JS JSON report shape (the `json:` formatter), parsed defensively:
 * the runner writes `reports/cucumber-report.json` (an array of features, each
 * with `elements` (scenarios), each with `steps`). Every field is optional so a
 * malformed or partial report degrades to skipped rather than throwing.
 */
interface CucumberStep {
  result?: { status?: string; duration?: number; error_message?: string };
  embeddings?: CucumberAttachment[];
  attachments?: CucumberAttachment[];
}

interface CucumberAttachment {
  mime_type?: string;
  media?: { type?: string };
  data?: string;
}

interface CucumberScenario {
  name?: string;
  type?: string; // "scenario" | "background"
  steps?: CucumberStep[];
}

interface CucumberFeature {
  name?: string;
  uri?: string;
  elements?: CucumberScenario[];
}

const REPORT_FILE = "reports/cucumber-report.json";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Nanoseconds (Cucumber `result.duration`) to whole milliseconds. */
const nsToMs = (duration: number | undefined): number | undefined =>
  typeof duration === "number" ? Math.round(duration / 1_000_000) : undefined;

/**
 * Rolls a scenario's step statuses into a single scenario status: any failed →
 * failed; otherwise any non-passed (skipped/undefined/pending/ambiguous) →
 * skipped; all passed → passed. A scenario with no steps is skipped.
 */
const scenarioStatus = (steps: CucumberStep[]): ScenarioResult["status"] => {
  if (steps.length === 0) return "skipped";
  let allPassed = true;
  for (const step of steps) {
    const status = step.result?.status;
    if (status === "failed") return "failed";
    if (status !== "passed") allPassed = false;
  }
  return allPassed ? "passed" : "skipped";
};

/**
 * Imports the Cucumber JSON report a finished run wrote to `.testrunner/reports`
 * (TIS §8.11). Reads via {@link AbsoluteFileSystem} because the reports folder
 * lives outside the vault index (TIS §9.4); parses defensively into typed
 * results and artifact REFERENCES (US-033/034 — links, never copies, ADR-0016).
 *
 * Emits `report.detected` then `report.imported`, or `report.import.failed`
 * (returning `REPORT_NOT_FOUND` / `REPORT_PARSE_FAILED`) on a read/parse fault.
 */
export class DefaultReportImportService implements ReportImportService {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly absoluteFs: AbsoluteFileSystem,
    private readonly eventBus: EventBus,
    private readonly logger: Logger,
  ) {}

  async import(run: TestRun): Promise<Result<ImportedReport>> {
    const settings = await this.settingsService.load();
    const runnerPath = settings.paths.testRunnerPath;
    // VaultPath used for artifact references + event payloads (vault-relative).
    const reportVaultPath = joinVaultPath(runnerPath, REPORT_FILE);

    const cwd = await resolveRunnerCwd(this.absoluteFs, runnerPath);
    if (!cwd.ok) return err(cwd.error);
    const reportAbsPath = `${cwd.value.replace(/[/\\]$/, "")}/${REPORT_FILE}`;

    await this.publishDetected(run.id, reportVaultPath);

    const read = await this.absoluteFs.readAbsolute(reportAbsPath);
    if (!read.ok) {
      return this.fail(run.id, reportVaultPath, read.error.message, "REPORT_NOT_FOUND");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(read.value);
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : "Invalid JSON.";
      return this.fail(run.id, reportVaultPath, reason, "REPORT_PARSE_FAILED", cause);
    }
    if (!Array.isArray(parsed)) {
      return this.fail(
        run.id,
        reportVaultPath,
        "Report root is not a Cucumber feature array.",
        "REPORT_PARSE_FAILED",
      );
    }

    const report = this.toImportedReport(run.id, parsed, runnerPath, reportVaultPath);

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

  /** Maps the parsed feature array into an {@link ImportedReport}. */
  private toImportedReport(
    runId: RunId,
    features: unknown[],
    runnerPath: VaultPath,
    reportVaultPath: VaultPath,
  ): ImportedReport {
    const scenarioResults: ScenarioResult[] = [];
    // The JSON report itself is always the first artifact (US-032).
    const artifacts: EvidenceArtifact[] = [
      { type: "report", path: reportVaultPath, label: "Cucumber JSON report" },
    ];
    const result: TestRunResult = { passed: 0, failed: 0, skipped: 0, total: 0 };

    for (const rawFeature of features) {
      if (!isRecord(rawFeature)) continue;
      const feature = rawFeature as CucumberFeature;
      const featureUri = typeof feature.uri === "string" ? feature.uri : undefined;
      const featureName =
        typeof feature.name === "string" ? feature.name : (featureUri ?? "");
      const elements = Array.isArray(feature.elements) ? feature.elements : [];

      for (const rawScenario of elements) {
        if (!isRecord(rawScenario)) continue;
        const scenario = rawScenario as CucumberScenario;
        // Backgrounds run once per scenario and carry no independent result.
        if (scenario.type === "background") continue;
        const steps = Array.isArray(scenario.steps) ? scenario.steps : [];

        const status = scenarioStatus(steps);
        const durationMs = this.totalDurationMs(steps);
        const errorMessage = this.firstErrorMessage(steps);
        scenarioResults.push({
          feature: featureName,
          featureUri,
          scenario: typeof scenario.name === "string" ? scenario.name : "",
          status,
          durationMs,
          errorMessage,
        });
        result[status] += 1;
        result.total += 1;

        this.collectArtifacts(steps, runnerPath, artifacts);
      }
    }

    return { runId, result, scenarioResults, artifacts };
  }

  /** Sum of step durations (ns→ms); undefined when no step reported a duration. */
  private totalDurationMs(steps: CucumberStep[]): number | undefined {
    let total = 0;
    let seen = false;
    for (const step of steps) {
      const ms = nsToMs(step.result?.duration);
      if (ms !== undefined) {
        total += ms;
        seen = true;
      }
    }
    return seen ? total : undefined;
  }

  /** First failing step's error message, for the scenario summary (US-031). */
  private firstErrorMessage(steps: CucumberStep[]): string | undefined {
    for (const step of steps) {
      if (step.result?.status === "failed" && typeof step.result.error_message === "string") {
        return step.result.error_message;
      }
    }
    return undefined;
  }

  /**
   * Extracts screenshot/trace artifact references from step embeddings/
   * attachments (US-033/034). Cucumber embeds attachment bytes inline; we DO
   * NOT copy them into the vault (ADR-0016) — we record a stable reference to
   * the report that carries them so evidence can link back to it.
   */
  private collectArtifacts(
    steps: CucumberStep[],
    runnerPath: VaultPath,
    artifacts: EvidenceArtifact[],
  ): void {
    for (const step of steps) {
      const attachments = [...(step.embeddings ?? []), ...(step.attachments ?? [])];
      for (const attachment of attachments) {
        const mime = attachment.mime_type ?? attachment.media?.type ?? "";
        const type = this.artifactType(mime);
        if (!type) continue;
        artifacts.push({
          type,
          // Embedded artifacts live inside the report; reference the reports
          // folder (a stable VaultPath) rather than fabricating a per-file path.
          path: joinVaultPath(runnerPath, "reports"),
          label: mime || type,
        });
      }
    }
  }

  /** Maps an attachment MIME type to an evidence artifact type, or null. */
  private artifactType(mime: string): EvidenceArtifact["type"] | null {
    if (mime.startsWith("image/")) return "screenshot";
    if (mime.includes("zip") || mime.includes("trace")) return "trace";
    return null;
  }

  private publishDetected(runId: RunId, reportPath: VaultPath): Promise<void> {
    return this.eventBus.publish(
      createEvent(
        "report.detected",
        { runId, reportPath, format: "json" },
        { correlationId: runId },
      ),
    );
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
