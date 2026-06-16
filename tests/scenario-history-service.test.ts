import { describe, expect, it } from "vitest";
import { DefaultScenarioHistoryService } from "../src/application/services/scenario-history-service";
import type { ImportedReport } from "../src/application/services/report-import-service";
import type { SettingsService } from "../src/application/services/settings-service";
import { renderScenarioEvidenceBlock } from "../src/application/content/scenario-evidence-block";
import { DEFAULT_SETTINGS } from "../src/domain/settings/settings";
import type { TestRun } from "../src/domain/entities/test-run";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";
import { buildNote } from "../src/shared/utils/frontmatter";
import {
  FakeAbsoluteFileSystem,
  FakeVaultFileSystem,
  recordingEventBus,
  silentLogger,
} from "./fakes";

const INDEX_PATH = "/vault/.testrunner/history/scenario-index.json";
const REF_A = "Specifications/features/UC-001.feature::A";
const REF_B = "Specifications/features/UC-001.feature::B";

/** A minimal SettingsService that only needs to answer `load()` (US-057). */
const settingsWith = (historyDepth?: number): SettingsService =>
  ({
    async load() {
      return {
        ...DEFAULT_SETTINGS,
        automation: { ...DEFAULT_SETTINGS.automation, historyDepth },
      };
    },
  }) as unknown as SettingsService;

const run = (overrides: Partial<TestRun> = {}): TestRun => ({
  id: "RUN-2026-06-01-100000",
  scope: "use-case",
  target: "UC-001",
  status: "passed",
  startedAt: "2026-06-01T10:00:00.000Z",
  finishedAt: "2026-06-01T10:01:00.000Z",
  command: "npm run test",
  workingDirectory: vp(".testrunner"),
  reportPaths: {},
  ...overrides,
});

const report = (overrides: Partial<ImportedReport> = {}): ImportedReport => ({
  runId: "RUN-2026-06-01-100000",
  result: { passed: 1, failed: 0, skipped: 0, total: 1 },
  scenarioResults: [
    { feature: "F", scenario: "A", status: "passed", durationMs: 5, scenarioRef: REF_A },
  ],
  artifacts: [],
  ...overrides,
});

const build = (historyDepth?: number) => {
  const fs = new FakeVaultFileSystem();
  const absoluteFs = new FakeAbsoluteFileSystem();
  const { bus, events, types } = recordingEventBus();
  const service = new DefaultScenarioHistoryService(
    settingsWith(historyDepth),
    fs,
    absoluteFs,
    bus,
    silentLogger,
  );
  return { service, fs, absoluteFs, events, types };
};

const readIndex = (absoluteFs: FakeAbsoluteFileSystem) =>
  JSON.parse(absoluteFs.written.get(INDEX_PATH) ?? "{}") as {
    depth: number;
    scenarios: Record<string, { latest: { status: string; runId: string }; recent: unknown[] }>;
  };

