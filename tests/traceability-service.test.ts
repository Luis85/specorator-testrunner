import { describe, expect, it } from "vitest";
import type { UseCaseService } from "../src/application/services/use-case-service";
import {
  DefaultTraceabilityService,
  projectDashboardSnapshot,
} from "../src/application/services/traceability-service";
import type { TestRunSummary } from "../src/domain/entities/test-run";
import type { UseCase } from "../src/domain/entities/use-case";
import { ok, err, type Result } from "../src/shared/result/result";
import { appError } from "../src/shared/errors/errors";
import { recordingEventBus, silentLogger } from "./fakes";

const useCase = (over: Partial<UseCase> = {}): UseCase => ({
  id: "UC-001",
  title: "Demo",
  status: "specified",
  automationStatus: "not-planned",
  featureFiles: [],
  suites: [],
  evidence: [],
  path: "Use Cases/UC-001 Demo.md",
  ...over,
});

const run = (runId: string, date: string): TestRunSummary => ({
  runId,
  status: "passed",
  date,
});

/** Minimal stub UseCaseService backed by an in-memory list. */
const stubUseCaseService = (useCases: UseCase[]): UseCaseService => ({
  async create() {
    throw new Error("not used");
  },
  async findAll(): Promise<Result<UseCase[]>> {
    return ok(useCases);
  },
  async findById(id): Promise<Result<UseCase | null>> {
    return ok(useCases.find((uc) => uc.id === id) ?? null);
  },
  async update() {
    return ok(undefined);
  },
});

describe("projectDashboardSnapshot (ADR-0017 KPI definitions)", () => {
  it("counts each KPI and excludes deprecated UCs", () => {
    const snapshot = projectDashboardSnapshot([
      useCase({ id: "UC-001", status: "specified", automationStatus: "passing" }),
      useCase({ id: "UC-002", status: "automated", automationStatus: "failing" }),
      useCase({ id: "UC-003", status: "draft", automationStatus: "implemented" }),
      useCase({ id: "UC-004", status: "deprecated", automationStatus: "passing" }),
    ]);

    // UC-004 (deprecated) is excluded from every count.
    expect(snapshot.totalUseCases).toBe(3);
    // specified ∈ {specified, ready-for-automation, automated, verified}: UC-001, UC-002.
    expect(snapshot.specifiedUseCases).toBe(2);
    // automated ∈ {implemented, passing, failing}: UC-001, UC-002, UC-003.
    expect(snapshot.automatedUseCases).toBe(3);
    expect(snapshot.passingUseCases).toBe(1);
    expect(snapshot.failingUseCases).toBe(1);
  });

  it("orders recentRuns newest-first and skips UCs without a run", () => {
    const snapshot = projectDashboardSnapshot([
      useCase({ id: "UC-001", lastTestRun: run("RUN-A", "2026-06-01T09:00:00Z") }),
      useCase({ id: "UC-002", lastTestRun: run("RUN-B", "2026-06-03T09:00:00Z") }),
      useCase({ id: "UC-003" }),
      useCase({ id: "UC-004", lastTestRun: run("RUN-C", "2026-06-02T09:00:00Z") }),
    ]);

    expect(snapshot.recentRuns.map((r) => r.runId)).toEqual(["RUN-B", "RUN-C", "RUN-A"]);
  });

  it("excludes a deprecated UC's run from recentRuns", () => {
    const snapshot = projectDashboardSnapshot([
      useCase({ id: "UC-001", status: "deprecated", lastTestRun: run("RUN-OLD", "2026-06-09T09:00:00Z") }),
      useCase({ id: "UC-002", lastTestRun: run("RUN-NEW", "2026-06-01T09:00:00Z") }),
    ]);
    expect(snapshot.recentRuns.map((r) => r.runId)).toEqual(["RUN-NEW"]);
  });
});

describe("DefaultTraceabilityService.refreshDashboard", () => {
  it("returns the snapshot and emits dashboard.refreshed then dashboard.kpi.updated", async () => {
    const { bus, events, types } = recordingEventBus();
    const service = new DefaultTraceabilityService(
      stubUseCaseService([
        useCase({ id: "UC-001", automationStatus: "passing", lastTestRun: run("RUN-A", "2026-06-01T09:00:00Z"), suites: ["smoke"] }),
        useCase({ id: "UC-002", automationStatus: "failing", suites: ["smoke", "regression"] }),
      ]),
      bus,
      silentLogger,
    );

    const result = await service.refreshDashboard();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.totalUseCases).toBe(2);
    expect(result.value.passingUseCases).toBe(1);
    expect(result.value.failingUseCases).toBe(1);

    // UC-018 ordering: refreshed (signal) before kpi.updated (counts).
    expect(types()).toEqual(["dashboard.refreshed", "dashboard.kpi.updated"]);

    const refreshed = events[0].payload as {
      useCaseCount: number;
      suiteCount: number;
      latestRunId?: string;
    };
    expect(refreshed.useCaseCount).toBe(2);
    expect(refreshed.suiteCount).toBe(2); // distinct: smoke + regression
    expect(refreshed.latestRunId).toBe("RUN-A");

    const kpi = events[1].payload as { totalUseCases: number; passingUseCases: number };
    expect(kpi.totalUseCases).toBe(2);
    expect(kpi.passingUseCases).toBe(1);
  });

  it("propagates a findAll failure without emitting events", async () => {
    const { bus, types } = recordingEventBus();
    const failing: UseCaseService = {
      ...stubUseCaseService([]),
      async findAll() {
        return err(appError("VALIDATION_FAILED", "boom"));
      },
    };
    const service = new DefaultTraceabilityService(failing, bus, silentLogger);

    const result = await service.refreshDashboard();
    expect(result.ok).toBe(false);
    expect(types()).toEqual([]);
  });
});

describe("DefaultTraceabilityService.linksFor", () => {
  it("resolves a UC's traceability links from its frontmatter", async () => {
    const { bus } = recordingEventBus();
    const service = new DefaultTraceabilityService(
      stubUseCaseService([
        useCase({
          id: "UC-001",
          featureFiles: ["Specifications/features/UC-001.feature", "Specifications/features/UC-001b.feature"],
          suites: ["smoke"],
          evidence: ["Test Evidence/runs/EV-1.md"],
          lastTestRun: run("RUN-A", "2026-06-01T09:00:00Z"),
        }),
      ]),
      bus,
      silentLogger,
    );

    const result = await service.linksFor("UC-001");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      useCaseId: "UC-001",
      featurePath: "Specifications/features/UC-001.feature",
      suites: ["smoke"],
      runs: ["RUN-A"],
      evidence: ["Test Evidence/runs/EV-1.md"],
    });
  });

  it("returns VALIDATION_FAILED for an unknown UC id", async () => {
    const { bus } = recordingEventBus();
    const service = new DefaultTraceabilityService(stubUseCaseService([]), bus, silentLogger);
    const result = await service.linksFor("UC-999");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_FAILED");
  });
});
