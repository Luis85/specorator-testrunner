import { describe, expect, it } from "vitest";
import type { UseCaseService } from "../src/application/services/use-case-service";
import type { ScenarioHistoryService } from "../src/application/services/scenario-history-service";
import {
  DefaultTraceabilityService,
  projectDashboardSnapshot,
} from "../src/application/services/traceability-service";
import type { TestRunSummary } from "../src/domain/entities/test-run";
import type { UseCase } from "../src/domain/entities/use-case";
import type { ScenarioLatestStatus } from "../src/domain/policies/use-case-automation-policy";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";
import { ok, err, type Result } from "../src/shared/result/result";
import { appError } from "../src/shared/errors/errors";
import { FakeVaultFileSystem, recordingEventBus, silentLogger } from "./fakes";

/** A valid one-scenario Gherkin feature (non-@wip, has steps). */
const FEATURE_CONTENT = "Feature: F\n  Scenario: S\n    Given a step\n    Then a result\n";

/**
 * Status now derives from per-scenario history (US-057), not `lastTestRun`. A
 * stub history that maps each scenario's reference (`<featurePath>::<name>`) to a
 * latest status; an unmapped reference reads as never-run.
 */
const stubScenarioHistory = (
  entries: Record<string, ScenarioLatestStatus> = {},
): ScenarioHistoryService => ({
  async record() {
    return ok(undefined);
  },
  async rebuildIndex() {
    return ok(undefined);
  },
  async latestStatuses() {
    return ok(new Map(Object.entries(entries)));
  },
});

/** Scenario Reference of the single `S` scenario in {@link FEATURE_CONTENT}. */
const refS = (featurePath: string): string => `${featurePath}::S`;

/** A FakeVaultFileSystem seeding valid feature content for every UC feature file. */
const fsWithFeatures = (useCases: UseCase[]): FakeVaultFileSystem => {
  const fs = new FakeVaultFileSystem();
  for (const uc of useCases)
    for (const path of uc.featureFiles) fs.files.set(path, FEATURE_CONTENT);
  return fs;
};