describe("DefaultScenarioHistoryService.record", () => {
  it("writes a per-run NDJSON log partitioned per ADR-0016", async () => {
    const { service, fs } = build();
    await service.record(run(), report());

    const logPath = "Test Evidence/2026/06/RUN-2026-06-01-100000/scenarios.ndjson";
    const log = fs.files.get(logPath) ?? "";
    expect(log).not.toBe("");
    const lines = log.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({
      v: 1,
      scenarioRef: REF_A,
      runId: "RUN-2026-06-01-100000",
      status: "passed",
      at: "2026-06-01T10:01:00.000Z",
      durationMs: 5,
      scope: "use-case",
    });
  });

  it("drops refs a same-run re-import no longer resolves (codex P2)", async () => {
    const { service } = build();
    // First import resolves A and B.
    await service.record(
      run(),
      report({
        scenarioResults: [
          { feature: "F", scenario: "A", status: "passed", scenarioRef: REF_A },
          { feature: "F", scenario: "B", status: "passed", scenarioRef: REF_B },
        ],
      }),
    );
    // Re-import of the SAME run now resolves only A (B was renamed/removed).
    await service.record(
      run(),
      report({
        scenarioResults: [{ feature: "F", scenario: "A", status: "failed", scenarioRef: REF_A }],
      }),
    );

    const statuses = await service.latestStatuses();
    expect(statuses.ok && statuses.value.get(REF_A)).toBe("failed");
    // B carried only this run's result, so the re-import must drop it — not leave
    // its stale "passed" lingering in the index.
    expect(statuses.ok && statuses.value.has(REF_B)).toBe(false);
  });

  it("skips results with no Scenario Reference (degrade gracefully, ADR-0022)", async () => {
    const { service, fs, absoluteFs } = build();
    await service.record(
      run(),
      report({
        scenarioResults: [
          { feature: "F", scenario: "A", status: "passed", scenarioRef: REF_A },
          { feature: "F", scenario: "unref", status: "failed" }, // no scenarioRef
        ],
      }),
    );
    const log = fs.files.get("Test Evidence/2026/06/RUN-2026-06-01-100000/scenarios.ndjson") ?? "";
    expect(log.trim().split("\n")).toHaveLength(1);
    expect(Object.keys(readIndex(absoluteFs).scenarios)).toEqual([REF_A]);
  });

  it("retracts a run's history when a re-import resolves zero refs (codex P2)", async () => {
    const { service, fs } = build();
    // First import records A.
    await service.record(
      run(),
      report({
        scenarioResults: [{ feature: "F", scenario: "A", status: "passed", scenarioRef: REF_A }],
      }),
    );
    const logPath = vp("Test Evidence/2026/06/RUN-2026-06-01-100000/scenarios.ndjson");
    expect(fs.files.has(logPath)).toBe(true);

    // Re-import the SAME run, now resolving zero refs (all became unresolvable).
    await service.record(
      run(),
      report({ scenarioResults: [{ feature: "F", scenario: "A", status: "passed" }] }),
    );

    // The stale per-run log is deleted so a rebuild can't resurrect it, and the
    // index no longer reports A.
    expect(fs.files.has(logPath)).toBe(false);
    const statuses = await service.latestStatuses();
    expect(statuses.ok && statuses.value.has(REF_A)).toBe(false);
  });

  it("does not write a log or event when no result has a reference", async () => {
    const { service, fs, types } = build();
    await service.record(
      run(),
      report({ scenarioResults: [{ feature: "F", scenario: "x", status: "passed" }] }),
    );
    expect([...fs.files.keys()]).toHaveLength(0);
    expect(types()).not.toContain("scenario.history.recorded");
  });

  it("updates the index so latestStatuses returns each scenario's latest", async () => {
    const { service } = build();
    await service.record(
      run(),
      report({
        scenarioResults: [
          { feature: "F", scenario: "A", status: "passed", scenarioRef: REF_A },
          { feature: "F", scenario: "B", status: "failed", scenarioRef: REF_B },
        ],
      }),
    );
    const statuses = await service.latestStatuses();
    expect(statuses.ok).toBe(true);
    if (!statuses.ok) return;
    expect(statuses.value.get(REF_A)).toBe("passed");
    expect(statuses.value.get(REF_B)).toBe("failed");
  });

  it("publishes scenario.history.recorded with the resolved count", async () => {
    const { service, events, types } = build();
    await service.record(run(), report());
    expect(types()).toContain("scenario.history.recorded");
    const event = events.find((e) => e.type === "scenario.history.recorded");
    expect(event?.payload).toMatchObject({ runId: "RUN-2026-06-01-100000", scenarioCount: 1 });
  });

  it("is idempotent for a re-import of the same run (no duplicate recent entries)", async () => {
    const { service, absoluteFs } = build();
    await service.record(run(), report());
    await service.record(run(), report()); // same runId — manual re-import
    const index = readIndex(absoluteFs);
    expect(index.scenarios[REF_A].recent).toHaveLength(1);
    expect(index.scenarios[REF_A].latest.runId).toBe("RUN-2026-06-01-100000");
  });

  it("keeps the latest as the newest-by-timestamp result across runs", async () => {
    const { service } = build();
    await service.record(
      run({ id: "RUN-2026-06-01-100000", finishedAt: "2026-06-01T10:01:00.000Z" }),
      report({ runId: "RUN-2026-06-01-100000" }),
    );
    await service.record(
      run({ id: "RUN-2026-06-02-100000", finishedAt: "2026-06-02T10:01:00.000Z" }),
      report({
        runId: "RUN-2026-06-02-100000",
        scenarioResults: [{ feature: "F", scenario: "A", status: "failed", scenarioRef: REF_A }],
      }),
    );
    const statuses = await service.latestStatuses();
    expect(statuses.ok && statuses.value.get(REF_A)).toBe("failed");
  });

  it("trims a scenario's recent history to the configured depth", async () => {
    const { service, absoluteFs } = build(2);
    for (const day of ["01", "02", "03"]) {
      await service.record(
        run({ id: `RUN-2026-06-${day}-100000`, finishedAt: `2026-06-${day}T10:01:00.000Z` }),
        report({
          runId: `RUN-2026-06-${day}-100000`,
          scenarioResults: [{ feature: "F", scenario: "A", status: "passed", scenarioRef: REF_A }],
        }),
      );
    }
    const index = readIndex(absoluteFs);
    expect(index.depth).toBe(2);
    expect(index.scenarios[REF_A].recent).toHaveLength(2);
    expect(index.scenarios[REF_A].latest.runId).toBe("RUN-2026-06-03-100000");
  });
});

