import { describe, expect, it } from "vitest";
import {
  prependCapped,
  toExecutionLogEntry,
  type ExecutionLogEntry,
} from "../src/domain/entities/execution-log";
import { executionRun as run } from "./execution-log-fixtures";

const entry = (overrides: Partial<ExecutionLogEntry> = {}): ExecutionLogEntry => ({
  runId: "RUN-2026-06-01-100000",
  scope: "use-case",
  target: "UC-001",
  status: "passed",
  startedAt: "2026-06-01T10:00:00.000Z",
  finishedAt: "2026-06-01T10:01:00.000Z",
  ...overrides,
});

describe("toExecutionLogEntry", () => {
  it("projects the terminal run's identity, scope, target, status and timestamps", () => {
    expect(toExecutionLogEntry(run())).toEqual({
      runId: "RUN-2026-06-01-100000",
      scope: "use-case",
      target: "UC-001",
      status: "passed",
      startedAt: "2026-06-01T10:00:00.000Z",
      finishedAt: "2026-06-01T10:01:00.000Z",
      durationMs: 60000,
      result: { passed: 1, failed: 0, skipped: 0, total: 1 },
    });
  });

  it("falls back finishedAt to startedAt when the run carries none (defensive)", () => {
    const projected = toExecutionLogEntry(run({ finishedAt: undefined }));
    expect(projected.finishedAt).toBe("2026-06-01T10:00:00.000Z");
  });

  it("omits durationMs and result when the run has neither (errored/cancelled)", () => {
    const projected = toExecutionLogEntry(
      run({ status: "errored", durationMs: undefined, result: undefined }),
    );
    expect("durationMs" in projected).toBe(false);
    expect("result" in projected).toBe(false);
    expect(projected.status).toBe("errored");
  });

  it("carries durationMs without result, and result without durationMs", () => {
    expect(toExecutionLogEntry(run({ result: undefined })).durationMs).toBe(60000);
    expect("result" in toExecutionLogEntry(run({ result: undefined }))).toBe(false);

    const withResult = toExecutionLogEntry(run({ durationMs: undefined }));
    expect(withResult.result).toEqual({ passed: 1, failed: 0, skipped: 0, total: 1 });
    expect("durationMs" in withResult).toBe(false);
  });
});

describe("prependCapped", () => {
  it("places the new entry at the head (newest-first)", () => {
    const older = entry({ runId: "RUN-A" });
    const result = prependCapped([older], entry({ runId: "RUN-B" }), 50);
    expect(result.map((e) => e.runId)).toEqual(["RUN-B", "RUN-A"]);
  });

  it("dedupes: a re-record of the same runId replaces the prior entry at the head", () => {
    const first = entry({ runId: "RUN-A", status: "passed" });
    const other = entry({ runId: "RUN-B" });
    const reRecord = entry({ runId: "RUN-A", status: "failed" });
    const result = prependCapped([first, other], reRecord, 50);
    expect(result.map((e) => e.runId)).toEqual(["RUN-A", "RUN-B"]);
    expect(result[0].status).toBe("failed");
  });

  it("truncates to the cap, keeping the newest entries", () => {
    const existing = [entry({ runId: "RUN-A" }), entry({ runId: "RUN-B" })];
    const result = prependCapped(existing, entry({ runId: "RUN-C" }), 2);
    expect(result.map((e) => e.runId)).toEqual(["RUN-C", "RUN-A"]);
  });

  it("returns an empty list when cap is 0", () => {
    expect(prependCapped([entry({ runId: "RUN-A" })], entry({ runId: "RUN-B" }), 0)).toEqual([]);
  });

  it("does not mutate the input list", () => {
    const existing = [entry({ runId: "RUN-A" })];
    prependCapped(existing, entry({ runId: "RUN-B" }), 50);
    expect(existing.map((e) => e.runId)).toEqual(["RUN-A"]);
  });
});
