import { describe, expect, it } from "vitest";
import {
  PostRunCoordinator,
  type PostRunCoordinatorDeps,
} from "../src/application/services/post-run-coordinator";
import type { EvidenceGenerationService } from "../src/application/services/evidence-generation-service";
import type {
  ImportedReport,
  ReportImportService,
} from "../src/application/services/report-import-service";
import type {
  DashboardSnapshot,
  TraceabilityService,
} from "../src/application/services/traceability-service";
import type { Evidence } from "../src/domain/entities/evidence";
import type { TestRun, TestRunStatus } from "../src/domain/entities/test-run";
import type { DomainEventType } from "../src/domain/events/domain-event";
import { createEvent } from "../src/shared/event-bus/create-event";
import { appError } from "../src/shared/errors/errors";
import { err, ok, type Result } from "../src/shared/result/result";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";
import type { Logger } from "../src/shared/logging/logger";
import { recordingEventBus, silentLogger } from "./fakes";

const run = (overrides: Partial<TestRun> = {}): TestRun => ({
  id: "RUN-2026-05-31-100000",
  scope: "all",
  target: "all",
  status: "passed",
  startedAt: "2026-05-31T10:00:00.000Z",
  command: "npm run test",
  workingDirectory: vp(".testrunner"),
  // A finished run that produced a report has its run-specific snapshot recorded
  // (the executor sets this after snapshotReport); the coordinator only imports
  // when it is present. Tests for the "no report" path override it to {}.
  reportPaths: { json: vp(".testrunner/reports/RUN-2026-05-31-100000.json") },
  ...overrides,
});

const importedReport = (): ImportedReport => ({
  runId: "RUN-2026-05-31-100000",
  result: { passed: 1, failed: 0, skipped: 0, total: 1 },
  scenarioResults: [],
  artifacts: [],
});

const evidence = (
  path = vp("Test Evidence/2026/05/RUN-2026-05-31-100000/summary.md"),
): Evidence => ({
  id: "EV-1",
  runId: "RUN-2026-05-31-100000",
  path,
  linkedUseCases: [],
  result: { passed: 1, failed: 0, skipped: 0, total: 1 },
  createdAt: "2026-05-31T10:05:00.000Z",
  artifacts: [],
});

const snapshot = (): DashboardSnapshot => ({
  totalUseCases: 0,
  specifiedUseCases: 0,
  automatedUseCases: 0,
  passingUseCases: 0,
  failingUseCases: 0,
  recentRuns: [],
});

/** Records calls so a test can assert order + count + serialization. */
class FakeReportImportService implements ReportImportService {
  readonly calls: TestRun[] = [];
  result: Result<ImportedReport> = ok(importedReport());
  /** When set, import waits on this gate so two runs can be overlapped. */
  gate?: Promise<void>;

  async import(r: TestRun): Promise<Result<ImportedReport>> {
    this.calls.push(r);
    if (this.gate) await this.gate;
    return this.result;
  }
}

class FakeEvidenceGenerationService implements EvidenceGenerationService {
  readonly calls: { run: TestRun; report: ImportedReport }[] = [];
  result: Result<Evidence> = ok(evidence());

  async generate(request: { run: TestRun; report: ImportedReport }): Promise<Result<Evidence>> {
    this.calls.push(request);
    return this.result;
  }
}

class FakeTraceabilityService implements TraceabilityService {
  refreshes = 0;
  result: Result<DashboardSnapshot> = ok(snapshot());

  async refreshDashboard(): Promise<Result<DashboardSnapshot>> {
    this.refreshes += 1;
    return this.result;
  }

  // Non-emitting read used by view renders; the coordinator only PUSHES via
  // refreshDashboard, so this just satisfies the interface.
  async snapshot(): Promise<Result<DashboardSnapshot>> {
    return this.result;
  }

  async linksFor(): Promise<never> {
    throw new Error("not used");
  }
}

const build = (overrides: Partial<PostRunCoordinatorDeps> = {}) => {
  const { bus, events, types } = recordingEventBus();
  const reportImport = new FakeReportImportService();
  const evidenceGen = new FakeEvidenceGenerationService();
  const traceability = new FakeTraceabilityService();
  let lastRun: TestRun | null = null;
  let active: string | null = null;
  let markdownEnabled = true;

  const deps: PostRunCoordinatorDeps = {
    reportImportService: reportImport,
    evidenceGenerationService: evidenceGen,
    traceabilityService: traceability,
    eventBus: bus,
    logger: silentLogger,
    lastRun: () => lastRun,
    activeRunId: () => active,
    whenActiveSettles: () => Promise.resolve(),
    isEvidenceMarkdownEnabled: () => markdownEnabled,
    ...overrides,
  };
  const coordinator = new PostRunCoordinator(deps);
  return {
    coordinator,
    bus,
    events,
    types,
    reportImport,
    evidenceGen,
    traceability,
    setLastRun: (r: TestRun | null) => (lastRun = r),
    setActive: (id: string | null) => (active = id),
    setMarkdownEnabled: (on: boolean) => (markdownEnabled = on),
  };
};

