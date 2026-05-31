import type { DashboardSnapshot } from "../../application/services/traceability-service";

/** A KPI tile the dashboard renders (US-037). */
export interface KpiTile {
  label: string;
  value: number;
}

/** A recent-run row the dashboard renders (US-038). */
export interface RecentRunRow {
  runId: string;
  status: string;
  date: string;
  evidencePath?: string;
}

/** The dashboard's full view model (KPI tiles + recent-run rows). */
export interface DashboardView {
  kpis: KpiTile[];
  recentRuns: RecentRunRow[];
}

/**
 * Pure projection of a {@link DashboardSnapshot} into KPI tiles + recent-run
 * rows (US-037/US-038), kept separate from the ItemView so the shaping is
 * unit-testable. Tile order matches the US-037 acceptance criteria.
 */
export const projectDashboard = (snapshot: DashboardSnapshot): DashboardView => ({
  kpis: [
    { label: "Total Use Cases", value: snapshot.totalUseCases },
    { label: "Specified", value: snapshot.specifiedUseCases },
    { label: "Automated", value: snapshot.automatedUseCases },
    { label: "Passing", value: snapshot.passingUseCases },
    { label: "Failing", value: snapshot.failingUseCases },
  ],
  recentRuns: snapshot.recentRuns.map((run) => ({
    runId: run.runId,
    status: run.status,
    date: run.date,
    evidencePath: run.evidencePath,
  })),
});
