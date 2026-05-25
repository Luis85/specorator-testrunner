import { describe, expect, it } from "vitest";
import { renderReportNote, toHistoryRecords, toNdjson } from "../src/reporting";
import type { RunResult } from "../src/types";

const RESULT: RunResult = {
  runId: "run-1",
  startedAt: "2026-05-25T10:00:00.000Z",
  finishedAt: "2026-05-25T10:00:05.000Z",
  durationMs: 5000,
  env: "test",
  totals: { total: 2, passed: 1, failed: 1, skipped: 0, flaky: 0 },
  success: false,
  scenarios: [
    {
      caseId: "TC-1",
      title: "ok",
      status: "passed",
      attempts: 1,
      durationMs: 1200,
      steps: [{ keyword: "Given", text: 'opens "/x"', line: 3, status: "passed", durationMs: 100 }],
    },
    {
      caseId: "TC-2",
      title: "bad",
      status: "failed",
      attempts: 1,
      durationMs: 800,
      steps: [
        {
          keyword: "Then",
          text: 'the page should show "Welcome"',
          line: 4,
          status: "failed",
          durationMs: 500,
          message: "not visible",
        },
      ],
    },
  ],
};

describe("renderReportNote", () => {
  it("emits Dataview-friendly frontmatter and a results table", () => {
    const md = renderReportNote(RESULT);
    expect(md).toContain("specorator: report");
    expect(md).toContain("failed: 1");
    expect(md).toContain("| TC-1 | ok | PASS |");
    expect(md).toContain("## Failures");
    expect(md).toContain("not visible");
  });
});

describe("toHistoryRecords", () => {
  it("produces one record per scenario with the failed step captured", () => {
    const records = toHistoryRecords(RESULT, "auth");
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ caseId: "TC-1", status: "passed", failedStep: null });
    expect(records[1].failedStep?.message).toBe("not visible");
    expect(toNdjson(records).trim().split("\n")).toHaveLength(2);
  });
});