const publishTerminal = (
  bus: ReturnType<typeof build>["bus"],
  type: Extract<DomainEventType, "testrun.completed" | "testrun.failed" | "testrun.cancelled">,
  runId = "RUN-2026-05-31-100000",
): Promise<void> => {
  if (type === "testrun.completed") {
    return bus.publish(
      createEvent(type, {
        runId,
        status: "passed",
        durationMs: 1,
        passed: 1,
        failed: 0,
        skipped: 0,
      }),
    );
  }
  if (type === "testrun.failed") {
    return bus.publish(createEvent(type, { runId, reason: "boom" }));
  }
  return bus.publish(createEvent(type, { runId }));
};

describe("PostRunCoordinator", () => {
  describe("terminal-event reaction", () => {
    it("imports and generates evidence on testrun.completed", async () => {
      const env = build();
      env.coordinator.start();
      env.setLastRun(run({ status: "passed" }));

      await publishTerminal(env.bus, "testrun.completed");
      await env.coordinator.whenSettled();

      expect(env.reportImport.calls).toHaveLength(1);
      expect(env.reportImport.calls[0].id).toBe("RUN-2026-05-31-100000");
      expect(env.evidenceGen.calls).toHaveLength(1);
    });

    it("reacts to testrun.cancelled (may carry a partial report)", async () => {
      const env = build();
      env.coordinator.start();
      env.setLastRun(run({ status: "cancelled" }));

      await publishTerminal(env.bus, "testrun.cancelled");
      await env.coordinator.whenSettled();

      expect(env.reportImport.calls).toHaveLength(1);
    });

    it("skips import for an errored run (no report produced)", async () => {
      const env = build();
      env.coordinator.start();
      env.setLastRun(run({ status: "errored" }));

      await publishTerminal(env.bus, "testrun.failed");
      await env.coordinator.whenSettled();

      expect(env.reportImport.calls).toHaveLength(0);
      expect(env.evidenceGen.calls).toHaveLength(0);
    });

    it("does nothing when there is no recorded run", async () => {
      const env = build();
      env.coordinator.start();
      env.setLastRun(null);

      await publishTerminal(env.bus, "testrun.completed");
      await env.coordinator.whenSettled();

      expect(env.reportImport.calls).toHaveLength(0);
    });

    it("does not react after stop()", async () => {
      const env = build();
      env.coordinator.start();
      env.coordinator.stop();
      env.setLastRun(run({ status: "passed" }));

      await publishTerminal(env.bus, "testrun.completed");
      await env.coordinator.whenSettled();

      expect(env.reportImport.calls).toHaveLength(0);
    });

    it("start() is idempotent — a single terminal event imports once", async () => {
      const env = build();
      env.coordinator.start();
      env.coordinator.start();
      env.setLastRun(run({ status: "passed" }));

      await publishTerminal(env.bus, "testrun.completed");
      await env.coordinator.whenSettled();

      expect(env.reportImport.calls).toHaveLength(1);
    });
  });

  describe("serialization through the evidence chain", () => {
    it("serializes two back-to-back runs (no interleave)", async () => {
      const env = build();
      env.coordinator.start();

      // Gate the FIRST import so the second terminal event lands while it is
      // in flight; assert the second import only starts after the first settles.
      let release = (): void => {};
      const gate = new Promise<void>((resolve) => (release = resolve));
      env.reportImport.gate = gate;

      // The handler enqueues without awaiting, so publish() returns promptly even
      // while an import is gated; spin microtasks to let the queued tasks advance.
      env.setLastRun(run({ id: "RUN-A", status: "passed" }));
      const firstPublish = publishTerminal(env.bus, "testrun.completed", "RUN-A");
      // Second run finishes and publishes while the first import is gated.
      env.setLastRun(run({ id: "RUN-B", status: "passed" }));
      const secondPublish = publishTerminal(env.bus, "testrun.completed", "RUN-B");
      for (let i = 0; i < 20; i++) await Promise.resolve();

      // Only the first import has begun; the second is queued behind the chain.
      expect(env.reportImport.calls.map((c) => c.id)).toEqual(["RUN-A"]);

      // Drop the gate so the second can also run, then let everything drain.
      env.reportImport.gate = undefined;
      release();
      await firstPublish;
      await secondPublish;
      await env.coordinator.whenSettled();

      expect(env.reportImport.calls.map((c) => c.id)).toEqual(["RUN-A", "RUN-B"]);
    });

    it("skips import when no run-specific snapshot exists (cancelled-in-setup, review)", async () => {
      // A run cancelled during setup never reaches snapshotReport, so
      // reportPaths.json stays unset. Importing would fall back to the FIXED
      // report (possibly a previous run's) — the coordinator must skip instead.
      const env = build();
      env.coordinator.start();
      env.setLastRun(run({ status: "cancelled", reportPaths: {} }));

      await publishTerminal(env.bus, "testrun.cancelled");
      await env.coordinator.whenSettled();

      expect(env.reportImport.calls).toHaveLength(0);
      expect(env.evidenceGen.calls).toHaveLength(0);
    });

    it("does not block the terminal publish on the import chain (review P2)", async () => {
      // execute() frees the run slot only after the terminal publish returns, so
      // the handler must NOT await the import — otherwise activeRunId() stays set
      // through evidence generation and the next run is wrongly rejected.
      const env = build();
      env.coordinator.start();
      let release = (): void => {};
      env.reportImport.gate = new Promise<void>((resolve) => (release = resolve));
      env.setLastRun(run({ status: "passed" }));

      // With the fix this resolves even though the import is still gated.
      await publishTerminal(env.bus, "testrun.completed");

      expect(env.reportImport.calls).toHaveLength(1); // import started…
      expect(env.evidenceGen.calls).toHaveLength(0); // …but the chain is still gated

      release();
      await env.coordinator.whenSettled();
      expect(env.evidenceGen.calls).toHaveLength(1);
    });

    it("waits for a cancelled run to settle (snapshot) before importing (review P1)", async () => {
      // A cancelled run publishes testrun.cancelled BEFORE execute() writes the
      // reports/<runId>.json snapshot; importing immediately would read a
      // missing/partial report. The coordinator must wait on whenActiveSettles.
      let releaseSettle = (): void => {};
      const settleGate = new Promise<void>((resolve) => (releaseSettle = resolve));
      const env = build({ whenActiveSettles: () => settleGate });
      env.coordinator.start();
      // The run is still the active one (cancel hasn't freed the slot yet).
      env.setActive("RUN-2026-05-31-100000");
      env.setLastRun(run({ status: "cancelled" }));

      await publishTerminal(env.bus, "testrun.cancelled");
      for (let i = 0; i < 20; i++) await Promise.resolve();
      expect(env.reportImport.calls).toHaveLength(0); // blocked until settled

      releaseSettle();
      await env.coordinator.whenSettled();
      expect(env.reportImport.calls).toHaveLength(1);
    });
  });

  describe("dashboard refresh push (P2-6)", () => {
    it("pushes a dashboard refresh after evidence is generated", async () => {
      const env = build();
      env.coordinator.start();
      env.setLastRun(run({ status: "passed" }));

      await publishTerminal(env.bus, "testrun.completed");
      await env.coordinator.whenSettled();

      expect(env.traceability.refreshes).toBe(1);
      // refreshDashboard() is what emits the KPI events (pushed from the run flow).
    });

    it("does not refresh the dashboard when import fails", async () => {
      const env = build();
      env.reportImport.result = err(appError("REPORT_NOT_FOUND", "no report"));
      env.coordinator.start();
      env.setLastRun(run({ status: "passed" }));

      await publishTerminal(env.bus, "testrun.completed");
      await env.coordinator.whenSettled();

      expect(env.traceability.refreshes).toBe(0);
    });

    it("still returns success when only the dashboard refresh fails", async () => {
      const env = build();
      env.traceability.result = err(appError("INIT_FAILED", "kpi failed"));
      env.setLastRun(run({ status: "passed" }));

      const outcome = await env.coordinator.importLastRun();

      expect(outcome.ok).toBe(true);
      expect(env.traceability.refreshes).toBe(1);
    });
  });

  describe("importLastRun eligibility", () => {
    const eligible: TestRunStatus[] = ["passed", "failed", "cancelled"];
    for (const status of eligible) {
      it(`imports an eligible ${status} run`, async () => {
        const env = build();
        env.setLastRun(run({ status }));

        const outcome = await env.coordinator.importLastRun();

        expect(outcome.ok).toBe(true);
        expect(env.reportImport.calls).toHaveLength(1);
        if (outcome.ok) expect(outcome.value.kind).toBe("imported");
      });
    }

    it("reports run-in-progress without importing", async () => {
      const env = build();
      env.setActive("RUN-ACTIVE");
      env.setLastRun(run({ status: "passed" }));

      const outcome = await env.coordinator.importLastRun();

      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        expect(outcome.value.kind).toBe("run-in-progress");
        if (outcome.value.kind === "run-in-progress") {
          expect(outcome.value.activeRunId).toBe("RUN-ACTIVE");
        }
      }
      expect(env.reportImport.calls).toHaveLength(0);
    });

    it("reports no-run when nothing has finished", async () => {
      const env = build();
      env.setLastRun(null);

      const outcome = await env.coordinator.importLastRun();

      expect(outcome.ok).toBe(true);
      if (outcome.ok) expect(outcome.value.kind).toBe("no-run");
      expect(env.reportImport.calls).toHaveLength(0);
    });

    it("reports ineligible for an errored run", async () => {
      const env = build();
      env.setLastRun(run({ status: "errored" }));

      const outcome = await env.coordinator.importLastRun();

      expect(outcome.ok).toBe(true);
      if (outcome.ok && outcome.value.kind === "ineligible") {
        expect(outcome.value.status).toBe("errored");
      } else {
        expect.fail("expected ineligible outcome");
      }
      expect(env.reportImport.calls).toHaveLength(0);
    });

    it("returns the import error when import fails", async () => {
      const env = build();
      env.reportImport.result = err(appError("REPORT_NOT_FOUND", "missing report"));
      env.setLastRun(run({ status: "passed" }));

      const outcome = await env.coordinator.importLastRun();

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.error.code).toBe("REPORT_NOT_FOUND");
    });

    it("reports recorded (not imported) when evidence Markdown is disabled", async () => {
      const env = build();
      env.setMarkdownEnabled(false);
      env.setLastRun(run({ status: "passed" }));

      const outcome = await env.coordinator.importLastRun();

      expect(outcome.ok).toBe(true);
      if (outcome.ok) expect(outcome.value.kind).toBe("recorded");
    });
  });

  describe("fire-and-forget rejection backstop", () => {
    it("logs a rejected task, keeps the chain intact, and still runs the next enqueue", async () => {
      // runImportAndGenerate never rejects today; simulate a future edit that
      // lets a rejection through and assert it is logged (not an unhandled
      // rejection) and that the serialized chain keeps working afterwards.
      const errors: string[] = [];
      const logger: Logger = {
        ...silentLogger,
        error: (message) => {
          errors.push(message);
        },
      };
      const env = build({ logger });
      env.coordinator.start();
      env.setLastRun(run({ status: "passed" }));

      const internals = env.coordinator as unknown as {
        runImportAndGenerate: (r: TestRun) => Promise<unknown>;
      };
      const original = internals.runImportAndGenerate.bind(env.coordinator);
      let rejectOnce = true;
      internals.runImportAndGenerate = (r) => {
        if (rejectOnce) {
          rejectOnce = false;
          return Promise.reject(new Error("future bug"));
        }
        return original(r);
      };

      await publishTerminal(env.bus, "testrun.completed");
      await env.coordinator.whenSettled();
      // The .catch backstop is chained off the task, not the chain — give its
      // microtask a turn before asserting.
      await Promise.resolve();

      expect(errors).toContain("Post-run task rejected unexpectedly");
      expect(env.reportImport.calls).toHaveLength(0); // the rejected task imported nothing

      // The chain is not broken: a subsequent terminal event still imports.
      await publishTerminal(env.bus, "testrun.completed");
      await env.coordinator.whenSettled();
      expect(env.reportImport.calls).toHaveLength(1);
      expect(env.evidenceGen.calls).toHaveLength(1);
    });
  });

  describe("lastEvidence probe (Wave G §1)", () => {
    it("is null before any evidence has been generated", () => {
      const env = build();
      expect(env.coordinator.lastEvidence()).toBeNull();
    });

    it("records the last generated evidence note (runId + path) after a run imports", async () => {
      const env = build();
      env.coordinator.start();
      env.setLastRun(run({ status: "passed" }));

      await publishTerminal(env.bus, "testrun.completed");
      await env.coordinator.whenSettled();

      expect(env.coordinator.lastEvidence()).toEqual({
        runId: "RUN-2026-05-31-100000",
        evidencePath: vp("Test Evidence/2026/05/RUN-2026-05-31-100000/summary.md"),
      });
    });

    it("records nothing when evidence Markdown is disabled (no note exists to open)", async () => {
      const env = build();
      env.setMarkdownEnabled(false);
      env.setLastRun(run({ status: "passed" }));

      const outcome = await env.coordinator.importLastRun();

      expect(outcome.ok).toBe(true);
      expect(env.coordinator.lastEvidence()).toBeNull();
    });
  });

  describe("whenSettled", () => {
    it("resolves immediately when idle", async () => {
      const env = build();
      await expect(env.coordinator.whenSettled()).resolves.toBeUndefined();
    });

    it("never rejects even when a task throws", async () => {
      const env = build();
      env.evidenceGen.generate = async () => {
        throw new Error("evidence blew up");
      };
      env.coordinator.start();
      env.setLastRun(run({ status: "passed" }));

      await publishTerminal(env.bus, "testrun.completed");

      await expect(env.coordinator.whenSettled()).resolves.toBeUndefined();
    });
  });
});
