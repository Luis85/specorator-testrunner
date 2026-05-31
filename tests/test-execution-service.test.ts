import { describe, expect, it } from "vitest";
import { DefaultSettingsService } from "../src/application/services/settings-service";
import { DefaultSuiteService } from "../src/application/services/suite-service";
import {
  DefaultTestExecutionService,
  type TestExecutionService,
} from "../src/application/services/test-execution-service";
import { buildSuiteNote } from "../src/application/content/default-suites";
import { DefaultCommandSafetyPolicy } from "../src/domain/policies/command-safety-policy";
import { DefaultPathSafetyPolicy } from "../src/domain/policies/path-safety-policy";
import type { DomainEventType } from "../src/domain/events/domain-event";
import {
  FakeAbsoluteFileSystem,
  FakeChildProcessRunner,
  FakeDataStore,
  FakeVaultFileSystem,
  recordingEventBus,
  silentLogger,
} from "./fakes";

/** Spins the microtask queue until the single run registers as active. */
const waitForActive = async (service: TestExecutionService): Promise<void> => {
  for (let i = 0; i < 100 && service.activeRunId() === null; i++) {
    await Promise.resolve();
  }
};

const FIXED_NOW = new Date("2026-06-01T10:00:00.000Z");

const build = () => {
  const fs = new FakeVaultFileSystem();
  const { bus, events, types } = recordingEventBus();
  const settings = new DefaultSettingsService(
    new FakeDataStore(),
    new DefaultPathSafetyPolicy(),
    bus,
  );
  const suiteService = new DefaultSuiteService(settings, fs, bus);
  const childProcess = new FakeChildProcessRunner();
  const absoluteFs = new FakeAbsoluteFileSystem();
  const service = new DefaultTestExecutionService(
    settings,
    suiteService,
    childProcess,
    absoluteFs,
    new DefaultCommandSafetyPolicy(),
    bus,
    silentLogger,
    () => FIXED_NOW,
  );
  return { service, fs, childProcess, events, types };
};

/** Seeds a suite so the `suite` scope can resolve a tag expression. */
const seedSuite = (fs: FakeVaultFileSystem, id: string, tagExpression: string): void => {
  fs.files.set(
    `Test Suites/${id}.md`,
    buildSuiteNote({ id, name: id, description: "", tagExpression }),
  );
};

