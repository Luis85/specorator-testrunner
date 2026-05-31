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
  before?: CucumberStep[]; // Before hooks (carry result/embeddings like steps)
  after?: CucumberStep[]; // After hooks
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

// Cucumber statuses that mean the run failed (a missing/ambiguous/pending step
// still exits non-zero), as opposed to a deliberately skipped step.
const FAILURE_STATUSES = new Set(["failed", "undefined", "ambiguous", "pending"]);
const isFailure = (step: CucumberStep): boolean =>
  step.result?.status !== undefined && FAILURE_STATUSES.has(step.result.status);

/**
 * Rolls a scenario's step statuses into a single scenario status: any
 * failed/undefined/pending/ambiguous → failed; otherwise any skipped → skipped;
 * all passed → passed. A scenario with no steps is skipped.
 */
const scenarioStatus = (
  steps: CucumberStep[],
  hooks: CucumberStep[] = [],
): ScenarioResult["status"] => {
  // A failed Before/After hook (e.g. browser setup/teardown) fails the scenario
  // even when the step results look passed/skipped (Cucumber records hooks
  // separately from steps).
  if (hooks.some(isFailure)) return "failed";
  if (steps.length === 0) return "skipped";
  let allPassed = true;
  for (const step of steps) {
    // undefined/pending/ambiguous are failure-like (the run exits non-zero),
    // not skipped — otherwise a missing step would import as failed: 0.
    if (isFailure(step)) return "failed";
    if (step.result?.status !== "passed") allPassed = false;
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
    // Use the runner directory THIS run actually spawned in (recorded on the
    // TestRun), not the current settings — a testRunnerPath changed mid-run or
    // before a manual re-import must not read a different runner's report.
    const runnerPath = run.workingDirectory;
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
      // A failed Background fails every scenario it precedes (Cucumber marks
      // their steps skipped), so fold it into those scenarios rather than
      // counting it AND the skipped scenarios (no double-count).
      let bgFailedSteps: CucumberStep[] | null = null;
      let scenarioCount = 0;

      for (const rawScenario of elements) {
        if (!isRecord(rawScenario)) continue;
        const scenario = rawScenario as CucumberScenario;
        if (scenario.type === "background") {
          const bgSteps = (Array.isArray(scenario.steps) ? scenario.steps : []).filter(
            isRecord,
          ) as CucumberStep[];
          // A later background (e.g. a Rule-specific or per-scenario background)
          // governs the scenarios that follow IT — so a non-failing background
          // must clear any failure carried over from an earlier one, otherwise
          // every following scenario would be mis-reported as failed.
          bgFailedSteps = scenarioStatus(bgSteps) === "failed" ? bgSteps : null;
          continue;
        }
        scenarioCount += 1;
        // Narrow to record steps so a malformed report (e.g. `steps: [null]`)
        // can't throw when result/embeddings are dereferenced (defensive parse).
        const steps = (Array.isArray(scenario.steps) ? scenario.steps : []).filter(
          isRecord,
        ) as CucumberStep[];
        // Before/After hooks carry their own pass/fail (and screenshots); fold
        // them into status/duration/error/artifacts so a hook failure surfaces.
        const hooks = [
          ...(Array.isArray(scenario.before) ? scenario.before : []),
          ...(Array.isArray(scenario.after) ? scenario.after : []),
        ].filter(isRecord) as CucumberStep[];
        const stepsAndHooks = bgFailedSteps ? [...bgFailedSteps, ...steps, ...hooks] : [...steps, ...hooks];

        // A preceding failed Background fails this scenario even when its own
        // steps are skipped.
        const status = bgFailedSteps ? "failed" : scenarioStatus(steps, hooks);
        const durationMs = this.totalDurationMs(stepsAndHooks);
        const errorMessage = this.firstErrorMessage(stepsAndHooks);
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

        this.collectArtifacts(stepsAndHooks, runnerPath, artifacts);
      }

      // A failed Background with no scenarios after it: surface it on its own so
      // the failure isn't lost (no scenario to fold it into).
      if (bgFailedSteps && scenarioCount === 0) {
        scenarioResults.push({
          feature: featureName,
          featureUri,
          scenario: "Background",
          status: "failed",
          durationMs: this.totalDurationMs(bgFailedSteps),
          errorMessage: this.firstErrorMessage(bgFailedSteps),
        });
        result.failed += 1;
        result.total += 1;
        this.collectArtifacts(bgFailedSteps, runnerPath, artifacts);
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
      // Defensive: a malformed report may have non-array embeddings/attachments
      // or null entries — narrow before spreading/dereferencing so import()
      // returns a Result instead of throwing.
      const attachments = [
        ...(Array.isArray(step.embeddings) ? step.embeddings : []),
        ...(Array.isArray(step.attachments) ? step.attachments : []),
      ];
      for (const attachment of attachments) {
        if (!isRecord(attachment)) continue;
        const media = attachment.media;
        const mime =
          typeof attachment.mime_type === "string"
            ? attachment.mime_type
            : isRecord(media) && typeof media.type === "string"
              ? media.type
              : "";
        const type = this.artifactType(mime);
        if (!type) continue;
        artifacts.push({
          type,
          // Embedded artifacts live inline (base64) inside the report file, so
          // reference the concrete report — the directory alone can't be opened
          // to review the bytes from the evidence note.
          path: joinVaultPath(runnerPath, REPORT_FILE),
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
