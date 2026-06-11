import { describe, expect, it } from "vitest";
import {
  DefaultEvidenceGenerationService,
  inlineMarkdownText,
  wikilinkAlias,
} from "../src/application/services/evidence-generation-service";
import type { ImportedReport } from "../src/application/services/report-import-service";
import { DefaultSettingsService } from "../src/application/services/settings-service";
import { DefaultUseCaseService } from "../src/application/services/use-case-service";
import { buildUseCaseNote } from "../src/application/content/use-case-content";
import { DefaultPathSafetyPolicy } from "../src/domain/policies/path-safety-policy";
import type { TestRun } from "../src/domain/entities/test-run";
import type { UseCase } from "../src/domain/entities/use-case";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";
import { parseFrontmatter } from "../src/shared/utils/frontmatter";
import { FakeDataStore, FakeVaultFileSystem, recordingEventBus, silentLogger } from "./fakes";

const EVIDENCE_PATH = vp("Test Evidence/2026/05/RUN-2026-05-31-100000/summary.md");
const FIXED_NOW = new Date("2026-05-31T10:05:00.000Z");

const run = (overrides: Partial<TestRun> = {}): TestRun => ({
  id: "RUN-2026-05-31-100000",
  scope: "use-case",
  target: "UC-001",
  status: "failed",
  startedAt: "2026-05-31T10:00:00.000Z",
  command: "npm run test",
  workingDirectory: vp(".testrunner"),
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
    { type: "report", path: vp(".testrunner/reports/cucumber-report.json"), label: "JSON" },
    { type: "screenshot", path: vp(".testrunner/reports"), label: "image/png" },
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
    path: vp(`Use Cases/${id} Checkout.md`),
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
    settings,
    fs,
    useCaseService,
    bus,
    silentLogger,
    () => FIXED_NOW,
  );
  return { service, fs, events, types };
};

