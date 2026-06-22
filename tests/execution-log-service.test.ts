import { describe, expect, it } from "vitest";
import { DefaultExecutionLogService } from "../src/application/services/execution-log-service";
import type { SettingsService } from "../src/application/services/settings-service";
import type { ExecutionLogEntry } from "../src/domain/entities/execution-log";
import { DEFAULT_SETTINGS, HISTORY_DEPTH_DEFAULT } from "../src/domain/settings/settings";
import type { Logger } from "../src/shared/logging/logger";
import type { Result } from "../src/shared/result/result";
import { FakeAbsoluteFileSystem, silentLogger } from "./fakes";
import { executionRun as run } from "./execution-log-fixtures";

// The log lives under the unindexed `.testrunner` dot-folder, so it is written
// through the ABSOLUTE filesystem (vault base + runner path), mirroring the
// scenario-index read model — see the service doc.
const LOG_PATH = "/vault/.testrunner/history/execution-log.json";

/** A minimal SettingsService that only needs to answer `load()` (E1). */
const settings: SettingsService = {
  async load() {
    return DEFAULT_SETTINGS;
  },
} as unknown as SettingsService;

/** Builds the service, capturing whether `warn` was called via a spy logger. */
const build = (logger: Logger = silentLogger) => {
  const fs = new FakeAbsoluteFileSystem();
  const service = new DefaultExecutionLogService(settings, fs, logger);
  return { service, fs };
};

const spyLogger = (): { logger: Logger; warned: () => boolean } => {
  let warned = false;
  return {
    logger: {
      ...silentLogger,
      warn() {
        warned = true;
      },
    },
    warned: () => warned,
  };
};

const readLog = (fs: FakeAbsoluteFileSystem): ExecutionLogEntry[] =>
  JSON.parse(fs.written.get(LOG_PATH) ?? "[]") as ExecutionLogEntry[];

const runIds = (fs: FakeAbsoluteFileSystem): string[] => readLog(fs).map((e) => e.runId);

