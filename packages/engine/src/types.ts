// Core domain types shared across the engine and its frontends.
// See DESIGN.md section 3 (data model) and section 5 (reports).

export type CaseStatus = "draft" | "ready" | "quarantined";

export type RunStatus = "passed" | "failed" | "skipped" | "flaky";

export type StepStatus =
  | "passed"
  | "failed"
  | "skipped"
  | "pending"
  | "undefined"
  | "ambiguous";

export interface TestCase {
  /** Stable id (e.g. "TC-login-001"); anchors run history across renames. */
  id: string;
  title: string;
  suite: string;
  tags: string[];
  status: CaseStatus;
  /** The Gherkin Feature extracted from the note's ```gherkin fence. */
  gherkin: string;
  /** Vault-relative path of the source note. */
  path: string;
}

export interface Suite {
  id: string;
  title: string;
  path: string;
  baseUrlRef?: string;
  order?: string[];
  caseIds: string[];
}

export interface ArtifactRef {
  /** Vault-relative or absolute path of the artifact (e.g. a screenshot). */
  path: string;
  mediaType: string;
}

export interface StepResult {
  keyword: string;
  text: string;
  line: number;
  status: StepStatus;
  durationMs: number;
  message?: string;
  screenshot?: ArtifactRef;
}

export interface ScenarioResult {
  caseId: string;
  title: string;
  status: RunStatus;
  attempts: number;
  durationMs: number;
  steps: StepResult[];
}

export interface RunTotals {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
}

export interface RunResult {
  runId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  env: string;
  scenarios: ScenarioResult[];
  totals: RunTotals;
  success: boolean;
}
