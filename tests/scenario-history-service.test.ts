import { describe, expect, it } from "vitest";
import { DefaultScenarioHistoryService } from "../src/application/services/scenario-history-service";
import type { ImportedReport } from "../src/application/services/report-import-service";
import type { SettingsService } from "../src/application/services/settings-service";
import { renderScenarioEvidenceBlock } from "../src/application/content/scenario-evidence-block";
import { DEFAULT_SETTINGS } from "../src/domain/settings/settings";
import type { TestRun } from "../src/domain/entities/test-run";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";
import { buildNote } from "../src/shared/utils/frontmatter";
import { err } from "../src/shared/result/result";
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

  it("rebuilds from existing logs before folding when the index is missing (codex P2)", async () => {
    const { service, fs } = build();
    fs.folders.add("Test Evidence");
    // Two committed logs from prior runs, but the regenerable index was deleted
    // (e.g. Reset Test Hub recreated .testrunner).
    fs.files.set(
      vp("Test Evidence/2026/06/RUN-OLD-A/scenarios.ndjson"),
      JSON.stringify({
        v: 1,
        scenarioRef: REF_A,
        runId: "RUN-OLD-A",
        status: "passed",
        at: "2026-06-01T10:00:00.000Z",
        scope: "all",
      }) + "\n",
    );
    fs.files.set(
      vp("Test Evidence/2026/06/RUN-OLD-B/scenarios.ndjson"),
      JSON.stringify({
        v: 1,
        scenarioRef: REF_B,
        runId: "RUN-OLD-B",
        status: "passed",
        at: "2026-06-02T10:00:00.000Z",
        scope: "all",
      }) + "\n",
    );

    // A new targeted run touches only REF_A while no index exists.
    await service.record(
      run({
        id: "RUN-NEW",
        startedAt: "2026-06-03T10:00:00.000Z",
        finishedAt: "2026-06-03T10:01:00.000Z",
      }),
      report({
        runId: "RUN-NEW",
        scenarioResults: [{ feature: "F", scenario: "A", status: "failed", scenarioRef: REF_A }],
      }),
    );

    const statuses = await service.latestStatuses();
    // The new run's REF_A applies, AND REF_B (untouched) is preserved from the
    // rebuild rather than dropped to never-run.
    expect(statuses.ok && statuses.value.get(REF_A)).toBe("failed");
    expect(statuses.ok && statuses.value.get(REF_B)).toBe("passed");
  });

  it("restores depth-trimmed older results when a re-import drops a ref (codex P2)", async () => {
    const { service, fs } = build(1); // historyDepth 1 — index keeps only the latest per ref
    fs.folders.add("Test Evidence");
    // An older committed run recorded A=passed.
    fs.files.set(
      vp("Test Evidence/2026/06/RUN-R0/scenarios.ndjson"),
      JSON.stringify({
        v: 1,
        scenarioRef: REF_A,
        runId: "RUN-R0",
        status: "passed",
        at: "2026-06-01T10:00:00.000Z",
        scope: "all",
      }) + "\n",
    );
    // A newer run R1 records A=failed; at depth 1 the index keeps only A=failed.
    const r1 = {
      id: "RUN-R1",
      startedAt: "2026-06-02T10:00:00.000Z",
      finishedAt: "2026-06-02T10:01:00.000Z",
    };
    await service.record(run(r1), report({ runId: "RUN-R1", scenarioResults: [
      { feature: "F", scenario: "A", status: "failed", scenarioRef: REF_A },
    ] }));

    // Re-import R1, now resolving only B (A dropped from this run).
    await service.record(run(r1), report({ runId: "RUN-R1", scenarioResults: [
      { feature: "F", scenario: "B", status: "failed", scenarioRef: REF_B },
    ] }));

    const statuses = await service.latestStatuses();
    // A is restored from R0's committed log (depth-1 trimmed it from the index,
    // but the re-import rebuild recovers it) rather than reported never-run.
    expect(statuses.ok && statuses.value.get(REF_A)).toBe("passed");
    expect(statuses.ok && statuses.value.get(REF_B)).toBe("failed");
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

  it("tombstones the note's scenario block on a zero-ref retract so rebuild can't resurrect it (codex P2)", async () => {
    const { service, fs } = build();
    const folder = "Test Evidence/2026/06/RUN-2026-06-01-100000";
    // First import records A (writes the ndjson log).
    await service.record(
      run(),
      report({
        scenarioResults: [{ feature: "F", scenario: "A", status: "passed", scenarioRef: REF_A }],
      }),
    );
    // A colocated note carrying the scenario block (as evidence generation wrote
    // it), which — with Markdown now off — won't be regenerated on re-import.
    fs.files.set(
      vp(`${folder}/summary.md`),
      buildNote(
        {
          type: "test-evidence",
          run_id: "RUN-2026-06-01-100000",
          run_at: "2026-06-01T10:01:00.000Z",
          scope: "use-case",
        },
        renderScenarioEvidenceBlock([{ ref: REF_A, status: "passed" }]),
      ),
    );

    // Re-import the SAME run, now resolving zero refs.
    await service.record(
      run(),
      report({ scenarioResults: [{ feature: "F", scenario: "A", status: "passed" }] }),
    );

    // The note's block is stripped, so the rebuild's note fallback can't re-add A.
    const note = fs.files.get(vp(`${folder}/summary.md`)) ?? "";
    expect(note).not.toContain("testrunner-scenarios");
    const statuses = await service.latestStatuses();
    expect(statuses.ok && statuses.value.has(REF_A)).toBe(false);
  });

  it("rebuilds correctly when the Evidence root is saved with a trailing slash (codex P2)", async () => {
    const settings = {
      async load() {
        return {
          ...DEFAULT_SETTINGS,
          paths: { ...DEFAULT_SETTINGS.paths, evidencePath: vp("Test Evidence/") },
        };
      },
    } as unknown as SettingsService;
    const fs = new FakeVaultFileSystem();
    const absoluteFs = new FakeAbsoluteFileSystem();
    const { bus } = recordingEventBus();
    const service = new DefaultScenarioHistoryService(settings, fs, absoluteFs, bus, silentLogger);

    await service.record(run(), report());

    // The normalized root makes the rebuild's path slice exact, so REF_A is
    // folded rather than dropped (which would leave the index empty).
    const statuses = await service.latestStatuses();
    expect(statuses.ok && statuses.value.get(REF_A)).toBe("passed");
  });

  it("canonicalizes a non-canonical Evidence root (a '.' segment) for paths and rebuild (codex P2)", async () => {
    const settings = {
      async load() {
        return {
          ...DEFAULT_SETTINGS,
          paths: { ...DEFAULT_SETTINGS.paths, evidencePath: vp("Test Evidence/.") },
        };
      },
    } as unknown as SettingsService;
    const fs = new FakeVaultFileSystem();
    const absoluteFs = new FakeAbsoluteFileSystem();
    const { bus } = recordingEventBus();
    const service = new DefaultScenarioHistoryService(settings, fs, absoluteFs, bus, silentLogger);

    await service.record(run(), report());

    // The log is written at the CANONICAL path (no '/./' segment), matching what
    // the adapter would list, so the rebuild slice stays exact.
    expect(
      fs.files.has(vp("Test Evidence/2026/06/RUN-2026-06-01-100000/scenarios.ndjson")),
    ).toBe(true);
    const statuses = await service.latestStatuses();
    expect(statuses.ok && statuses.value.get(REF_A)).toBe("passed");
  });

  it("rebuilds history when the Evidence root is the vault root ('.') (codex P2)", async () => {
    const settings = {
      async load() {
        return {
          ...DEFAULT_SETTINGS,
          paths: { ...DEFAULT_SETTINGS.paths, evidencePath: vp(".") },
        };
      },
    } as unknown as SettingsService;
    const fs = new FakeVaultFileSystem();
    const absoluteFs = new FakeAbsoluteFileSystem();
    const { bus } = recordingEventBus();
    const service = new DefaultScenarioHistoryService(settings, fs, absoluteFs, bus, silentLogger);

    await service.record(run(), report());

    // The vault-root tree writes logs without a leading folder; rebuild lists
    // from the root ("") and slices with an empty prefix, so REF_A is folded.
    expect(fs.files.has(vp("2026/06/RUN-2026-06-01-100000/scenarios.ndjson"))).toBe(true);
    const statuses = await service.latestStatuses();
    expect(statuses.ok && statuses.value.get(REF_A)).toBe("passed");
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

  it("treats a fractional configured depth as the default, never 0 (codex P2)", async () => {
    const { service, absoluteFs } = build(0.5); // would floor to 0 without the guard
    await service.record(run(), report());
    const index = readIndex(absoluteFs);
    // Falls back to the default window and keeps a valid latest, rather than
    // writing a record with no latest (which would make the cache unservable).
    expect(index.depth).toBe(50);
    expect(index.scenarios[REF_A].latest.status).toBe("passed");
  });

  it("rebuilds (re-trims untouched refs) when the history depth changes (codex P2)", async () => {
    // A mutable depth so we can change it between records, as the user would.
    let depth: number | undefined = 3;
    const settings = {
      async load() {
        return {
          ...DEFAULT_SETTINGS,
          automation: { ...DEFAULT_SETTINGS.automation, historyDepth: depth },
        };
      },
    } as unknown as SettingsService;
    const fs = new FakeVaultFileSystem();
    const absoluteFs = new FakeAbsoluteFileSystem();
    const { bus } = recordingEventBus();
    const service = new DefaultScenarioHistoryService(settings, fs, absoluteFs, bus, silentLogger);

    // Three runs for REF_A at depth 3 → recent keeps all three.
    for (const day of ["01", "02", "03"]) {
      await service.record(
        run({
          id: `RUN-2026-06-${day}-100000`,
          startedAt: `2026-06-${day}T10:00:00.000Z`,
          finishedAt: `2026-06-${day}T10:01:00.000Z`,
        }),
        report({
          runId: `RUN-2026-06-${day}-100000`,
          scenarioResults: [{ feature: "F", scenario: "A", status: "passed", scenarioRef: REF_A }],
        }),
      );
    }
    expect(readIndex(absoluteFs).scenarios[REF_A].recent).toHaveLength(3);

    // Lower the depth, then record a run for a DIFFERENT ref so the incremental
    // fold never touches REF_A. The depth change must still re-trim REF_A.
    depth = 1;
    await service.record(
      run({
        id: "RUN-2026-06-04-100000",
        startedAt: "2026-06-04T10:00:00.000Z",
        finishedAt: "2026-06-04T10:01:00.000Z",
      }),
      report({
        runId: "RUN-2026-06-04-100000",
        scenarioResults: [{ feature: "F", scenario: "B", status: "passed", scenarioRef: REF_B }],
      }),
    );

    const index = readIndex(absoluteFs);
    expect(index.depth).toBe(1);
    expect(index.scenarios[REF_A].recent).toHaveLength(1);
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

  it("orders note-fallback entries by run_at, not the note's created_at (codex P2)", async () => {
    const { service, fs } = build();
    fs.folders.add("Test Evidence");
    // An older run (run_at earlier) that was RE-imported later (created_at newer).
    fs.files.set(
      vp("Test Evidence/2026/06/RUN-OLD/summary.md"),
      buildNote(
        {
          type: "test-evidence",
          run_id: "RUN-OLD",
          created_at: "2026-06-09T10:00:00.000Z",
          run_at: "2026-06-01T10:00:00.000Z",
          scope: "all",
        },
        renderScenarioEvidenceBlock([{ ref: REF_A, status: "passed" }]),
      ),
    );
    // A newer run (run_at later) imported earlier (created_at older).
    fs.files.set(
      vp("Test Evidence/2026/06/RUN-NEW/summary.md"),
      buildNote(
        {
          type: "test-evidence",
          run_id: "RUN-NEW",
          created_at: "2026-06-02T10:00:00.000Z",
          run_at: "2026-06-05T10:00:00.000Z",
          scope: "all",
        },
        renderScenarioEvidenceBlock([{ ref: REF_A, status: "failed" }]),
      ),
    );

    await service.rebuildIndex();
    const statuses = await service.latestStatuses();
    // Ordered by run_at, RUN-NEW (06-05) is latest → failed; created_at ordering
    // would have wrongly picked RUN-OLD's later import time → passed.
    expect(statuses.ok && statuses.value.get(REF_A)).toBe("failed");
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

  it("falls back to the note when the log is partially corrupt/truncated (codex P2)", async () => {
    const { service, fs } = build();
    fs.folders.add("Test Evidence");
    const folder = "Test Evidence/2026/06/RUN-2026-06-08-100000";
    // A truncated log: a valid first line, then a line cut off mid-write. The
    // log yields a non-empty SUBSET, so a zero-entry guard alone wouldn't catch
    // it — but the malformed tail must still route to the note.
    fs.files.set(
      vp(`${folder}/scenarios.ndjson`),
      JSON.stringify({
        v: 1,
        scenarioRef: REF_A,
        runId: "R8",
        status: "passed",
        at: "2026-06-08T10:01:00.000Z",
        scope: "all",
      }) +
        "\n" +
        '{"v":1,"scenarioRef":"' /* truncated mid-line */,
    );
    // The note holds the full run (both A and B).
    fs.files.set(
      vp(`${folder}/summary.md`),
      buildNote(
        { type: "test-evidence", run_id: "R8", created_at: "2026-06-08T10:01:00.000Z", scope: "all" },
        renderScenarioEvidenceBlock([
          { ref: REF_A, status: "passed" },
          { ref: REF_B, status: "failed" },
        ]),
      ),
    );

    await service.rebuildIndex();
    const statuses = await service.latestStatuses();
    // Both scenarios are recovered from the note, not just the one intact log line.
    expect(statuses.ok && statuses.value.get(REF_A)).toBe("passed");
    expect(statuses.ok && statuses.value.get(REF_B)).toBe("failed");
  });

  it("falls back to the note when a log line has an invalid status (codex P2)", async () => {
    const { service, fs } = build();
    fs.folders.add("Test Evidence");
    const folder = "Test Evidence/2026/06/RUN-2026-06-08-100000";
    // Valid JSON but a status outside the union (sync corruption / hand edit).
    fs.files.set(
      vp(`${folder}/scenarios.ndjson`),
      JSON.stringify({
        v: 1,
        scenarioRef: REF_B,
        runId: "R8",
        status: "failed ",
        at: "2026-06-08T10:01:00.000Z",
        scope: "all",
      }) + "\n",
    );
    fs.files.set(
      vp(`${folder}/summary.md`),
      buildNote(
        { type: "test-evidence", run_id: "R8", created_at: "2026-06-08T10:01:00.000Z", scope: "all" },
        renderScenarioEvidenceBlock([{ ref: REF_B, status: "passed" }]),
      ),
    );

    await service.rebuildIndex();
    const statuses = await service.latestStatuses();
    // The non-union status is rejected and the authoritative note salvages the run.
    expect(statuses.ok && statuses.value.get(REF_B)).toBe("passed");
  });

  it("rebuilds when the cached index has a corrupt status value (codex P2)", async () => {
    const { service, fs, absoluteFs } = build();
    fs.folders.add("Test Evidence");
    // The authoritative log says REF_A failed.
    fs.files.set(
      vp("Test Evidence/2026/06/RUN-2026-06-09-100000/scenarios.ndjson"),
      JSON.stringify({
        v: 1,
        scenarioRef: REF_A,
        runId: "R9",
        status: "failed",
        at: "2026-06-09T10:01:00.000Z",
        scope: "all",
      }) + "\n",
    );
    // A corrupt cache with matching root/depth but a status outside the union.
    absoluteFs.seed(
      INDEX_PATH,
      JSON.stringify({
        v: 1,
        depth: 50,
        root: "Test Evidence",
        scenarios: {
          [REF_A]: {
            latest: { status: "failed ", runId: "R9", at: "2026-06-09T10:01:00.000Z", scope: "all" },
            recent: [
              { status: "failed ", runId: "R9", at: "2026-06-09T10:01:00.000Z", scope: "all" },
            ],
          },
        },
      }),
    );

    const statuses = await service.latestStatuses();
    // The corrupt cache is rejected and rebuilt from the log → valid "failed".
    expect(statuses.ok && statuses.value.get(REF_A)).toBe("failed");
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

  it("rebuilds when the persisted index is parseable but malformed (codex P2)", async () => {
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
        scope: "all",
      }) + "\n",
    );
    // A hand-edited / partially-written cache: valid JSON, wrong shape (a record
    // missing latest/recent). It must be treated as absent and rebuilt, not
    // dereferenced.
    absoluteFs.seed(INDEX_PATH, JSON.stringify({ v: 1, depth: 50, scenarios: { [REF_A]: {} } }));

    const statuses = await service.latestStatuses();
    expect(statuses.ok).toBe(true);
    expect(statuses.ok && statuses.value.get(REF_A)).toBe("passed");
  });

  it("rebuilds when the index was built from a different Evidence root (codex P2)", async () => {
    const { service, fs, absoluteFs } = build();
    fs.folders.add("Test Evidence");
    fs.files.set(
      vp("Test Evidence/2026/06/RUN-X/scenarios.ndjson"),
      JSON.stringify({
        v: 1,
        scenarioRef: REF_A,
        runId: "RUN-X",
        status: "failed",
        at: "2026-06-02T10:00:00.000Z",
        scope: "all",
      }) + "\n",
    );
    // A cache built from a previous Evidence root the user has since repointed.
    absoluteFs.seed(
      INDEX_PATH,
      JSON.stringify({
        v: 1,
        depth: 50,
        root: "Old Evidence",
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

    const statuses = await service.latestStatuses();
    // The stale cache is rebuilt from the current root's logs, not served.
    expect(statuses.ok && statuses.value.get(REF_A)).toBe("failed");
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

  it("clears a stale index when the Evidence root is absent (codex P2)", async () => {
    const { service, absoluteFs } = build(); // Evidence root NOT seeded → absent
    // A populated index lingers from an Evidence root that has since been
    // deleted or repointed.
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

    await service.rebuildIndex();
    const statuses = await service.latestStatuses();
    // The stale cache is cleared rather than served as phantom history.
    expect(statuses.ok && statuses.value.size).toBe(0);
  });

  it("serves freshly rebuilt history (not the stale cache) even when the index write fails (codex P2)", async () => {
    const { service, fs, absoluteFs } = build();
    fs.folders.add("Test Evidence");
    // A committed log says REF_A passed under the CURRENT Evidence root.
    fs.files.set(
      vp("Test Evidence/2026/06/RUN-X/scenarios.ndjson"),
      JSON.stringify({
        v: 1,
        scenarioRef: REF_A,
        runId: "RX",
        status: "passed",
        at: "2026-06-01T10:00:00.000Z",
        scope: "all",
      }) + "\n",
    );
    // A stale cache from a DIFFERENT (old) Evidence root listing REF_B.
    absoluteFs.seed(
      INDEX_PATH,
      JSON.stringify({
        v: 1,
        depth: 50,
        root: "Old Evidence",
        scenarios: {
          [REF_B]: {
            latest: { status: "passed", runId: "OLD", at: "2026-05-01T00:00:00.000Z", scope: "all" },
            recent: [
              { status: "passed", runId: "OLD", at: "2026-05-01T00:00:00.000Z", scope: "all" },
            ],
          },
        },
      }),
    );
    // Every index write fails (read-only .testrunner / disk full), so the stale
    // cache can never be overwritten on disk.
    absoluteFs.writeAbsolute = async () => err({ code: "INIT_FAILED", message: "disk full" });

    const statuses = await service.latestStatuses();
    // The in-memory rebuild from the committed logs is served: REF_A appears and
    // the stale REF_B does not, despite the failed disk write.
    expect(statuses.ok && statuses.value.get(REF_A)).toBe("passed");
    expect(statuses.ok && statuses.value.has(REF_B)).toBe(false);
  });

  it("rebuilds and serves fresh data after an index write fails with matching root/depth (codex P2)", async () => {
    const { service, fs, absoluteFs } = build();
    fs.folders.add("Test Evidence");
    // Record one run successfully so a valid index exists on disk.
    await service.record(
      run(),
      report({
        scenarioResults: [{ feature: "F", scenario: "A", status: "passed", scenarioRef: REF_A }],
      }),
    );
    // Now writes start failing, and a SECOND run is recorded: its log is
    // committed but the index write fails, leaving a stale on-disk cache whose
    // root/depth still match.
    absoluteFs.writeAbsolute = async () => err({ code: "INIT_FAILED", message: "disk full" });
    await service.record(
      run({ id: "RUN-2026-06-02-100000", startedAt: "2026-06-02T10:00:00.000Z", finishedAt: "2026-06-02T10:01:00.000Z" }),
      report({
        runId: "RUN-2026-06-02-100000",
        scenarioResults: [{ feature: "F", scenario: "A", status: "failed", scenarioRef: REF_A }],
      }),
    );

    // The fast path is bypassed (indexWriteFailed) and the in-memory rebuild from
    // the committed logs surfaces the newer "failed", not the stale "passed".
    const statuses = await service.latestStatuses();
    expect(statuses.ok && statuses.value.get(REF_A)).toBe("failed");
  });
});
