import type {
  ParsedReport,
  ReportParseContext,
  ReportParser,
  ScenarioResult,
} from "../ports/report-parser";
import type { EvidenceArtifact } from "../../domain/entities/evidence";
import type { TestRunResult } from "../../domain/entities/test-run";
import type { VaultPath } from "../../domain/value-objects/identifiers";
import { appError } from "../../shared/errors/errors";
import { err, ok, type Result } from "../../shared/result/result";

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
 * Parses the cucumber-JSON report (`reports/cucumber-report.json`, the `json:`
 * formatter) defensively into typed results and artifact REFERENCES (US-033/034
 * — links, never copies, ADR-0016). Every field is optional so a malformed or
 * partial report degrades to skipped rather than throwing. The first
 * ReportParser implementation (ADR-0021).
 */
export class CucumberJsonReportParser implements ReportParser {
  parse(rawContent: string, ctx: ReportParseContext): Result<ParsedReport> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawContent);
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : "Invalid JSON.";
      return err(appError("REPORT_PARSE_FAILED", reason, { cause }));
    }
    if (!Array.isArray(parsed)) {
      return err(appError("REPORT_PARSE_FAILED", "Report root is not a Cucumber feature array."));
    }
    return ok(this.toParsedReport(parsed, ctx));
  }

  /** Maps the parsed feature array into a {@link ParsedReport}. */
  private toParsedReport(features: unknown[], ctx: ReportParseContext): ParsedReport {
    const scenarioResults: ScenarioResult[] = [];
    // The JSON report itself is always the first artifact (US-032).
    const artifacts: EvidenceArtifact[] = [
      { type: "report", path: ctx.reportVaultPath, label: "Cucumber JSON report" },
    ];
    const result: TestRunResult = { passed: 0, failed: 0, skipped: 0, total: 0 };

    for (const rawFeature of features) {
      this.mapFeature(rawFeature, ctx.reportVaultPath, scenarioResults, artifacts, result);
    }

    return { result, scenarioResults, artifacts };
  }

  /** Maps one feature element from the report into scenario results and artifacts. */
  private mapFeature(
    rawFeature: unknown,
    reportVaultPath: VaultPath,
    scenarioResults: ScenarioResult[],
    artifacts: EvidenceArtifact[],
    result: TestRunResult,
  ): void {
    if (!isRecord(rawFeature)) return;
    const feature = rawFeature as CucumberFeature;
    const featureUri = typeof feature.uri === "string" ? feature.uri : undefined;
    const featureName = typeof feature.name === "string" ? feature.name : (featureUri ?? "");
    const elements = Array.isArray(feature.elements) ? feature.elements : [];
    // A failed Background fails every scenario it precedes (Cucumber marks
    // their steps skipped), so fold it into those scenarios rather than
    // counting it AND the skipped scenarios (no double-count).
    // The current background's steps govern the scenarios that follow it. Keep
    // the steps (for duration + screenshot/trace artifacts, even when the
    // background PASSES) separate from whether it FAILED (which fails those
    // scenarios) so passing-background attachments are still collected.
    let bgSteps: CucumberStep[] = [];
    let bgFailed = false;
    let scenarioCount = 0;

    for (const rawScenario of elements) {
      if (!isRecord(rawScenario)) continue;
      const scenario = rawScenario as CucumberScenario;
      if (scenario.type === "background") {
        // A later background (e.g. a Rule-specific or per-scenario background)
        // replaces the prior one for the scenarios that follow IT — including
        // clearing a carried-over failure, otherwise every following scenario
        // would be mis-reported as failed.
        bgSteps = (Array.isArray(scenario.steps) ? scenario.steps : []).filter(isRecord);
        bgFailed = scenarioStatus(bgSteps) === "failed";
        continue;
      }
      scenarioCount += 1;
      this.mapScenario(
        scenario,
        featureName,
        featureUri,
        bgSteps,
        bgFailed,
        reportVaultPath,
        scenarioResults,
        artifacts,
        result,
      );
    }

    // A failed Background with no scenarios after it: surface it on its own so
    // the failure isn't lost (no scenario to fold it into).
    if (bgFailed && scenarioCount === 0) {
      scenarioResults.push({
        feature: featureName,
        featureUri,
        scenario: "Background",
        status: "failed",
        durationMs: totalDurationMs(bgSteps),
        errorMessage: firstErrorMessage(bgSteps),
      });
      result.failed += 1;
      result.total += 1;
      collectArtifacts(bgSteps, reportVaultPath, artifacts);
    }
  }

  /** Maps one scenario element into scenario results and artifacts. */
  private mapScenario(
    scenario: CucumberScenario,
    featureName: string,
    featureUri: string | undefined,
    bgSteps: CucumberStep[],
    bgFailed: boolean,
    reportVaultPath: VaultPath,
    scenarioResults: ScenarioResult[],
    artifacts: EvidenceArtifact[],
    result: TestRunResult,
  ): void {
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
    // Always fold the governing background's steps in — for duration and for
    // its screenshot/trace artifacts — even when it passed.
    const stepsAndHooks = [...bgSteps, ...steps, ...hooks];

    // A preceding failed Background fails this scenario even when its own
    // steps are skipped.
    const status = bgFailed ? "failed" : scenarioStatus(steps, hooks);
    const durationMs = totalDurationMs(stepsAndHooks);
    const errorMessage = firstErrorMessage(stepsAndHooks);
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

    collectArtifacts(stepsAndHooks, reportVaultPath, artifacts);
  }
}