describe("DefaultTestExecutionService", () => {
  it("resolves the demo command and derives passed from exit 0", async () => {
    const { service, childProcess, types } = build();

    const result = await service.execute({ scope: "demo", target: "demo" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.command).toBe("npm run test:smoke");
    expect(result.value.status).toBe("passed");
    expect(result.value.id).toBe("RUN-2026-06-01-100000");
    expect(childProcess.calls[0].command).toBe("npm run test:smoke");
    expect(types()).toEqual([
      "testrun.requested",
      "testrun.started",
      "testrun.completed",
    ]);
  });

  it("resolves the all command", async () => {
    const { service } = build();
    const result = await service.execute({ scope: "all", target: "all" });
    expect(result.ok && result.value.command).toBe("npm run test");
  });

  it("resolves the suite command from the suite's tag expression and emits suite.executed", async () => {
    const { service, fs, types } = build();
    seedSuite(fs, "smoke", "@smoke and not @wip");

    const result = await service.execute({ scope: "suite", target: "smoke" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.command).toBe('npm run test -- --tags "@smoke and not @wip"');
    // suite.executed precedes the terminal event (UC-013).
    expect(types()).toEqual([
      "testrun.requested",
      "testrun.started",
      "suite.executed",
      "testrun.completed",
    ]);
  });

  it("resolves the feature command relative to the runner cwd", async () => {
    const { service } = build();
    const result = await service.execute({
      scope: "feature",
      target: "Specifications/features/checkout.feature",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.command).toBe(
      "npm run test -- ../Specifications/features/checkout.feature",
    );
  });

  it("resolves the use-case command as a feature glob", async () => {
    const { service } = build();
    const result = await service.execute({ scope: "use-case", target: "UC-001" });
    expect(result.ok && result.value.command).toBe(
      "npm run test -- ../Specifications/features/UC-001-*.feature",
    );
  });

  it("derives failed from a non-zero exit code", async () => {
    const { service, childProcess, events } = build();
    childProcess.exitCodes.set("test:smoke", 1);

    const result = await service.execute({ scope: "demo", target: "demo" });

    expect(result.ok && result.value.status).toBe("failed");
    const completed = events.find((e) => e.type === "testrun.completed");
    expect((completed?.payload as { status: string }).status).toBe("failed");
  });

  it("marks a spawn failure as errored and emits testrun.failed", async () => {
    const { service, childProcess, types, events } = build();
    childProcess.spawnFailures.add("test:smoke");

    const result = await service.execute({ scope: "demo", target: "demo" });

    expect(result.ok && result.value.status).toBe("errored");
    expect(types()).toEqual(["testrun.requested", "testrun.started", "testrun.failed"]);
    const failed = events.find((e) => e.type === "testrun.failed");
    expect((failed?.payload as { reason: string }).reason).toContain("spawn failed");
  });

  it("streams each output line as testrun.output.received", async () => {
    const { service, childProcess, events } = build();
    childProcess.streamLines.push(
      { stream: "stdout", line: "Running", timestamp: "t" },
      { stream: "stderr", line: "warn", timestamp: "t" },
    );

    await service.execute({ scope: "demo", target: "demo" });

    const output = events.filter((e) => e.type === "testrun.output.received");
    expect(output).toHaveLength(2);
    expect((output[0].payload as { line: string }).line).toBe("Running");
    expect((output[1].payload as { stream: string }).stream).toBe("stderr");
  });

  it("publishes exactly one terminal event (EN-2)", async () => {
    const { service, events } = build();
    await service.execute({ scope: "demo", target: "demo" });
    const terminals: DomainEventType[] = [
      "testrun.completed",
      "testrun.failed",
      "testrun.cancelled",
    ];
    expect(events.filter((e) => terminals.includes(e.type))).toHaveLength(1);
  });

  it("correlates every run event by runId (Event Catalog §correlation)", async () => {
    const { service, events } = build();
    const result = await service.execute({ scope: "demo", target: "demo" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const event of events) {
      expect(event.correlationId).toBe(result.value.id);
    }
  });

  it("rejects an overlapping run with RUN_IN_PROGRESS (ADR-0018)", async () => {
    const { service, childProcess } = build();
    childProcess.pending = true;

    const first = service.execute({ scope: "demo", target: "demo" });
    // Let the first run register itself as active before the second starts.
    await waitForActive(service);
    const second = await service.execute({ scope: "all", target: "all" });

    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.code).toBe("RUN_IN_PROGRESS");
      expect(second.error.details?.activeRunId).toBe("RUN-2026-06-01-100000");
    }
    childProcess.release();
    await first;
  });

  it("cancel terminates the active run with testrun.cancelled", async () => {
    const { service, childProcess, types } = build();
    childProcess.pending = true;

    const running = service.execute({ scope: "demo", target: "demo" });
    await waitForActive(service);

    const cancelled = await service.cancel("RUN-2026-06-01-100000");
    expect(cancelled.ok).toBe(true);
    expect(childProcess.cancelled).toContain("RUN-2026-06-01-100000");
    await running;

    // Cancel wins the EN-2 race: terminal event is cancelled, not completed.
    const terminals = types().filter((t) =>
      ["testrun.completed", "testrun.failed", "testrun.cancelled"].includes(t),
    );
    expect(terminals).toEqual(["testrun.cancelled"]);
    expect(service.activeRunId()).toBeNull();
  });

  it("cancel for an unknown run id is rejected", async () => {
    const { service } = build();
    const result = await service.cancel("RUN-nope");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("RUN_CANCELLED");
  });

  it("clears the active slot after a run completes, allowing a second run", async () => {
    const { service } = build();
    await service.execute({ scope: "demo", target: "demo" });
    expect(service.activeRunId()).toBeNull();
    const second = await service.execute({ scope: "all", target: "all" });
    expect(second.ok).toBe(true);
  });

  it("propagates a suite-resolution error", async () => {
    const { service } = build();
    const result = await service.execute({ scope: "suite", target: "missing" });
    expect(result.ok).toBe(false);
  });
});