describe("DefaultScenarioHistoryService.rebuildIndex", () => {
  it("rebuilds the index from committed per-run logs (newest wins)", async () => {
    const { service, fs, absoluteFs } = build();
    fs.folders.add("Test Evidence");
    fs.files.set(
      vp("Test Evidence/2026/06/RUN-2026-06-01-100000/scenarios.ndjson"),
      JSON.stringify({
        v: 1,
        scenarioRef: REF_A,
        runId: "R1",
        status: "passed",
        at: "2026-06-01T10:01:00.000Z",
        scope: "use-case",
      }) + "\n",
    );
    fs.files.set(
      vp("Test Evidence/2026/06/RUN-2026-06-02-100000/scenarios.ndjson"),
      JSON.stringify({
        v: 1,
        scenarioRef: REF_A,
        runId: "R2",
        status: "failed",
        at: "2026-06-02T10:01:00.000Z",
        scope: "use-case",
      }) + "\n",
    );

    const rebuilt = await service.rebuildIndex();
    expect(rebuilt.ok).toBe(true);
    const statuses = await service.latestStatuses();
    expect(statuses.ok && statuses.value.get(REF_A)).toBe("failed");
    expect(readIndex(absoluteFs).scenarios[REF_A].recent).toHaveLength(2);
  });

  it("falls back to the note's testrunner-scenarios block when a log is absent (D2)", async () => {
    const { service, fs } = build();
    fs.folders.add("Test Evidence");
    const note = buildNote(
      { type: "test-evidence", run_id: "R9", created_at: "2026-06-05T10:01:00.000Z", scope: "all" },
      `## Scenarios\n\n${renderScenarioEvidenceBlock([{ ref: REF_B, status: "passed" }])}\n`,
    );
    fs.files.set(vp("Test Evidence/2026/06/RUN-2026-06-05-100000/summary.md"), note);

    await service.rebuildIndex();
    const statuses = await service.latestStatuses();
    expect(statuses.ok && statuses.value.get(REF_B)).toBe("passed");
  });

  it("falls back to the note when the log exists but yields no usable entries (codex P2)", async () => {
    const { service, fs } = build();
    fs.folders.add("Test Evidence");
    const folder = "Test Evidence/2026/06/RUN-2026-06-07-100000";
    // A truncated/corrupt log: present but every line is unparseable, so
    // entriesFromLog() yields nothing.
    fs.files.set(vp(`${folder}/scenarios.ndjson`), "{ this is not json\n\n");
    // The colocated note still holds the authoritative block.
    fs.files.set(
      vp(`${folder}/summary.md`),
      buildNote(
        { type: "test-evidence", run_id: "R7", created_at: "2026-06-07T10:01:00.000Z", scope: "all" },
        renderScenarioEvidenceBlock([{ ref: REF_B, status: "passed" }]),
      ),
    );

    await service.rebuildIndex();
    const statuses = await service.latestStatuses();
    // The note salvaged the run rather than the corrupt log dropping it.
    expect(statuses.ok && statuses.value.get(REF_B)).toBe("passed");
  });

  it("prefers the NDJSON log over the note when both exist", async () => {
    const { service, fs } = build();
    fs.folders.add("Test Evidence");
    const folder = "Test Evidence/2026/06/RUN-2026-06-06-100000";
    fs.files.set(
      vp(`${folder}/scenarios.ndjson`),
      JSON.stringify({
        v: 1,
        scenarioRef: REF_A,
        runId: "R6",
        status: "failed",
        at: "2026-06-06T10:01:00.000Z",
        scope: "all",
      }) + "\n",
    );
    fs.files.set(
      vp(`${folder}/summary.md`),
      buildNote(
        {
          type: "test-evidence",
          run_id: "R6",
          created_at: "2026-06-06T10:01:00.000Z",
          scope: "all",
        },
        renderScenarioEvidenceBlock([{ ref: REF_A, status: "passed" }]),
      ),
    );
    await service.rebuildIndex();
    const statuses = await service.latestStatuses();
    expect(statuses.ok && statuses.value.get(REF_A)).toBe("failed");
  });
});

