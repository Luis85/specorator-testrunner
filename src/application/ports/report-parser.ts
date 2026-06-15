import type { EvidenceArtifact } from "../../domain/entities/evidence";
import type { TestRunResult } from "../../domain/entities/test-run";
import type { RunId, VaultPath } from "../../domain/value-objects/identifiers";
import type { Result } from "../../shared/result/result";

/** One scenario's rolled-up outcome (display + UC-linking fields). */
export interface ScenarioResult {
  feature: string; // human-readable feature name (display)
  featureUri?: string; // feature file path (e.g. features/UC-001-x.feature) for UC linking
  scenario: string;
  status: "passed" | "failed" | "skipped";
  durationMs?: number;
  errorMessage?: string;
  scenarioId?: string; // cucumber-JSON element id (feature;scenario;;<row>) — stable per-row identity (US-055)
  line?: number; // feature-file line of the scenario / outline row (fallback discriminator)
  scenarioRef?: string; // Scenario Reference (<featurePath>::<name>[::row-<digest>]), set by ScenarioIdentityResolver (US-056)
}

/** A parsed run report: counts, per-scenario rows, and artifact REFERENCES. */
export interface ParsedReport {
  result: TestRunResult;
  scenarioResults: ScenarioResult[];
  artifacts: EvidenceArtifact[];
}

/** Context a parser needs to build vault-relative artifact references. */
export interface ReportParseContext {
  runId: RunId;
  runnerPath: VaultPath; // the .testrunner root this run spawned in
  reportVaultPath: VaultPath; // vault-relative path of the report file itself
}

/**
 * Parses a runner report's raw text into a {@link ParsedReport}. Pure: no
 * filesystem, no events — `DefaultReportImportService` owns the I/O and the
 * `report.imported` / `report.import.failed` emissions. The first
 * implementation parses cucumber-JSON (ADR-0021); a Cucumber Messages parser
 * (ADR-0022) and others (EPIC-019) slot in beside it without touching the
 * service.
 */
export interface ReportParser {
  /** Returns `REPORT_PARSE_FAILED` (typed err) on malformed input. */
  parse(rawContent: string, ctx: ReportParseContext): Result<ParsedReport>;
}
