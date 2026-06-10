import { describe, expect, it } from "vitest";
import type { RunHistoryEntry } from "../src/application/services/run-history-service";
import {
  projectEvidenceGroups,
  projectEvidenceRow,
} from "../src/presentation/views/evidence-explorer-rows";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";

const entry = (overrides: Partial<RunHistoryEntry> = {}): RunHistoryEntry => ({
  runId: "RUN-2026-05-31-100000",
  evidencePath: vp("Test Evidence/2026/05/RUN-2026-05-31-100000/summary.md"),
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
  ...overrides,
});

describe("projectEvidenceRow", () => {
  it("projects a full entry", () => {
    expect(projectEvidenceRow(entry())).toEqual({
      runId: "RUN-2026-05-31-100000",
      status: "passed",
      passed: "2",
      failed: "1",
      total: "3",
      scope: "suite: smoke",
      date: "2026-05-31 10:05",
      evidencePath: "Test Evidence/2026/05/RUN-2026-05-31-100000/summary.md",
      ariaLabel: "Open evidence for RUN-2026-05-31-100000 (passed)",
    });
  });

  it("renders a degraded (path-only) entry with placeholders and status unknown", () => {
    const degraded = projectEvidenceRow(
      entry({
        status: undefined,
        passed: undefined,
        failed: undefined,
        skipped: undefined,
        total: undefined,
        createdAt: undefined,
        scope: undefined,
        target: undefined,
      }),
    );
    expect(degraded.status).toBe("unknown");
    expect(degraded.passed).toBe("—");
    expect(degraded.scope).toBe("—");
    expect(degraded.date).toBe("—");
    expect(degraded.ariaLabel).toBe("Open evidence for RUN-2026-05-31-100000 (unknown)");
  });

  it("does not repeat the target when it equals the scope (demo runs)", () => {
    expect(projectEvidenceRow(entry({ scope: "demo", target: "demo" })).scope).toBe("demo");
  });
});

describe("projectEvidenceGroups", () => {
  it("groups consecutive entries by month, newest order preserved", () => {
    const groups = projectEvidenceGroups(
      [
        entry({ runId: "RUN-B", year: "2026", month: "05" }),
        entry({ runId: "RUN-A", year: "2026", month: "05" }),
        entry({ runId: "RUN-OLD", year: "2025", month: "12" }),
      ],
      "all",
    );
    expect(groups.map((g) => g.heading)).toEqual(["2026 / 05", "2025 / 12"]);
    expect(groups[0].rows.map((r) => r.runId)).toEqual(["RUN-B", "RUN-A"]);
  });

  it("filters loaded entries by status and drops empty groups", () => {
    const groups = projectEvidenceGroups(
      [
        entry({ runId: "RUN-B", status: "failed" }),
        entry({ runId: "RUN-A", status: "passed" }),
        entry({ runId: "RUN-OLD", year: "2025", month: "12", status: "passed" }),
      ],
      "failed",
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].rows.map((r) => r.runId)).toEqual(["RUN-B"]);
  });

  it('the "unknown" pseudo-status of degraded entries only matches the all filter', () => {
    const degraded = entry({ status: undefined });
    expect(projectEvidenceGroups([degraded], "all")).toHaveLength(1);
    expect(projectEvidenceGroups([degraded], "passed")).toHaveLength(0);
  });
});
