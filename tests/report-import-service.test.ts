import { describe, expect, it } from "vitest";
import { DefaultReportImportService } from "../src/application/services/report-import-service";
import { DefaultSettingsService } from "../src/application/services/settings-service";
import { DefaultPathSafetyPolicy } from "../src/domain/policies/path-safety-policy";
import type { TestRun } from "../src/domain/entities/test-run";
import {
  FakeAbsoluteFileSystem,
  FakeDataStore,
  recordingEventBus,
  silentLogger,
} from "./fakes";

const REPORT_ABS = "/vault/.testrunner/reports/cucumber-report.json";
const REPORT_VAULT = ".testrunner/reports/cucumber-report.json";

const run = (overrides: Partial<TestRun> = {}): TestRun => ({
  id: "RUN-2026-05-31-100000",
  scope: "all",
  target: "all",
  status: "passed",
  startedAt: "2026-05-31T10:00:00.000Z",
  command: "npm run test",
  workingDirectory: ".testrunner",
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
  const service = new DefaultReportImportService(settings, absoluteFs, bus, silentLogger);
  return { service, absoluteFs, events, types };
};

// A representative Cucumber-JS JSON report: one passed scenario, one failed
// (with an error_message + an image embedding), one all-skipped, one undefined.
const REPORT = JSON.stringify([
  {
    name: "Checkout",
    uri: "features/UC-001-checkout.feature",
    elements: [
      {
        name: "Successful checkout",
        type: "scenario",
        steps: [
          { result: { status: "passed", duration: 1_000_000 } },
          { result: { status: "passed", duration: 2_000_000 } },
        ],
      },
      {
        name: "Declined card",
        type: "scenario",
        steps: [
          { result: { status: "passed", duration: 1_000_000 } },
          {
            result: { status: "failed", duration: 3_000_000, error_message: "card declined" },
            embeddings: [{ mime_type: "image/png", data: "base64==" }],
          },
        ],
      },
      {
        name: "All skipped",
        type: "scenario",
        steps: [{ result: { status: "skipped" } }, { result: { status: "skipped" } }],
      },
      {
        name: "Undefined step",
        type: "scenario",
        steps: [
          { result: { status: "passed", duration: 1_000_000 } },
          { result: { status: "undefined" } },
        ],
      },
      // Backgrounds carry no independent result and must be ignored.
      { name: "setup", type: "background", steps: [{ result: { status: "passed" } }] },
    ],
  },
]);

describe("DefaultReportImportService", () => {
  it("parses statuses into TestRunResult counts and ScenarioResult statuses", async () => {
    const { service, absoluteFs } = build();
    absoluteFs.seed(REPORT_ABS, REPORT);

    const result = await service.import(run());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const report = result.value;
    // passed + failed + (skipped: all-skipped) + (skipped: undefined) = 4 scenarios.
    expect(report.result).toEqual({ passed: 1, failed: 1, skipped: 2, total: 4 });

    const byName = Object.fromEntries(
      report.scenarioResults.map((s) => [s.scenario, s.status]),
    );
    expect(byName["Successful checkout"]).toBe("passed");
    expect(byName["Declined card"]).toBe("failed");
    expect(byName["All skipped"]).toBe("skipped");
    expect(byName["Undefined step"]).toBe("skipped");
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
    absoluteFs.seed(REPORT_ABS, REPORT);

    const result = await service.import(run());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const types = result.value.artifacts.map((a) => a.type);
    expect(types).toContain("report");
    expect(types).toContain("screenshot");
    // References only — into .testrunner/reports, never copied bytes.
    for (const artifact of result.value.artifacts) {
      expect(artifact.path.startsWith(".testrunner/reports")).toBe(true);
    }
  });

  it("emits report.detected then report.imported on success", async () => {
    const { service, absoluteFs, types } = build();
    absoluteFs.seed(REPORT_ABS, REPORT);

    await service.import(run());
    expect(types()).toEqual(["report.detected", "report.imported"]);
  });

  it("report.imported payload references the vault path and scenario count", async () => {
    const { service, absoluteFs, events } = build();
    absoluteFs.seed(REPORT_ABS, REPORT);

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
    expect(types()).toEqual(["report.detected", "report.import.failed"]);
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
        { name: "F", uri: "features/UC-001-x.feature", elements: [{ name: "S", steps: [null, { result: { status: "passed" } }] }] },
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
});
