import { describe, expect, it } from "vitest";
import { CucumberJsonReportParser } from "../src/application/services/cucumber-json-report-parser";
import { DefaultReportImportService } from "../src/application/services/report-import-service";
import { DefaultSettingsService } from "../src/application/services/settings-service";
import { DefaultPathSafetyPolicy } from "../src/domain/policies/path-safety-policy";
import type { TestRun } from "../src/domain/entities/test-run";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";
import { FakeAbsoluteFileSystem, FakeDataStore, recordingEventBus, silentLogger } from "./fakes";
import { assertArtifactReferences, REPRESENTATIVE_REPORT } from "./cucumber-report-fixtures";

const REPORT_ABS = "/vault/.testrunner/reports/cucumber-report.json";
const REPORT_VAULT = ".testrunner/reports/cucumber-report.json";
const REPORT_VAULT_PREFIX = ".testrunner/reports";

const run = (overrides: Partial<TestRun> = {}): TestRun => ({
  id: "RUN-2026-05-31-100000",
  scope: "all",
  target: "all",
  status: "passed",
  startedAt: "2026-05-31T10:00:00.000Z",
  command: "npm run test",
  workingDirectory: vp(".testrunner"),
  reportPaths: {},
  ...overrides,
});

const build = () => {
  const { bus, events, types } = recordingEventBus();
  const settings = new DefaultSettingsService(
    new FakeDataStore(),
    new DefaultPathSafetyPolicy(),
    bus,
  );
  const absoluteFs = new FakeAbsoluteFileSystem();
  const service = new DefaultReportImportService(
    settings,
    absoluteFs,
    new CucumberJsonReportParser(),
    bus,
    silentLogger,
  );
  return { service, absoluteFs, events, types };
};