const useCase = (over: Partial<UseCase> = {}): UseCase => ({
  id: "UC-001",
  title: "Demo",
  status: "specified",
  automationStatus: "not-planned",
  featureFiles: [],
  suites: [],
  evidence: [],
  path: vp("Use Cases/UC-001 Demo.md"),
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
  async updateMetadata() {
    throw new Error("not used");
  },
  async listDomains(): Promise<Result<{ domain: string; count: number }[]>> {
    return ok([]);
  },
  async countUseCasesByPrd(): Promise<Result<Map<string, number>>> {
    return ok(new Map());
  },
  async assignToPrd() {
    throw new Error("not used");
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

  it("de-duplicates recentRuns by runId (a broad run links many UCs)", () => {
    // A single all/suite/demo run writes the same runId onto every resolved UC.
    const snapshot = projectDashboardSnapshot([
      useCase({ id: "UC-001", lastTestRun: run("RUN-ALL", "2026-06-03T09:00:00Z") }),
      useCase({ id: "UC-002", lastTestRun: run("RUN-ALL", "2026-06-03T09:00:00Z") }),
      useCase({ id: "UC-003", lastTestRun: run("RUN-OLD", "2026-06-01T09:00:00Z") }),
    ]);

    expect(snapshot.recentRuns.map((r) => r.runId)).toEqual(["RUN-ALL", "RUN-OLD"]);
  });

  it("collapses a broad run to its WORST status (a failure isn't hidden by a passing UC)", () => {
    // Same runId, per-UC status: one UC failed, one passed. The recent-run row
    // must show failed, not passed-because-it-sorted-first.
    const snapshot = projectDashboardSnapshot([
      useCase({
        id: "UC-001",
        lastTestRun: { runId: "RUN-ALL", status: "passed", date: "2026-06-03T09:00:00Z" },
      }),
      useCase({
        id: "UC-002",
        lastTestRun: { runId: "RUN-ALL", status: "failed", date: "2026-06-03T09:00:00Z" },
      }),
    ]);

    expect(snapshot.recentRuns).toHaveLength(1);
    expect(snapshot.recentRuns[0].status).toBe("failed");
  });

  it("excludes a deprecated UC's run from recentRuns", () => {
    const snapshot = projectDashboardSnapshot([
      useCase({
        id: "UC-001",
        status: "deprecated",
        lastTestRun: run("RUN-OLD", "2026-06-09T09:00:00Z"),
      }),
      useCase({ id: "UC-002", lastTestRun: run("RUN-NEW", "2026-06-01T09:00:00Z") }),
    ]);
    expect(snapshot.recentRuns.map((r) => r.runId)).toEqual(["RUN-NEW"]);
  });
});

describe("DefaultTraceabilityService.refreshDashboard", () => {
  it("returns the snapshot and emits dashboard.refreshed then dashboard.kpi.updated", async () => {
    const { bus, events, types } = recordingEventBus();
    // Status is DERIVED via the policy from each UC's features + last run, so
    // give each a feature file and a last run with the relevant outcome.
    const ucs = [
      useCase({
        id: "UC-001",
        featureFiles: [vp("Specifications/features/UC-001-a.feature")],
        lastTestRun: { runId: "RUN-A", status: "passed", date: "2026-06-01T09:00:00Z" },
        suites: ["smoke"],
      }),
      useCase({
        id: "UC-002",
        featureFiles: [vp("Specifications/features/UC-002-a.feature")],
        lastTestRun: { runId: "RUN-B", status: "failed", date: "2026-05-30T09:00:00Z" },
        suites: ["smoke", "regression"],
      }),
    ];
    const service = new DefaultTraceabilityService(
      stubUseCaseService(ucs),
      fsWithFeatures(ucs),
      bus,
      silentLogger,
      stubScenarioHistory({
        [refS("Specifications/features/UC-001-a.feature")]: "passed",
        [refS("Specifications/features/UC-002-a.feature")]: "failed",
      }),
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
    const service = new DefaultTraceabilityService(
      failing,
      new FakeVaultFileSystem(),
      bus,
      silentLogger,
      stubScenarioHistory(),
    );

    const result = await service.refreshDashboard();
    expect(result.ok).toBe(false);
    expect(types()).toEqual([]);
  });
});

describe("DefaultTraceabilityService.snapshot", () => {
  it("returns the same KPI counts as refreshDashboard but emits NO events (no loop, P2-6)", async () => {
    const { bus, types } = recordingEventBus();
    const ucs = [
      useCase({
        id: "UC-001",
        featureFiles: [vp("Specifications/features/UC-001-a.feature")],
        lastTestRun: { runId: "RUN-A", status: "passed", date: "2026-06-01T09:00:00Z" },
        suites: ["smoke"],
      }),
      useCase({
        id: "UC-002",
        featureFiles: [vp("Specifications/features/UC-002-a.feature")],
        lastTestRun: { runId: "RUN-B", status: "failed", date: "2026-05-30T09:00:00Z" },
        suites: ["smoke", "regression"],
      }),
    ];
    const service = new DefaultTraceabilityService(
      stubUseCaseService(ucs),
      fsWithFeatures(ucs),
      bus,
      silentLogger,
      stubScenarioHistory({
        [refS("Specifications/features/UC-001-a.feature")]: "passed",
        [refS("Specifications/features/UC-002-a.feature")]: "failed",
      }),
    );

    const result = await service.snapshot();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.totalUseCases).toBe(2);
    expect(result.value.passingUseCases).toBe(1);
    expect(result.value.failingUseCases).toBe(1);
    // The whole point: a render reads this WITHOUT re-publishing dashboard.*.
    expect(types()).toEqual([]);
  });
});

describe("DefaultTraceabilityService history-derived status (US-057)", () => {
  it("derives 'planned' for a UC with a persisted run but no scenario history", async () => {
    const { bus } = recordingEventBus();
    // A persisted lastTestRun + "passing" is NOT honored: status derives purely
    // from per-scenario history, and there is no pre-history migration grace
    // (the plugin keeps no pre-US-057 runs to preserve). No history → planned.
    const ucs = [
      useCase({
        id: "UC-001",
        featureFiles: [vp("Specifications/features/UC-001-a.feature")],
        automationStatus: "passing",
        lastTestRun: { runId: "RUN-OLD", status: "passed", date: "2026-06-01T09:00:00Z" },
      }),
    ];
    const service = new DefaultTraceabilityService(
      stubUseCaseService(ucs),
      fsWithFeatures(ucs),
      bus,
      silentLogger,
      stubScenarioHistory(),
    );

    const result = await service.snapshot();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.passingUseCases).toBe(0);
    expect(result.value.automatedUseCases).toBe(0);
  });

  it("derives 'planned' for a never-run UC, ignoring a stale persisted status", async () => {
    const { bus } = recordingEventBus();
    const ucs = [
      useCase({
        id: "UC-001",
        featureFiles: [vp("Specifications/features/UC-001-a.feature")],
        automationStatus: "passing",
      }),
    ];
    const service = new DefaultTraceabilityService(
      stubUseCaseService(ucs),
      fsWithFeatures(ucs),
      bus,
      silentLogger,
      stubScenarioHistory(),
    );

    const result = await service.snapshot();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.passingUseCases).toBe(0);
    expect(result.value.automatedUseCases).toBe(0);
  });

  it("derives 'planned' when a rename detached the history from the current refs", async () => {
    const { bus } = recordingEventBus();
    // Every scenario was renamed: history lingers under the OLD ref, but the
    // current scenario "S" has none. A rename detaches history (ADR-0022/US-056),
    // so the UC reads as never-run rather than keeping its persisted "passing".
    const featurePath = "Specifications/features/UC-001-a.feature";
    const ucs = [
      useCase({
        id: "UC-001",
        featureFiles: [vp(featurePath)],
        automationStatus: "passing",
        lastTestRun: { runId: "RUN-OLD", status: "passed", date: "2026-06-01T09:00:00Z" },
      }),
    ];
    const service = new DefaultTraceabilityService(
      stubUseCaseService(ucs),
      fsWithFeatures(ucs),
      bus,
      silentLogger,
      stubScenarioHistory({ [`${featurePath}::OldName`]: "passed" }),
    );

    const result = await service.snapshot();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.passingUseCases).toBe(0);
    expect(result.value.automatedUseCases).toBe(0);
  });

  it("derives each UC independently from its own scenario history", async () => {
    const { bus } = recordingEventBus();
    // UC-002 has history (passing); UC-001 has none. Each UC's status reflects
    // ONLY its own scenarios' history — no cross-UC or persisted influence.
    const otherPath = "Specifications/features/UC-002-a.feature";
    const ucs = [
      useCase({
        id: "UC-001",
        featureFiles: [vp("Specifications/features/UC-001-a.feature")],
        automationStatus: "passing",
        lastTestRun: { runId: "RUN-OLD", status: "passed", date: "2026-06-01T09:00:00Z" },
      }),
      useCase({
        id: "UC-002",
        featureFiles: [vp(otherPath)],
        lastTestRun: { runId: "RUN-NEW", status: "passed", date: "2026-06-10T09:00:00Z" },
      }),
    ];
    const service = new DefaultTraceabilityService(
      stubUseCaseService(ucs),
      fsWithFeatures(ucs),
      bus,
      silentLogger,
      stubScenarioHistory({ [refS(otherPath)]: "passed" }),
    );

    const result = await service.snapshot();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // UC-002 → passing (its scenario passed); UC-001 → planned (no history).
    expect(result.value.passingUseCases).toBe(1);
  });

  it("switches to history once a scenario has a result, ignoring the persisted status", async () => {
    const { bus } = recordingEventBus();
    const ucs = [
      useCase({
        id: "UC-001",
        featureFiles: [vp("Specifications/features/UC-001-a.feature")],
        automationStatus: "passing",
        lastTestRun: { runId: "RUN-OLD", status: "passed", date: "2026-06-01T09:00:00Z" },
      }),
    ];
    const service = new DefaultTraceabilityService(
      stubUseCaseService(ucs),
      fsWithFeatures(ucs),
      bus,
      silentLogger,
      // History now exists and the latest result is a failure — overrides the
      // persisted "passing".
      stubScenarioHistory({ [refS("Specifications/features/UC-001-a.feature")]: "failed" }),
    );

    const result = await service.snapshot();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.passingUseCases).toBe(0);
    expect(result.value.failingUseCases).toBe(1);
  });
});

