import { ItemView, type WorkspaceLeaf } from "obsidian";
import type { TraceabilityService } from "../../application/services/traceability-service";
import type { DomainEventType } from "../../domain/events/domain-event";
import { createEvent } from "../../shared/event-bus/create-event";
import type { EventBus, Unsubscribe } from "../../shared/event-bus/event-bus";
import { projectDashboard } from "./dashboard-rows";
import { RenderScheduler } from "./render-scheduler";

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
];

/** The documentation entry points reachable from the dashboard (AC-016). */
export type DashboardDocumentType = "getting-started" | "manual" | "troubleshooting";

export interface DashboardViewDeps {
  traceabilityService: TraceabilityService;
  eventBus: EventBus;
  // AC-016: open the Getting Started guide / User Manual straight from the
  // dashboard. A callback (not the service) keeps the view decoupled.
  openDocumentation: (documentType: DashboardDocumentType) => void | Promise<void>;
}

/**
 * Live "Test Hub Dashboard" panel (FEAT-019, US-037/US-038, UC-018). Shows the
 * KPI tiles (total / specified / automated / passing / failing) and a recent-
 * runs list, refreshing on use-case / test-run / evidence events.
 *
 * Counts + ordering are aggregated by {@link TraceabilityService.refreshDashboard}
 * (which itself emits `dashboard.refreshed` + `dashboard.kpi.updated`); this view
 * adds the `dashboard.opened` event on open and projects the snapshot to a view
 * model via the pure {@link projectDashboard}.
 */
export class DashboardView extends ItemView {
  private readonly subscriptions: Unsubscribe[] = [];
  // Renders are async (they await refreshDashboard). Firing them concurrently
  // lets a slower render with STALE data empty + rebuild the container last,
  // clobbering fresher output. The scheduler chains them so they run one at a
  // time, and coalesces a burst of events into a single trailing render.
  private readonly scheduler = new RenderScheduler(() => this.render());

  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: DashboardViewDeps,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return DASHBOARD_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Test Hub Dashboard";
  }

  getIcon(): string {
    return "gauge";
  }

  async onOpen(): Promise<void> {
    // UC-018 step 1: opening the dashboard is itself an event.
    await this.deps.eventBus.publish(
      createEvent("dashboard.opened", { dashboardPath: DASHBOARD_VIEW_TYPE }),
    );
    for (const type of REFRESH_ON) {
      this.subscriptions.push(this.deps.eventBus.subscribe(type, () => this.scheduler.schedule()));
    }
    // First paint: PUSH a refresh once (emits dashboard.refreshed + kpi.updated
    // per UC-018 steps 2–3). Subsequent event-driven re-renders read the
    // non-emitting snapshot() so they never loop. The subscriptions above ignore
    // this self-published refresh while it is already rendering (coalesced).
    await this.deps.traceabilityService.refreshDashboard().catch(() => undefined);
    // Route the initial render through the same chain so an event arriving while
    // its async refresh is in flight can't start a concurrent render that
    // finishes first and is then clobbered by this stale initial render.
    await this.scheduler.schedule();
  }

  async onClose(): Promise<void> {
    this.scheduler.dispose();
    for (const unsubscribe of this.subscriptions) unsubscribe();
    this.subscriptions.length = 0;
  }

  private async render(): Promise<void> {
    const container = this.contentEl;
    container.empty();
    container.createEl("h2", { text: "Test Hub Dashboard" });

    // Documentation access (AC-016): open the Getting Started guide / User
    // Manual without leaving the dashboard. Rendered FIRST — before the refresh
    // call and its error early-return — so the manual is reachable even when the
    // dashboard can't load (exactly when a user may need it).
    this.renderDocumentationActions(container);

    // Read the NON-emitting snapshot (P2-6): the tiles/rows are projected from
    // it without re-publishing dashboard.* events, so a render driven by a
    // dashboard.refreshed/kpi.updated event can't re-trigger a refresh (no loop).
    // The one-time emitting push happens in onOpen and from the coordinator.
    const result = await this.deps.traceabilityService.snapshot();
    if (!result.ok) {
      container.createEl("p", { text: `Could not load dashboard: ${result.error.message}` });
      return;
    }

    const view = projectDashboard(result.value);

    // KPI tiles (US-037).
    const tiles = container.createDiv({ cls: "e2e-test-hub-kpi-tiles" });
    for (const kpi of view.kpis) {
      const tile = tiles.createDiv({ cls: "e2e-test-hub-kpi-tile" });
      tile.createDiv({ cls: "e2e-test-hub-kpi-value", text: String(kpi.value) });
      tile.createDiv({ cls: "e2e-test-hub-kpi-label", text: kpi.label });
    }

    // Recent runs (US-038).
    container.createEl("h3", { text: "Recent Runs" });
    if (view.recentRuns.length === 0) {
      container.createEl("p", { text: "No test runs yet." });
      return;
    }

    const table = container.createEl("table", { cls: "e2e-test-hub-runs-table" });
    const headRow = table.createEl("thead").createEl("tr");
    for (const label of ["Run", "Status", "Date"]) {
      headRow.createEl("th", { text: label });
    }
    const body = table.createEl("tbody");
    for (const run of view.recentRuns) {
      const tr = body.createEl("tr");
      tr.createEl("td", { text: run.runId });
      tr.createEl("td", { text: run.status });
      tr.createEl("td", { text: run.date });
    }
  }

  /** AC-016 documentation buttons (US-046: Getting Started / Manual / Troubleshooting). */
  private renderDocumentationActions(container: HTMLElement): void {
    const actions = container.createDiv({ cls: "e2e-test-hub-doc-actions" });
    // All three guides US-046 maps to UC-021/022/023 must be reachable here.
    const buttons: ReadonlyArray<[string, DashboardDocumentType]> = [
      ["Getting Started", "getting-started"],
      ["User Manual", "manual"],
      ["Troubleshooting", "troubleshooting"],
    ];
    for (const [label, documentType] of buttons) {
      const button = actions.createEl("button", {
        text: label,
        cls: "e2e-test-hub-doc-button",
      });
      button.addEventListener("click", () => {
        void this.deps.openDocumentation(documentType);
      });
    }
  }
}
