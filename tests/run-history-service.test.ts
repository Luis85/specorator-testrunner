import { describe, expect, it } from "vitest";
import {
  DefaultRunHistoryService,
  type RunHistoryEntry,
} from "../src/application/services/run-history-service";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";
import { buildNote } from "../src/shared/utils/frontmatter";
import { err } from "../src/shared/result/result";
import { FakeVaultFileSystem, serviceHarness, silentLogger } from "./fakes";

const ROOT = "Test Evidence";

const evidenceNote = (overrides: Record<string, string | number> = {}): string =>
  buildNote(
    {
      type: "test-evidence",
      id: "EV-X",
      run_id: "RUN-X",
      status: "passed",
      created_at: "2026-05-31T10:05:00.000Z",
      passed: 2,
      failed: 1,
      skipped: 0,
      total: 3,
      scope: "suite",
      target: "smoke",
      ...overrides,
    },
    "# Evidence\n",
  );

const seed = (fs: FakeVaultFileSystem, partition: string, content = evidenceNote()): void => {
  fs.folders.add(vp(ROOT));
  fs.files.set(vp(`${ROOT}/${partition}/summary.md`), content);
};

const build = () => {
  const { fs, settings } = serviceHarness();
  const service = new DefaultRunHistoryService(settings, fs, silentLogger);
  return { service, fs };
};

describe("DefaultRunHistoryService", () => {
  it("lists runs newest-first across year/month partitions without reading order from frontmatter", async () => {
    const { service, fs } = build();
    seed(fs, "2025/12/RUN-2025-12-01-090000");
    seed(fs, "2026/05/RUN-2026-05-31-100000");
    seed(fs, "2026/05/RUN-2026-05-30-080000");
    seed(fs, "2026/01/RUN-2026-01-15-120000");

    const result = await service.list({ offset: 0, limit: 50 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.entries.map((e: RunHistoryEntry) => e.runId)).toEqual([
      "RUN-2026-05-31-100000",
      "RUN-2026-05-30-080000",
      "RUN-2026-01-15-120000",
      "RUN-2025-12-01-090000",
    ]);
    expect(result.value.hasMore).toBe(false);
  });

  it("maps frontmatter onto the entry, including the partition-derived year/month", async () => {
    const { service, fs } = build();
    seed(fs, "2026/05/RUN-2026-05-31-100000");

    const result = await service.list({ offset: 0, limit: 50 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.entries[0]).toEqual({
      runId: "RUN-2026-05-31-100000",
      evidencePath: "Test Evidence/2026/05/RUN-2026-05-31-100000/summary.md",
      year: "2026",
      month: "05",
      status: "passed",
      passed: 2,
      failed: 1,
      skipped: 0,
      total: 3,
      createdAt: "2026-05-31T10:05:00.000Z",
      scope: "suite",
      target: "smoke",
    });
  });

  it("pages with offset/limit and reports hasMore", async () => {
    const { service, fs } = build();
    seed(fs, "2026/05/RUN-2026-05-29-080000");
    seed(fs, "2026/05/RUN-2026-05-30-080000");
    seed(fs, "2026/05/RUN-2026-05-31-080000");

    const first = await service.list({ offset: 0, limit: 2 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.entries.map((e) => e.runId)).toEqual([
      "RUN-2026-05-31-080000",
      "RUN-2026-05-30-080000",
    ]);
    expect(first.value.hasMore).toBe(true);

    const second = await service.list({ offset: 2, limit: 2 });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.entries.map((e) => e.runId)).toEqual(["RUN-2026-05-29-080000"]);
    expect(second.value.hasMore).toBe(false);
  });

  it("ignores files in the evidence tree that are not partition summaries", async () => {
    const { service, fs } = build();
    seed(fs, "2026/05/RUN-2026-05-31-100000");
    fs.files.set(vp(`${ROOT}/README.md`), "# notes");
    fs.files.set(vp(`${ROOT}/2026/05/RUN-2026-05-31-100000/screenshot.png`), "binary");
    fs.files.set(vp(`${ROOT}/2026/notes.md`), "stray");

    const result = await service.list({ offset: 0, limit: 50 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.entries).toHaveLength(1);
  });

  it("returns an empty page when the evidence root does not exist (fresh vault)", async () => {
    const { service } = build();

    const result = await service.list({ offset: 0, limit: 50 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ entries: [], hasMore: false });
  });

  it("degrades an unreadable note to a path-only entry instead of failing the page", async () => {
    const { service, fs } = build();
    seed(fs, "2026/05/RUN-2026-05-31-100000");
    fs.readFile = async () => err({ code: "RUNNER_MISSING_FILE", message: "io error" });

    const result = await service.list({ offset: 0, limit: 50 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.entries[0]).toEqual({
      runId: "RUN-2026-05-31-100000",
      evidencePath: "Test Evidence/2026/05/RUN-2026-05-31-100000/summary.md",
      year: "2026",
      month: "05",
    });
  });

  it("treats a note without parsable frontmatter as a degraded entry", async () => {
    const { service, fs } = build();
    seed(fs, "2026/05/RUN-2026-05-31-100000", "no frontmatter here");

    const result = await service.list({ offset: 0, limit: 50 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.entries[0].status).toBeUndefined();
    expect(result.value.entries[0].runId).toBe("RUN-2026-05-31-100000");
  });

  it("surfaces a listing failure as EVIDENCE_LIST_FAILED", async () => {
    const { service, fs } = build();
    fs.folders.add(vp(ROOT));
    fs.listFilesRecursive = async () => err({ code: "RUNNER_MISSING_FILE", message: "io error" });

    const result = await service.list({ offset: 0, limit: 50 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("EVIDENCE_LIST_FAILED");
  });
});
