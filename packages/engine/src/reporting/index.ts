// Renders run results to a markdown report note and to canonical NDJSON
// history records. See DESIGN.md section 5.
//
// TODO(phase-2): flakiness scoring, regression detection, managed frontmatter
// rollups written back into case notes.

import type { RunResult, RunStatus, ScenarioResult } from "../types";

export interface HistoryRecord {
  v: 1;
  caseId: string;
  runId: string;
  suite?: string;
  ts: string;
  status: RunStatus;
  attempts: number;
  flakyInRun: boolean;
  durationMs: number;
  env: string;
  failedStep?: { text: string; line: number; message: string } | null;
}

/** One NDJSON history record per scenario in the run. */
export function toHistoryRecords(result: RunResult, suite?: string): HistoryRecord[] {
  return result.scenarios.map((sc) => {
    const failedStep = sc.steps.find((s) => s.status === "failed" || s.status === "undefined");
    return {
      v: 1,
      caseId: sc.caseId,
      runId: result.runId,
      suite,
      ts: result.finishedAt,
      status: sc.status,
      attempts: sc.attempts,
      flakyInRun: sc.attempts > 1,
      durationMs: sc.durationMs,
      env: result.env,
      failedStep: failedStep
        ? { text: failedStep.text, line: failedStep.line, message: failedStep.message ?? "" }
        : null,
    };
  });
}

/** Serialize history records to NDJSON (newline-delimited JSON). */
export function toNdjson(records: HistoryRecord[]): string {
  return records.map((r) => JSON.stringify(r)).join("\n") + "\n";
}

const STATUS_ICON: Record<RunStatus, string> = {
  passed: "PASS",
  failed: "FAIL",
  skipped: "SKIP",
  flaky: "FLAKY",
};

function scenarioRow(sc: ScenarioResult): string {
  return `| ${sc.caseId} | ${sc.title} | ${STATUS_ICON[sc.status]} | ${sc.attempts} | ${(sc.durationMs / 1000).toFixed(1)}s |`;
}

/** Render a per-run markdown report note (Dataview-friendly frontmatter + body). */
export function renderReportNote(result: RunResult): string {
  const t = result.totals;
  const fm = [
    "---",
    "specorator: report",
    `runId: ${result.runId}`,
    `startedAt: ${result.startedAt}`,
    `finishedAt: ${result.finishedAt}`,
    `durationMs: ${result.durationMs}`,
    `env: ${result.env}`,
    `total: ${t.total}`,
    `passed: ${t.passed}`,
    `failed: ${t.failed}`,
    `skipped: ${t.skipped}`,
    `flaky: ${t.flaky}`,
    `success: ${result.success}`,
    "---",
  ].join("\n");

  const summary = `**${t.passed} passed · ${t.failed} failed · ${t.skipped} skipped** — ${(result.durationMs / 1000).toFixed(1)}s — ${result.env}`;

  const table = [
    "| Case | Title | Status | Attempts | Duration |",
    "|------|-------|--------|----------|----------|",
    ...result.scenarios.map(scenarioRow),
  ].join("\n");

  const failures = result.scenarios
    .filter((sc) => sc.status === "failed")
    .map((sc) => {
      const failed = sc.steps.find((s) => s.status === "failed" || s.status === "undefined");
      return `### Failure: ${sc.caseId} — ${sc.title}\n- **Step (line ${failed?.line}):** \`${failed?.text}\`\n- **Message:**\n  \`\`\`\n  ${failed?.message ?? ""}\n  \`\`\``;
    })
    .join("\n\n");

  return [
    fm,
    `\n# Run ${result.runId}`,
    `\n${summary}`,
    `\n## Results\n${table}`,
    failures ? `\n## Failures\n${failures}` : "",
  ].join("\n");
}
