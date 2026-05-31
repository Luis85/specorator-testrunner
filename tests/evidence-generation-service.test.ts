import { describe, expect, it } from "vitest";
import { DefaultEvidenceGenerationService } from "../src/application/services/evidence-generation-service";
import type { ImportedReport } from "../src/application/services/report-import-service";
import { DefaultSettingsService } from "../src/application/services/settings-service";
import { DefaultUseCaseService } from "../src/application/services/use-case-service";
import { buildUseCaseNote } from "../src/application/content/use-case-content";
import { DefaultPathSafetyPolicy } from "../src/domain/policies/path-safety-policy";
import type { TestRun } from "../src/domain/entities/test-run";
import type { UseCase } from "../src/domain/entities/use-case";
import { parseFrontmatter } from "../src/shared/utils/frontmatter";
import {
  FakeDataStore,
  FakeVaultFileSystem,
  recordingEventBus,
  silentLogger,
} from "./fakes";

const EVIDENCE_PATH = "Test Evidence/2026/05/RUN-2026-05-31-100000/summary.md";
const FIXED_NOW = new Date("2026-05-31T10:05:00.000Z");

const run = (overrides: Partial<TestRun> = {}): TestRun => ({
  id: "RUN-2026-05-31-100000",
  scope: "use-case",
  target: "UC-001",
  status: "failed",
  startedAt: "2026-05-31T10:00:00.000Z",
  command: "npm run test",
  workingDirectory: ".testrunner",
  reportPaths: {},
  ...overrides,
});

const report = (overrides: Partial<ImportedReport> = {}): ImportedReport => ({
  runId: "RUN-2026-05-31-100000",
  result: { passed: 2, failed: 1, skipped: 0, total: 3 },
  scenarioResults: [
    { feature: "Checkout", scenario: "Pays", status: "passed", durationMs: 5 },
    { feature: "Checkout", scenario: "Declines", status: "failed", errorMessage: "boom" },
  ],
  artifacts: [
    { type: "report", path: ".testrunner/reports/cucumber-report.json", label: "JSON" },
    { type: "screenshot", path: ".testrunner/reports", label: "image/png" },
  ],
  ...overrides,
});

const seedUseCase = (fs: FakeVaultFileSystem, id = "UC-001"): void => {
  const useCase: UseCase = {
    id,
    title: "Checkout",
    status: "automated",
    automationStatus: "implemented",
    featureFiles: [],
    suites: [],
    evidence: [],
    path: `Use Cases/${id} Checkout.md`,
  };
  fs.files.set(useCase.path, buildUseCaseNote(useCase));
};

const build = () => {
  const fs = new FakeVaultFileSystem();
  const { bus, events, types } = recordingEventBus();
  const settings = new DefaultSettingsService(
    new FakeDataStore(),
    new DefaultPathSafetyPolicy(),
    bus,
  );
  const useCaseService = new DefaultUseCaseService(settings, fs, bus, silentLogger);
  const service = new DefaultEvidenceGenerationService(
    fs,
    useCaseService,
    bus,
    silentLogger,
    () => FIXED_NOW,
  );
  return { service, fs, events, types };
};

describe("DefaultEvidenceGenerationService", () => {
  it("writes the partitioned Test Evidence/YYYY/MM/<runId>/summary.md note", async () => {
    const { service, fs } = build();
    seedUseCase(fs);

    const result = await service.generate({ run: run(), report: report() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.path).toBe(EVIDENCE_PATH);

    const note = fs.files.get(EVIDENCE_PATH);
    expect(note).toBeDefined();
    const fm = parseFrontmatter(note ?? "");
    expect(fm.type).toBe("test-evidence");
    expect(fm.run_id).toBe("RUN-2026-05-31-100000");
    expect(fm.status).toBe("failed");
    expect(fm.passed).toBe("2");
    expect(fm.failed).toBe("1");
    expect(fm.total).toBe("3");
    expect(fm.linked_use_cases).toEqual(["UC-001"]);
    // Results table + scenario list render in the body.
    expect(note).toContain("| 2 | 1 | 0 | 3 |");
    expect(note).toContain("Declines");
    // Artifacts are linked, never copied.
    expect(note).toContain("[[.testrunner/reports/cucumber-report.json|JSON]]");
  });

  it("links evidence into the owning Use Case (evidence[] + lastTestRun)", async () => {
    const { service, fs } = build();
    seedUseCase(fs);

    await service.generate({ run: run(), report: report() });

    const ucNote = fs.files.get("Use Cases/UC-001 Checkout.md");
    const fm = parseFrontmatter(ucNote ?? "");
    expect(fm.evidence).toEqual([EVIDENCE_PATH]);
    // lastTestRun is not a managed frontmatter field; the link surfaces via
    // evidence[] (the source of truth UseCaseService reads back).
    expect(ucNote).toContain(EVIDENCE_PATH);
  });

  it("emits evidence.generated then evidence.linkedToUseCase", async () => {
    const { service, fs, events, types } = build();
    seedUseCase(fs);

    await service.generate({ run: run(), report: report() });

    expect(types()).toContain("evidence.generated");
    expect(types()).toContain("evidence.linkedToUseCase");
    const generated = events.find((e) => e.type === "evidence.generated");
    expect(generated?.payload).toMatchObject({
      runId: "RUN-2026-05-31-100000",
      evidencePath: EVIDENCE_PATH,
      linkedUseCases: ["UC-001"],
    });
    const linked = events.find((e) => e.type === "evidence.linkedToUseCase");
    expect(linked?.payload).toMatchObject({
      useCaseId: "UC-001",
      evidencePath: EVIDENCE_PATH,
    });
  });

  it("resolves the Use Case from a feature-scope run's filename prefix", async () => {
    const { service, fs } = build();
    seedUseCase(fs);

    const result = await service.generate({
      run: run({ scope: "feature", target: "Specifications/features/UC-001-checkout.feature" }),
      report: report(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.linkedUseCases).toEqual(["UC-001"]);
  });

  it("generates evidence with no linked Use Case when none can be resolved", async () => {
    const { service, fs, types } = build();
    // No Use Case seeded.

    const result = await service.generate({
      run: run({ scope: "all", target: "all" }),
      report: report({ scenarioResults: [] }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.linkedUseCases).toEqual([]);
    // Evidence note still written; no link event emitted.
    expect(fs.files.get(EVIDENCE_PATH)).toBeDefined();
    expect(types()).toContain("evidence.generated");
    expect(types()).not.toContain("evidence.linkedToUseCase");
  });

  it("returns EVIDENCE_WRITE_FAILED when the note cannot be written", async () => {
    const { service, fs } = build();
    seedUseCase(fs);
    fs.failOn = { path: EVIDENCE_PATH, message: "disk full" };

    const result = await service.generate({ run: run(), report: report() });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("EVIDENCE_WRITE_FAILED");
  });
});
