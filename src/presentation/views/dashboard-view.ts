export type { DashboardDocumentType } from "./dashboard-view-deps";

/**
 * The legacy "Test Hub dashboard" leaf type (FEAT-019, US-037/US-038, UC-018).
 * The standalone dashboard view it once backed is SUPERSEDED by the Test Hub
 * home shell (WS-B1, ADR-0031): the overview section now hosts the same KPI +
 * recent-runs body (via the shared host-agnostic {@link renderDashboardBody}).
 *
 * This view type is kept ONLY as a registered alias so a persisted layout
 * referencing `e2e-test-hub-dashboard` never orphans — `register-views.ts`
 * mounts a thin redirect (`DashboardAliasView`) under it that opens the hub and
 * detaches itself (ADR-0031 alias migration). The const stays here as the legacy
 * type's canonical home; the ribbon / open-dashboard command still target it
 * until the PR4 ribbon/command cleanup retires them.
 */
export const DASHBOARD_VIEW_TYPE = "e2e-test-hub-dashboard";