describe("evidence Markdown sanitizers (data-flow review)", () => {
  it("inlineMarkdownText collapses newlines and escapes list-breaking metacharacters", () => {
    // A tampered report's scenario name must stay ONE list item and must not
    // open/close code spans, wikilinks, or embeds.
    expect(inlineMarkdownText("a\r\nb\nc")).toBe("a b c");
    expect(inlineMarkdownText("break `out` [[Link]] ![[Embed]]")).toBe(
      "break \\`out\\` \\[\\[Link\\]\\] \\!\\[\\[Embed\\]\\]",
    );
  });

  it("wikilinkAlias strips alias separators and link terminators", () => {
    expect(wikilinkAlias("image/png|evil]]injected")).toBe("image/png/evil))injected");
    expect(wikilinkAlias("two\nlines")).toBe("two lines");
  });

  it("a report-controlled scenario name cannot inject Markdown into the note", async () => {
    const { service, fs } = build();
    seedUseCase(fs);
    const result = await service.generate({
      run: run(),
      report: report({
        scenarioResults: [
          {
            feature: "Checkout",
            scenario: "Pays\n## Injected heading\n[[Evil]]",
            status: "passed",
            durationMs: 5,
          },
        ],
      }),
    });
    expect(result.ok).toBe(true);
    const note = fs.files.get(EVIDENCE_PATH) ?? "";
    // The injected line break is collapsed; the heading/wikilink stay inert text.
    expect(note).not.toContain("\n## Injected heading");
    expect(note).not.toContain("[[Evil]]");
    expect(note).toContain("Pays ## Injected heading");
  });
});

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

  it("records a cancelled run as cancelled even with a passing partial report", async () => {
    const { service, fs } = build();
    seedUseCase(fs);

    // A cancelled run whose partial report shows only a passing scenario must
    // not be recorded as PASSED.
    const result = await service.generate({
      run: run({ status: "cancelled" }),
      report: report({
        result: { passed: 1, failed: 0, skipped: 0, total: 1 },
        scenarioResults: [{ feature: "Checkout", scenario: "Pays", status: "passed" }],
      }),
    });
    expect(result.ok).toBe(true);

    const note = fs.files.get(EVIDENCE_PATH);
    const fm = parseFrontmatter(note ?? "");
    expect(fm.status).toBe("cancelled");
    expect(note).toContain("Status: **CANCELLED**");
  });

  it("records a failed run as failed even when the report shows no failures", async () => {
    const { service, fs } = build();
    seedUseCase(fs);

    // The run failed (e.g. a posttest step) after an all-passing report.
    const result = await service.generate({
      run: run({ status: "failed" }),
      report: report({
        result: { passed: 2, failed: 0, skipped: 0, total: 2 },
        scenarioResults: [{ feature: "Checkout", scenario: "Pays", status: "passed" }],
      }),
    });
    expect(result.ok).toBe(true);

    const fm = parseFrontmatter(fs.files.get(EVIDENCE_PATH) ?? "");
    expect(fm.status).toBe("failed");
  });

  it("links evidence into the owning Use Case (evidence[] + lastTestRun)", async () => {
    const { service, fs } = build();
    seedUseCase(fs);

    await service.generate({ run: run(), report: report() });

    const ucNote = fs.files.get("Use Cases/UC-001 Checkout.md");
    const fm = parseFrontmatter(ucNote ?? "");
    expect(fm.evidence).toEqual([EVIDENCE_PATH]);
    expect(ucNote).toContain(EVIDENCE_PATH);
    // lastTestRun must be persisted (US-031), not silently dropped.
    expect(fm.last_run_id).toBe(run().id);
    expect(fm.last_run_evidence).toBe(EVIDENCE_PATH);
    // last_run_date is when the run actually ran (startedAt), not the later
    // evidence-generation/re-import time (FIXED_NOW = 10:05).
    expect(fm.last_run_date).toBe(run().startedAt);
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

  it("links suite/all runs via the scenario feature uri (not the display name)", async () => {
    const { service, fs } = build();
    seedUseCase(fs);

    const result = await service.generate({
      run: run({ scope: "suite", target: "smoke" }),
      report: report({
        scenarioResults: [
          // Human name has no UC prefix; the uri carries it.
          {
            feature: "Checkout",
            featureUri: "features/UC-001-checkout.feature",
            scenario: "Pays",
            status: "passed",
          },
        ],
      }),
    });
    expect(result.ok && result.value.linkedUseCases).toEqual(["UC-001"]);
  });

  it("is idempotent: re-importing the same run overwrites its evidence note", async () => {
    const { service, fs } = build();
    seedUseCase(fs);
    expect((await service.generate({ run: run(), report: report() })).ok).toBe(true);
    // Second generation for the same runId must not fail on an existing note.
    const second = await service.generate({ run: run(), report: report() });
    expect(second.ok).toBe(true);
    expect(fs.files.get(EVIDENCE_PATH)).toBeDefined();
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

  it("records the run scope and target in evidence frontmatter", async () => {
    const { service, fs } = build();
    seedUseCase(fs);

    const result = await service.generate({
      run: run({ scope: "suite", target: "smoke" }),
      report: report(),
    });

    expect(result.ok).toBe(true);
    const frontmatter = parseFrontmatter(fs.files.get(EVIDENCE_PATH) ?? "");
    expect(frontmatter.scope).toBe("suite");
    expect(frontmatter.target).toBe("smoke");
  });

  it("returns EVIDENCE_WRITE_FAILED when the evidence folder cannot be created", async () => {
    const { service, fs, types } = build();
    seedUseCase(fs);
    fs.failOn = { path: "Test Evidence/2026/05/RUN-2026-05-31-100000", message: "locked" };

    const result = await service.generate({ run: run(), report: report() });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("EVIDENCE_WRITE_FAILED");
    // Nothing was written or advertised for the failed note.
    expect(fs.files.has(EVIDENCE_PATH)).toBe(false);
    expect(types()).not.toContain("evidence.generated");
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
