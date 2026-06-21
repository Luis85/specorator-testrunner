import type { WorkspaceLeaf } from "obsidian";
import type { DomainEventType } from "../../domain/events/domain-event";
import { createEvent } from "../../shared/event-bus/create-event";
import { renderDashboardBody } from "./dashboard-view-body";
import type { DashboardViewDeps } from "./dashboard-view-deps";
import { LiveDashboardView } from "./live-dashboard-view";

export type { DashboardDocumentType, DashboardViewDeps } from "./dashboard-view-deps";

export const DASHBOARD_VIEW_TYPE = "e2e-test-hub-dashboard";

/**
 * Events that should re-aggregate the KPIs / recent runs (UC-018). Use Case
 * changes move the roll-up counts (ADR-0017), test runs move the recent-run
 * list, and evidence links surface freshly-generated reports.
 */
const REFRESH_ON: DomainEventType[] = [
  "usecase.created",
  "usecase.updated",
  "usecase.deleted",
  "usecase.status.changed",
  "testrun.completed",
  "testrun.failed",
  "testrun.cancelled",
  "evidence.generated",
  "evidence.linkedToUseCase",
  // KPI automation status is derived from parsed feature files, so a feature
  // edit (steps/scenarios/@wip) changes the counts — refresh on it too.
  "specification.updated",
  // The PostRunCoordinator PUSHES a refresh after a run settles, even when no
  // view was open during the run (P2-6); react to it so an already-open
  // dashboard repaints with the new run/KPIs. Re-rendering reads the
  // NON-emitting snapshot() (see render()), so reacting here cannot loop.
  "dashboard.refreshed",
  "dashboard.kpi.updated",
  // An active-environment switch persists through settings, which emits
  // `settings.updated`; repaint the badge (+ anything env-derived) on it.
  "settings.updated",
  // The Guided Tour CTA disappears once the tour completes; repaint on it so
  // an already-open dashboard hides the banner without a manual refresh.
  "tour.completed",
  // Keep the PRD & roadmap section live as PRDs are created/deleted.
  "prd.created",
  "prd.deleted",
];

/**
 * Live "Test Hub Dashboard" panel (FEAT-019, US-037/US-038, UC-018) turned into
 * the home/hub a user lands on (Wave C). Shows a quick-action bar, the active-
 * environment badge + switcher, navigable KPI tiles, and actionable recent-run
 * rows, refreshing on use-case / test-run / evidence / settings events.
 *
 * Counts + ordering are aggregated by {@link TraceabilityService.refreshDashboard}
 * (which itself emits `dashboard.refreshed` + `dashboard.kpi.updated`); this view
 * adds the `dashboard.opened` event on open and projects the snapshot to a view
 * model via the pure {@link projectDashboard}.
 */
export class DashboardView extends LiveDashboardView {
  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: DashboardViewDeps,
  ) {
    super(leaf, deps.eventBus, REFRESH_ON);
  }

  getViewType(): string {
    return DASHBOARD_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Test Hub dashboard";
  }

  getIcon(): string {
    return "gauge";
  }

  async onOpen(): Promise<void> {
    // UC-018 step 1: opening the dashboard is itself an event.
    await this.deps.eventBus.publish(
      createEvent("dashboard.opened", { dashboardPath: DASHBOARD_VIEW_TYPE }),
    );
    // Subscribe FIRST (open() registers synchronously and queues the initial
    // render), then PUSH one refresh (emits dashboard.refreshed + kpi.updated
    // per UC-018 steps 2–3) — its self-published events coalesce into the
    // already-pending render instead of being missed in a subscribe gap.
    // Subsequent event-driven re-renders read the non-emitting snapshot() so
    // they never loop.
    const initialRender = this.live.open(this.refreshOn);
    await this.deps.traceabilityService.refreshDashboard().catch(() => undefined);
    await initialRender;
  }

  protected async render(): Promise<void> {
    // Thin caller: the body builds entirely into this leaf's `contentEl` via the
    // host-agnostic renderer, so the standalone leaf and the (later) Test Hub
    // overview body render identically (ADR-0031). `app` is passed for the
    // environment-switch picker; `refresh` is the load-error retry path.
    await renderDashboardBody(this.contentEl, this.app, this.deps, () => void this.live.schedule());
  }
}
