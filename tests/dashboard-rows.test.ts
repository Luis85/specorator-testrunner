import { describe, expect, it } from "vitest";
import type { DashboardSnapshot } from "../src/application/services/traceability-service";
import { projectDashboard } from "../src/presentation/views/dashboard-rows";

const snapshot = (over: Partial<DashboardSnapshot> = {}): DashboardSnapshot => ({
  totalUseCases: 5,
  specifiedUseCases: 4,
  automatedUseCases: 3,
  passingUseCases: 2,
  failingUseCases: 1,
  recentRuns: [],
  ...over,
});

describe("projectDashboard", () => {
  it("projects the KPI tiles in US-037 order", () => {
    const view = projectDashboard(snapshot());
    expect(view.kpis).toEqual([
      { label: "Total Use Cases", value: 5 },
      { label: "Specified", value: 4 },
      { label: "Automated", value: 3 },
      { label: "Passing", value: 2 },
      { label: "Failing", value: 1 },
    ]);
  });

  it("projects recent-run rows preserving snapshot order (US-038)", () => {
    const view = projectDashboard(
      snapshot({
        recentRuns: [
          { runId: "RUN-B", status: "passed", date: "2026-06-02T00:00:00Z", evidencePath: "ev/B.md" },
          { runId: "RUN-A", status: "failed", date: "2026-06-01T00:00:00Z" },
        ],
      }),
    );
    expect(view.recentRuns).toEqual([
      { runId: "RUN-B", status: "passed", date: "2026-06-02T00:00:00Z", evidencePath: "ev/B.md" },
      { runId: "RUN-A", status: "failed", date: "2026-06-01T00:00:00Z", evidencePath: undefined },
    ]);
  });

  it("yields an empty recent-runs list when there are no runs", () => {
    expect(projectDashboard(snapshot()).recentRuns).toEqual([]);
  });
});
