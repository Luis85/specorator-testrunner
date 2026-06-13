import { describe, expect, it } from "vitest";
import type { ParsedReport, ReportParser } from "../src/application/ports/report-parser";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";

describe("ReportParser port", () => {
  it("a conforming parser satisfies the interface and returns the ParsedReport shape", () => {
    const stub: ReportParser = {
      parse: () => ({
        ok: true,
        value: {
          result: { passed: 0, failed: 0, skipped: 0, total: 0 },
          scenarioResults: [],
          artifacts: [],
        },
      }),
    };
    const parsed = stub.parse("", {
      runId: "RUN-x",
      runnerPath: vp("TestHub/.testrunner"),
      reportVaultPath: vp("TestHub/.testrunner/reports/cucumber-report.json"),
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const report: ParsedReport = parsed.value;
    expect(report.result.total).toBe(0);
    expect(report.scenarioResults).toEqual([]);
    expect(report.artifacts).toEqual([]);
  });
});