describe("DefaultReportImportService", () => {
  it("parses statuses into TestRunResult counts and ScenarioResult statuses", async () => {
    const { service, absoluteFs } = build();
    absoluteFs.seed(REPORT_ABS, REPRESENTATIVE_REPORT);

    const result = await service.import(run());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const report = result.value;
    // passed + (failed: declined) + (skipped: all-skipped) + (failed: undefined) = 4.
    expect(report.result).toEqual({ passed: 1, failed: 2, skipped: 1, total: 4 });

    const byName = Object.fromEntries(report.scenarioResults.map((s) => [s.scenario, s.status]));
    expect(byName["Successful checkout"]).toBe("passed");
    expect(byName["Declined card"]).toBe("failed");
    expect(byName["All skipped"]).toBe("skipped");
    // undefined step → failure-like, not skipped (the run exits non-zero).
    expect(byName["Undefined step"]).toBe("failed");
    // Background excluded.
    expect(report.scenarioResults).toHaveLength(4);

    const passed = report.scenarioResults.find((s) => s.scenario === "Successful checkout");
    expect(passed?.durationMs).toBe(3); // 1ms + 2ms (ns→ms)
    expect(passed?.feature).toBe("Checkout");

    const failed = report.scenarioResults.find((s) => s.scenario === "Declined card");
    expect(failed?.errorMessage).toBe("card declined");
  });

  it("collects the report and screenshot embeddings as artifact references", async () => {
    const { service, absoluteFs } = build();
    absoluteFs.seed(REPORT_ABS, REPRESENTATIVE_REPORT);

    const result = await service.import(run());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    assertArtifactReferences(result.value.artifacts, REPORT_VAULT_PREFIX);
  });

  it("emits only report.imported on success", async () => {
    const { service, absoluteFs, types } = build();
    absoluteFs.seed(REPORT_ABS, REPRESENTATIVE_REPORT);

    await service.import(run());
    // report.detected was removed (it triggered a never-built FS watcher); the
    // PostRunCoordinator now drives the import from the terminal run event.
    expect(types()).toEqual(["report.imported"]);
  });

  it("report.imported payload references the vault path and scenario count", async () => {
    const { service, absoluteFs, events } = build();
    absoluteFs.seed(REPORT_ABS, REPRESENTATIVE_REPORT);

    await service.import(run());
    const imported = events.find((e) => e.type === "report.imported");
    expect(imported?.payload).toMatchObject({
      runId: "RUN-2026-05-31-100000",
      reportPath: REPORT_VAULT,
      scenarioResults: 4,
    });
  });

  it("returns REPORT_NOT_FOUND + report.import.failed when the report is missing", async () => {
    const { service, types, events } = build();

    const result = await service.import(run());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("REPORT_NOT_FOUND");
    expect(types()).toEqual(["report.import.failed"]);
    expect(events.find((e) => e.type === "report.import.failed")?.payload).toMatchObject({
      runId: "RUN-2026-05-31-100000",
      reportPath: REPORT_VAULT,
    });
  });

  it("returns REPORT_PARSE_FAILED + report.import.failed on invalid JSON", async () => {
    const { service, absoluteFs, types } = build();
    absoluteFs.seed(REPORT_ABS, "{ not valid json");

    const result = await service.import(run());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("REPORT_PARSE_FAILED");
    expect(types()).toContain("report.import.failed");
  });

  it("returns REPORT_PARSE_FAILED when the report root is not an array", async () => {
    const { service, absoluteFs } = build();
    absoluteFs.seed(REPORT_ABS, JSON.stringify({ not: "an array" }));

    const result = await service.import(run());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("REPORT_PARSE_FAILED");
  });

  it("tolerates malformed (null) step entries without throwing", async () => {
    const { service, absoluteFs } = build();
    absoluteFs.seed(
      REPORT_ABS,
      JSON.stringify([
        {
          name: "F",
          uri: "features/UC-001-x.feature",
          elements: [{ name: "S", steps: [null, { result: { status: "passed" } }] }],
        },
      ]),
    );

    const result = await service.import(run());
    expect(result.ok).toBe(true); // defensive parse: corrupt step skipped, not thrown
    if (!result.ok) return;
    expect(result.value.scenarioResults[0].status).toBe("passed");
  });

  it("tolerates malformed embeddings/attachments (non-array / null) without throwing", async () => {
    const { service, absoluteFs } = build();
    absoluteFs.seed(
      REPORT_ABS,
      JSON.stringify([
        {
          name: "F",
          uri: "features/UC-001-x.feature",
          elements: [
            {
              name: "S",
              steps: [
                { result: { status: "passed" }, embeddings: "not-an-array", attachments: [null] },
              ],
            },
          ],
        },
      ]),
    );

    const result = await service.import(run());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.scenarioResults[0].status).toBe("passed");
  });

  it("surfaces a failed Background as a failed result instead of dropping it", async () => {
    const { service, absoluteFs } = build();
    absoluteFs.seed(
      REPORT_ABS,
      JSON.stringify([
        {
          name: "F",
          uri: "features/UC-001-x.feature",
          elements: [
            {
              name: "BG",
              type: "background",
              steps: [{ result: { status: "failed", error_message: "setup boom" } }],
            },
            { name: "S", type: "scenario", steps: [{ result: { status: "skipped" } }] },
          ],
        },
      ]),
    );

    const result = await service.import(run());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.result.failed).toBe(1);
    expect(result.value.scenarioResults.some((s) => s.status === "failed")).toBe(true);
  });

  it("does not carry a failed Background's failure past a later passing Background", async () => {
    const { service, absoluteFs } = build();
    absoluteFs.seed(
      REPORT_ABS,
      JSON.stringify([
        {
          name: "F",
          uri: "features/UC-001-x.feature",
          elements: [
            {
              name: "BG1",
              type: "background",
              steps: [{ result: { status: "failed", error_message: "setup boom" } }],
            },
            { name: "S1", type: "scenario", steps: [{ result: { status: "skipped" } }] },
            // A later (e.g. Rule-specific) background that passes must govern S2,
            // not inherit BG1's failure.
            { name: "BG2", type: "background", steps: [{ result: { status: "passed" } }] },
            { name: "S2", type: "scenario", steps: [{ result: { status: "passed" } }] },
          ],
        },
      ]),
    );

    const result = await service.import(run());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.result.failed).toBe(1);
    expect(result.value.result.passed).toBe(1);
    const s2 = result.value.scenarioResults.find((s) => s.scenario === "S2");
    expect(s2?.status).toBe("passed");
  });

  it("loads the run-start feature snapshot when the run wrote one (US-056)", async () => {
    const { service, absoluteFs } = build();
    absoluteFs.seed(REPORT_ABS, REPRESENTATIVE_REPORT);
    const snap = {
      "Specifications/features/UC-001-x.feature": "Feature: F\n  Scenario: S\n    Given x\n",
    };
    absoluteFs.seed(
      "/vault/.testrunner/reports/RUN-2026-05-31-100000.features.json",
      JSON.stringify(snap),
    );
    const result = await service.import(
      run({
        reportPaths: { features: vp(".testrunner/reports/RUN-2026-05-31-100000.features.json") },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.featureSnapshot).toEqual(snap);
  });

  it("omits featureSnapshot when the run wrote no snapshot", async () => {
    const { service, absoluteFs } = build();
    absoluteFs.seed(REPORT_ABS, REPRESENTATIVE_REPORT);
    const result = await service.import(run());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.featureSnapshot).toBeUndefined();
  });
});