describe("DefaultScenarioHistoryService.latestStatuses", () => {
  it("rebuilds the index on demand when it is missing", async () => {
    const { service, fs } = build();
    fs.folders.add("Test Evidence");
    fs.files.set(
      vp("Test Evidence/2026/06/RUN-2026-06-01-100000/scenarios.ndjson"),
      JSON.stringify({
        v: 1,
        scenarioRef: REF_A,
        runId: "R1",
        status: "passed",
        at: "2026-06-01T10:01:00.000Z",
        scope: "all",
      }) + "\n",
    );
    // No index has been written yet; latestStatuses must reconstruct it.
    const statuses = await service.latestStatuses();
    expect(statuses.ok && statuses.value.get(REF_A)).toBe("passed");
  });

  it("returns an empty map when there is no history at all", async () => {
    const { service } = build();
    const statuses = await service.latestStatuses();
    expect(statuses.ok && statuses.value.size).toBe(0);
  });

  it("queues behind an in-flight rebuild instead of returning the stale index (codex P2)", async () => {
    const { service, fs, absoluteFs } = build();
    // A stale index from before a git pull: REF_A last passed.
    absoluteFs.seed(
      INDEX_PATH,
      JSON.stringify({
        v: 1,
        depth: 50,
        scenarios: {
          [REF_A]: {
            latest: { status: "passed", runId: "OLD", at: "2026-05-01T00:00:00.000Z", scope: "all" },
            recent: [
              { status: "passed", runId: "OLD", at: "2026-05-01T00:00:00.000Z", scope: "all" },
            ],
          },
        },
      }),
    );
    // The freshly pulled log says REF_A now fails.
    fs.folders.add("Test Evidence");
    fs.files.set(
      vp("Test Evidence/2026/06/RUN-2026-06-10-100000/scenarios.ndjson"),
      JSON.stringify({
        v: 1,
        scenarioRef: REF_A,
        runId: "NEW",
        status: "failed",
        at: "2026-06-10T10:01:00.000Z",
        scope: "all",
      }) + "\n",
    );

    // Mirror main.ts: kick the load rebuild, then read without awaiting it.
    const rebuilding = service.rebuildIndex();
    const reading = service.latestStatuses();
    const [, statuses] = await Promise.all([rebuilding, reading]);

    // Serialized behind the rebuild, the read sees the rebuilt (failed) status,
    // never the stale pre-pull "passed".
    expect(statuses.ok && statuses.value.get(REF_A)).toBe("failed");
  });

  it("does not materialize the .testrunner index on a fresh/uninitialized vault (codex P2)", async () => {
    const { service, absoluteFs } = build(); // no Evidence root seeded
    await service.rebuildIndex();
    await service.latestStatuses();
    // No index file written — the absolute FS would otherwise create
    // .testrunner/history before the user initializes the Test Hub.
    expect(absoluteFs.written.has(INDEX_PATH)).toBe(false);
  });
});