/** Sum of step durations (ns→ms); undefined when no step reported a duration. */
function totalDurationMs(steps: CucumberStep[]): number | undefined {
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
function firstErrorMessage(steps: CucumberStep[]): string | undefined {
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
function collectArtifacts(
  steps: CucumberStep[],
  reportVaultPath: VaultPath,
  artifacts: EvidenceArtifact[],
): void {
  for (const step of steps) {
    collectStepArtifacts(step, reportVaultPath, artifacts);
  }
}

/**
 * Processes one step's embeddings/attachments (US-033/034). Defensive:
 * a malformed report may have non-array fields or null entries — narrow before
 * dereferencing so import() returns a Result instead of throwing.
 */
function collectStepArtifacts(
  step: CucumberStep,
  reportVaultPath: VaultPath,
  artifacts: EvidenceArtifact[],
): void {
  const attachments = [
    ...(Array.isArray(step.embeddings) ? step.embeddings : []),
    ...(Array.isArray(step.attachments) ? step.attachments : []),
  ];
  for (const attachment of attachments) {
    if (!isRecord(attachment)) continue;
    const artifact = attachmentToArtifact(attachment, reportVaultPath);
    if (artifact) artifacts.push(artifact);
  }
}

/**
 * Converts one attachment record to an {@link EvidenceArtifact} reference, or
 * `null` if the MIME type is not a recognised artifact type. The artifact always
 * points at the concrete report file (not a derived/embedded copy, ADR-0016).
 */
function attachmentToArtifact(
  rawAttachment: Record<string, unknown>,
  reportVaultPath: VaultPath,
): EvidenceArtifact | null {
  // Cast to the Cucumber attachment shape so dot-notation access is valid; fields
  // are optional so the defensiveness is preserved at the type level.
  const attachment = rawAttachment as CucumberAttachment;
  const media = attachment.media;
  // Resolve MIME from either the top-level field or the nested `media.type`
  // field — Cucumber-JS has used both layouts across versions.
  const mime =
    typeof attachment.mime_type === "string"
      ? attachment.mime_type
      : isRecord(media) && typeof media.type === "string"
        ? media.type
        : "";
  const type = artifactType(mime);
  if (!type) return null;
  return {
    type,
    // Embedded artifacts live inline (base64) inside the report file, so
    // reference the concrete report we actually read (the run-specific
    // snapshot when present) — not the fixed path, which a later run
    // deletes/overwrites, leaving the link dangling.
    path: reportVaultPath,
    // The MIME string is report-controlled, display-only data; constrain
    // it to the RFC token charset so a crafted value can't smuggle
    // Markdown/link syntax into the evidence note (defense-in-depth — the
    // evidence sink also sanitizes wikilink aliases).
    label: mime && /^[A-Za-z0-9.+/-]+$/.test(mime) ? mime : type,
  };
}

/** Maps an attachment MIME type to an evidence artifact type, or null. */
function artifactType(mime: string): EvidenceArtifact["type"] | null {
  if (mime.startsWith("image/")) return "screenshot";
  if (mime.includes("zip") || mime.includes("trace")) return "trace";
  return null;
}
