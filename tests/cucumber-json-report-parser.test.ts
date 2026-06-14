import { describe, expect, it } from "vitest";
import { CucumberJsonReportParser } from "../src/application/services/cucumber-json-report-parser";
import type { ReportParseContext } from "../src/application/ports/report-parser";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";
import { assertArtifactReferences, REPRESENTATIVE_REPORT } from "./cucumber-report-fixtures";

const parser = new CucumberJsonReportParser();

const ctx = (): ReportParseContext => ({
  runId: "RUN-2026-05-31-100000",
  runnerPath: vp(".testrunner"),
  reportVaultPath: vp(".testrunner/reports/cucumber-report.json"),
});

const REPORT_VAULT_PREFIX = ".testrunner/reports";

/** Minimal single-feature fixture builder for focused edge-case tests. */
const singleFeature = (elements: unknown[]): string =>
  JSON.stringify([{ name: "F", uri: "features/UC-001-x.feature", elements }]);

describe("CucumberJsonReportParser", () => {
  // ---------- parse errors ----------

  it("returns REPORT_PARSE_FAILED with cause on invalid JSON", () => {
    const result = parser.parse("{ not valid json", ctx());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("REPORT_PARSE_FAILED");
    expect(result.error.cause).toBeInstanceOf(SyntaxError);
  });

  it("returns REPORT_PARSE_FAILED when report root is not an array", () => {
    const result = parser.parse(JSON.stringify({ not: "an array" }), ctx());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("REPORT_PARSE_FAILED");
    expect(result.error.message).toMatch(/not a Cucumber feature array/);
  });

  // ---------- status rollup ----------

  it("rolls up step statuses into scenario status and feature counts", () => {
    const result = parser.parse(REPRESENTATIVE_REPORT, ctx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.result).toEqual({ passed: 1, failed: 2, skipped: 1, total: 4 });

    const byName = Object.fromEntries(
      result.value.scenarioResults.map((s) => [s.scenario, s.status]),
    );
    expect(byName["Successful checkout"]).toBe("passed");
    expect(byName["Declined card"]).toBe("failed");
    expect(byName["All skipped"]).toBe("skipped");
    // undefined step → failure-like, not skipped
    expect(byName["Undefined step"]).toBe("failed");
    // Background excluded
    expect(result.value.scenarioResults).toHaveLength(4);

    const passed = result.value.scenarioResults.find((s) => s.scenario === "Successful checkout");
    expect(passed?.durationMs).toBe(3); // 1ms + 2ms (ns→ms)
    expect(passed?.feature).toBe("Checkout");

    const failed = result.value.scenarioResults.find((s) => s.scenario === "Declined card");
    expect(failed?.errorMessage).toBe("card declined");
  });

  // ---------- artifact references ----------

  it("includes the report itself and screenshot embeddings as artifact references", () => {
    const result = parser.parse(REPRESENTATIVE_REPORT, ctx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    assertArtifactReferences(result.value.artifacts, REPORT_VAULT_PREFIX);
  });

  it("returns a report artifact referenced to the ctx.reportVaultPath", () => {
    const customCtx: ReportParseContext = {
      runId: "RUN-2026-05-31-100000",
      runnerPath: vp(".testrunner"),
      reportVaultPath: vp(".testrunner/reports/RUN-2026-05-31-100000.json"),
    };
    const raw = JSON.stringify([
      {
        name: "F",
        elements: [{ name: "S", type: "scenario", steps: [{ result: { status: "passed" } }] }],
      },
    ]);

    const result = parser.parse(raw, customCtx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const reportArtifact = result.value.artifacts.find((a) => a.type === "report");
    expect(reportArtifact?.path).toBe(".testrunner/reports/RUN-2026-05-31-100000.json");
  });

  // ---------- failed Before hook ----------

  it("fails a scenario when a Before hook fails even if steps look skipped", () => {
    const raw = singleFeature([
      {
        name: "S",
        type: "scenario",
        before: [{ result: { status: "failed", error_message: "browser setup failed" } }],
        steps: [{ result: { status: "skipped" } }],
      },
    ]);

    const result = parser.parse(raw, ctx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.result.failed).toBe(1);
    expect(result.value.scenarioResults[0]?.status).toBe("failed");
  });

  // ---------- background folding ----------

  it("surfaces a failed Background as a failed result instead of dropping it", () => {
    const raw = singleFeature([
      {
        name: "BG",
        type: "background",
        steps: [{ result: { status: "failed", error_message: "setup boom" } }],
      },
      { name: "S", type: "scenario", steps: [{ result: { status: "skipped" } }] },
    ]);

    const result = parser.parse(raw, ctx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.result.failed).toBe(1);
    expect(result.value.scenarioResults.some((s) => s.status === "failed")).toBe(true);
  });

  it("does not carry a failed Background's failure past a later passing Background", () => {
    const raw = singleFeature([
      {
        name: "BG1",
        type: "background",
        steps: [{ result: { status: "failed", error_message: "setup boom" } }],
      },
      { name: "S1", type: "scenario", steps: [{ result: { status: "skipped" } }] },
      // A later background that passes must govern S2, not inherit BG1's failure
      { name: "BG2", type: "background", steps: [{ result: { status: "passed" } }] },
      { name: "S2", type: "scenario", steps: [{ result: { status: "passed" } }] },
    ]);

    const result = parser.parse(raw, ctx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.result.failed).toBe(1);
    expect(result.value.result.passed).toBe(1);
    const s2 = result.value.scenarioResults.find((s) => s.scenario === "S2");
    expect(s2?.status).toBe("passed");
  });

  // ---------- malformed / defensive parsing ----------

  it("tolerates malformed (null) step entries without throwing", () => {
    const raw = singleFeature([{ name: "S", steps: [null, { result: { status: "passed" } }] }]);

    const result = parser.parse(raw, ctx());
    expect(result.ok).toBe(true); // corrupt step skipped, not thrown
    if (!result.ok) return;
    expect(result.value.scenarioResults[0]?.status).toBe("passed");
  });

  it("carries the element id and line onto ScenarioResult", () => {
    const report = JSON.stringify([
      {
        name: "F",
        uri: "features/UC-1-x.feature",
        elements: [
          {
            name: "S",
            type: "scenario",
            id: "f;s;;2",
            line: 7,
            steps: [{ keyword: "Given ", result: { status: "passed", duration: 1000000 } }],
          },
        ],
      },
    ]);
    const parsed = parser.parse(report, ctx());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.scenarioResults[0].scenarioId).toBe("f;s;;2");
    expect(parsed.value.scenarioResults[0].line).toBe(7);
  });

  it("tolerates malformed embeddings/attachments (non-array / null) without throwing", () => {
    const raw = singleFeature([
      {
        name: "S",
        steps: [{ result: { status: "passed" }, embeddings: "not-an-array", attachments: [null] }],
      },
    ]);

    const result = parser.parse(raw, ctx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.scenarioResults[0]?.status).toBe("passed");
  });
});
