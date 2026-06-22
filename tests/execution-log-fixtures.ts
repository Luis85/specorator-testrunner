import type { TestRun } from "../src/domain/entities/test-run";
import type { DomainEventType } from "../src/domain/events/domain-event";
import type { EventBus } from "../src/shared/event-bus/event-bus";
import { createEvent } from "../src/shared/event-bus/create-event";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";

/** A finished {@link TestRun} for the E1 execution-log tests; override per case. */
export const executionRun = (overrides: Partial<TestRun> = {}): TestRun => ({
  id: "RUN-2026-06-01-100000",
  scope: "use-case",
  target: "UC-001",
  status: "passed",
  startedAt: "2026-06-01T10:00:00.000Z",
  finishedAt: "2026-06-01T10:01:00.000Z",
  durationMs: 60000,
  command: "npm run test",
  workingDirectory: vp(".testrunner"),
  result: { passed: 1, failed: 0, skipped: 0, total: 1 },
  reportPaths: {},
  ...overrides,
});

/** Publishes one of the three terminal run events with a catalog-valid payload. */
export const publishTerminalEvent = (
  bus: EventBus,
  type: Extract<DomainEventType, "testrun.completed" | "testrun.failed" | "testrun.cancelled">,
  runId = "RUN-2026-06-01-100000",
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
