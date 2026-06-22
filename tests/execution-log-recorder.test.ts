import { describe, expect, it, vi } from "vitest";
import { ExecutionLogRecorder } from "../src/application/services/execution-log-recorder";
import type { ExecutionLogService } from "../src/application/services/execution-log-service";
import type { ExecutionLogRecorderDeps } from "../src/application/services/execution-log-recorder";
import type { TestRun } from "../src/domain/entities/test-run";
import { ok, type Result } from "../src/shared/result/result";
import { recordingEventBus, silentLogger } from "./fakes";
import { executionRun as run, publishTerminalEvent } from "./execution-log-fixtures";

const build = (overrides: Partial<ExecutionLogRecorderDeps> = {}) => {
  const { bus } = recordingEventBus();
  let lastRun: TestRun | null = null;
  const recordSpy = vi.fn((_run: TestRun): Promise<Result<void>> => Promise.resolve(ok(undefined)));
  const executionLogService = { record: recordSpy } as unknown as ExecutionLogService;
  const deps: ExecutionLogRecorderDeps = {
    eventBus: bus,
    executionLogService,
    lastRun: () => lastRun,
    logger: silentLogger,
    ...overrides,
  };
  const recorder = new ExecutionLogRecorder(deps);
  return {
    recorder,
    bus,
    recordSpy,
    setLastRun: (r: TestRun | null) => (lastRun = r),
  };
};

describe("ExecutionLogRecorder", () => {
  it("records the last run on testrun.completed", async () => {
    const env = build();
    env.recorder.start();
    env.setLastRun(run({ status: "passed" }));

    await publishTerminalEvent(env.bus, "testrun.completed");

    expect(env.recordSpy).toHaveBeenCalledTimes(1);
    expect(env.recordSpy.mock.calls[0][0]).toMatchObject({ id: "RUN-2026-06-01-100000" });
  });

  it("records an errored run published as testrun.failed (evidence path skips it)", async () => {
    const env = build();
    env.recorder.start();
    env.setLastRun(run({ status: "errored" }));

    await publishTerminalEvent(env.bus, "testrun.failed");

    expect(env.recordSpy).toHaveBeenCalledTimes(1);
  });

  it("records a cancelled run on testrun.cancelled", async () => {
    const env = build();
    env.recorder.start();
    env.setLastRun(run({ status: "cancelled" }));

    await publishTerminalEvent(env.bus, "testrun.cancelled");

    expect(env.recordSpy).toHaveBeenCalledTimes(1);
  });

  it("warns and does not record when there is no last run", async () => {
    let warned = false;
    const env = build({ logger: { ...silentLogger, warn: () => (warned = true) } });
    env.recorder.start();
    env.setLastRun(null);

    await publishTerminalEvent(env.bus, "testrun.completed");

    expect(env.recordSpy).not.toHaveBeenCalled();
    expect(warned).toBe(true);
  });

  it("start() is idempotent — a single terminal event records once", async () => {
    const env = build();
    env.setLastRun(run({ status: "passed" }));
    env.recorder.start();
    env.recorder.start();

    await publishTerminalEvent(env.bus, "testrun.completed");

    expect(env.recordSpy).toHaveBeenCalledTimes(1);
  });

  it("does not record after stop()", async () => {
    const env = build();
    env.setLastRun(run({ status: "passed" }));
    env.recorder.start();
    env.recorder.stop();

    await publishTerminalEvent(env.bus, "testrun.completed");

    expect(env.recordSpy).not.toHaveBeenCalled();
  });

  it("stop() before start() is safe", () => {
    const env = build();
    expect(() => env.recorder.stop()).not.toThrow();
  });
});