describe("DefaultExecutionLogService.record", () => {
  it("records one entry into a fresh vault (no file yet)", async () => {
    const { service, fs } = build();

    const result = await service.record(run());

    expect(result.ok).toBe(true);
    const log = readLog(fs);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      runId: "RUN-2026-06-01-100000",
      scope: "use-case",
      target: "UC-001",
      status: "passed",
      startedAt: "2026-06-01T10:00:00.000Z",
      finishedAt: "2026-06-01T10:01:00.000Z",
      durationMs: 60000,
      result: { passed: 1, failed: 0, skipped: 0, total: 1 },
    });
  });

  it("overwrites the existing unindexed log on a second record (regression: stuck-on-first)", async () => {
    // The vault adapter cannot overwrite an unindexed `.testrunner` file, so the
    // service must use the absolute FS — proven here by a SECOND record landing
    // (the first already created the file) rather than failing and freezing the
    // log on the first run (Codex P2).
    const { service, fs } = build();

    expect((await service.record(run({ id: "RUN-A" }))).ok).toBe(true);
    expect((await service.record(run({ id: "RUN-B" }))).ok).toBe(true);

    expect(runIds(fs)).toEqual(["RUN-B", "RUN-A"]);
  });

  it("records errored/cancelled runs the evidence path skips", async () => {
    const { service, fs } = build();

    await service.record(run({ id: "RUN-E", status: "errored", result: undefined }));
    await service.record(run({ id: "RUN-C", status: "cancelled", result: undefined }));

    expect(runIds(fs)).toEqual(["RUN-C", "RUN-E"]);
  });

  it("prepends newest-first and dedupes a same-runId re-record", async () => {
    const { service, fs } = build();

    await service.record(run({ id: "RUN-A", status: "passed" }));
    await service.record(run({ id: "RUN-B", status: "failed" }));
    // Re-record RUN-A (a re-import) — must replace, not duplicate, and move to head.
    await service.record(run({ id: "RUN-A", status: "failed" }));

    const log = readLog(fs);
    expect(log.map((e) => e.runId)).toEqual(["RUN-A", "RUN-B"]);
    expect(log[0].status).toBe("failed");
  });

  it("caps the log at HISTORY_DEPTH_DEFAULT beyond the depth", async () => {
    const { service, fs } = build();

    for (let i = 0; i <= HISTORY_DEPTH_DEFAULT; i++) {
      await service.record(run({ id: `RUN-${String(i).padStart(3, "0")}` }));
    }

    const log = readLog(fs);
    expect(log).toHaveLength(HISTORY_DEPTH_DEFAULT);
    // Newest at the head; the very first run (RUN-000) was pushed off the tail.
    expect(log[0].runId).toBe(`RUN-${String(HISTORY_DEPTH_DEFAULT).padStart(3, "0")}`);
    expect(log.some((e) => e.runId === "RUN-000")).toBe(false);
  });

  it("treats a corrupt existing log as empty, warns, and still writes", async () => {
    const spy = spyLogger();
    const { service, fs } = build(spy.logger);
    fs.seed(LOG_PATH, "{ this is not json");

    const result = await service.record(run({ id: "RUN-NEW" }));

    expect(result.ok).toBe(true);
    expect(spy.warned()).toBe(true);
    expect(runIds(fs)).toEqual(["RUN-NEW"]);
  });

  it("treats a non-array existing log as empty and still writes", async () => {
    const { service, fs } = build();
    fs.seed(LOG_PATH, JSON.stringify({ not: "an array" }));

    await service.record(run({ id: "RUN-NEW" }));

    expect(runIds(fs)).toEqual(["RUN-NEW"]);
  });

  it("drops malformed elements from an existing log array", async () => {
    const { service, fs } = build();
    fs.seed(LOG_PATH, JSON.stringify([{ noRunId: true }, { runId: "RUN-OLD" }]));

    await service.record(run({ id: "RUN-NEW" }));

    expect(runIds(fs)).toEqual(["RUN-NEW", "RUN-OLD"]);
  });

  it("returns err and logs (without throwing) when the write fails", async () => {
    const spy = spyLogger();
    const { service, fs } = build(spy.logger);
    fs.writeAbsolute = async () => ({
      ok: false,
      error: { code: "INIT_FAILED", message: "disk full" },
    });

    const result = await service.record(run());

    expectWriteFailure(result, spy.warned());
    // A failed write leaves no file behind.
    expect(fs.written.has(LOG_PATH)).toBe(false);
  });

  it("returns err and logs when the vault base path is unavailable", async () => {
    const spy = spyLogger();
    const { service, fs } = build(spy.logger);
    fs.basePath = null; // non-desktop: no absolute base to resolve the log path

    const result = await service.record(run());

    expectWriteFailure(result, spy.warned());
    expect(fs.written.size).toBe(0);
  });

  it("whenSettled resolves only after the enqueued write completes", async () => {
    const { service, fs } = build();

    // Enqueue without awaiting (the fire-and-forget recorder path), then drain.
    void service.record(run({ id: "RUN-PENDING" }));
    // The write has not necessarily landed yet; whenSettled awaits the queue tail
    // — the drain maintenance relies on before deleting the runner folder.
    await service.whenSettled();

    expect(runIds(fs)).toEqual(["RUN-PENDING"]);
  });
});

describe("DefaultExecutionLogService.latest", () => {
  it("returns null when no log file exists yet", async () => {
    const { service } = build();

    expect(await service.latest()).toBeNull();
  });

  it("returns the newest entry after records (the head of the newest-first log)", async () => {
    const { service } = build();

    await service.record(run({ id: "RUN-A", status: "passed" }));
    await service.record(run({ id: "RUN-B", status: "failed" }));

    const latest = await service.latest();
    expect(latest?.runId).toBe("RUN-B");
    expect(latest?.status).toBe("failed");
  });

  it("returns null when the log file is corrupt", async () => {
    const { service, fs } = build();
    fs.seed(LOG_PATH, "{ this is not json");

    expect(await service.latest()).toBeNull();
  });

  it("returns null when the persisted value is not an array", async () => {
    const { service, fs } = build();
    fs.seed(LOG_PATH, JSON.stringify({ not: "an array" }));

    expect(await service.latest()).toBeNull();
  });

  it("returns null when the vault base path is unavailable", async () => {
    const { service, fs } = build();
    fs.basePath = null; // non-desktop: no absolute base to resolve the log path

    expect(await service.latest()).toBeNull();
  });
});

/** Asserts a best-effort write fault: an `EVIDENCE_WRITE_FAILED` err, logged. */
const expectWriteFailure = (result: Result<void>, warned: boolean): void => {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe("EVIDENCE_WRITE_FAILED");
  expect(warned).toBe(true);
};
