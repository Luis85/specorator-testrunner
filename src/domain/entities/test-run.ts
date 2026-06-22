import type { RunId, VaultPath } from "../value-objects/identifiers";

/** Test-run domain types (TIS §6.8–§6.13). */

/**
 * Run scopes, as a runtime list so frontmatter read-back validation
 * (UseCaseService.parse) enumerates the same single source the
 * {@link ExecutionScope} union is derived from.
 */
export const EXECUTION_SCOPES = ["use-case", "feature", "suite", "all", "demo"] as const;

export type ExecutionScope = (typeof EXECUTION_SCOPES)[number];

/**
 * Run lifecycle states, as a runtime list so frontmatter read-back validation
 * enumerates the same single source the {@link TestRunStatus} union is
 * derived from.
 */
const TEST_RUN_STATUSES = [
  "queued",
  "running",
  "passed",
  "failed",
  "errored", // never reached normal completion (EN-2)
  "cancelled",
] as const;

export type TestRunStatus = (typeof TEST_RUN_STATUSES)[number];

/**
 * Runtime guard that a value is a {@link TestRunStatus}. Used where persisted
 * data (e.g. a hand-edited execution log) is read back against the union — the
 * compile-time type cannot vouch for bytes on disk.
 */
export const isTestRunStatus = (value: unknown): value is TestRunStatus =>
  typeof value === "string" && (TEST_RUN_STATUSES as readonly string[]).includes(value);

export interface TestRunResult {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
}

export interface ReportPaths {
  json?: VaultPath; // .testrunner/reports/cucumber-report.json
  html?: VaultPath; // .testrunner/reports/html/index.html
  markdown?: VaultPath; // Test Evidence/.../summary.md
  features?: VaultPath; // .testrunner/reports/<runId>.features.json — run-start feature snapshot (US-056)
  screenshots?: VaultPath[];
  traces?: VaultPath[];
}

export interface TestRun {
  id: RunId;
  scope: ExecutionScope;
  target: string; // id or path of the scoped entity
  status: TestRunStatus;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  command: string;
  workingDirectory: VaultPath;
  result?: TestRunResult;
  reportPaths: ReportPaths;
}

/**
 * Outcome of a Use Case's most recent run as seen by the ADR-0017 KPI roll-up.
 *
 * It is a {@link TestRunStatus} plus the extra `"skipped"` state: a per-UC
 * roll-up is `"skipped"` when all of this UC's scenarios in a broad run were
 * skipped. The roll-up policy treats `"skipped"` as exercised-but-not-passing —
 * distinct from a real `"passed"` — so a skipped UC does not count toward the
 * Passing KPI (ADR-0017).
 */
export const USE_CASE_RUN_OUTCOMES = [...TEST_RUN_STATUSES, "skipped"] as const;

export type UseCaseRunOutcome = (typeof USE_CASE_RUN_OUTCOMES)[number];

export interface TestRunSummary {
  runId: RunId;
  status: UseCaseRunOutcome;
  date: string;
  evidencePath?: VaultPath;
  /** Scope of the run, so the roll-up knows whether it covered the whole UC. */
  scope?: ExecutionScope;
}