describe("DefaultTraceabilityService.linksFor", () => {
  it("resolves a UC's traceability links from its frontmatter", async () => {
    const { bus } = recordingEventBus();
    const service = new DefaultTraceabilityService(
      stubUseCaseService([
        useCase({
          id: "UC-001",
          featureFiles: [
            vp("Specifications/features/UC-001.feature"),
            vp("Specifications/features/UC-001b.feature"),
          ],
          suites: ["smoke"],
          evidence: [vp("Test Evidence/runs/EV-1.md")],
          lastTestRun: run("RUN-A", "2026-06-01T09:00:00Z"),
        }),
      ]),
      new FakeVaultFileSystem(),
      bus,
      silentLogger,
      stubScenarioHistory(),
    );

    const result = await service.linksFor("UC-001");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      useCaseId: "UC-001",
      featurePath: "Specifications/features/UC-001.feature",
      suites: ["smoke"],
      runs: ["RUN-A"],
      evidence: [vp("Test Evidence/runs/EV-1.md")],
    });
  });

  it("returns VALIDATION_FAILED for an unknown UC id", async () => {
    const { bus } = recordingEventBus();
    const service = new DefaultTraceabilityService(
      stubUseCaseService([]),
      new FakeVaultFileSystem(),
      bus,
      silentLogger,
      stubScenarioHistory(),
    );
    const result = await service.linksFor("UC-999");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_FAILED");
  });
});
