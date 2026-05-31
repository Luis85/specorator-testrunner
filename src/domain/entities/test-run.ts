import type { RunId, VaultPath } from "../value-objects/identifiers";

/** Test-run domain types (TIS §6.8–§6.13). */

export type ExecutionScope = "use-case" | "feature" | "suite" | "all" | "demo";

export type TestRunStatus =
  | "queued"
  | "running"
  | "passed"
  | "failed"
  | "errored" // never reached normal completion (EN-2)
  | "cancelled";

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
export type UseCaseRunOutcome = TestRunStatus | "skipped";

export interface TestRunSummary {
  runId: RunId;
  status: UseCaseRunOutcome;
  date: string;
  evidencePath?: VaultPath;
  /** Scope of the run, so the roll-up knows whether it covered the whole UC. */
  scope?: ExecutionScope;
}
