import { ItemView, type WorkspaceLeaf } from "obsidian";
import type { TraceabilityService } from "../../application/services/traceability-service";
import type { DomainEventType } from "../../domain/events/domain-event";
import { createEvent } from "../../shared/event-bus/create-event";
import type { EventBus, Unsubscribe } from "../../shared/event-bus/event-bus";
import { projectDashboard } from "./dashboard-rows";

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
];

export interface DashboardViewDeps {
  traceabilityService: TraceabilityService;
  eventBus: EventBus;
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
  // clobbering fresher output. Chain them so they run one at a time, and
  // coalesce a burst of events into a single trailing render.
  private renderChain: Promise<void> = Promise.resolve();
  private renderPending = false;

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
      this.subscriptions.push(
        this.deps.eventBus.subscribe(type, () => this.scheduleRender()),
      );
    }
    // Route the initial render through the same chain so an event arriving while
    // its async refresh is in flight can't start a concurrent render that
    // finishes first and is then clobbered by this stale initial render.
    await this.scheduleRender();
  }

  /**
   * Serializes renders so concurrent events can't interleave their async
   * refresh + rebuild. Returns the chain so the (handler-awaiting) event bus
   * preserves ordering; a burst collapses into one trailing render since the
   * queued render already picks up the latest state.
   */
  private scheduleRender(): Promise<void> {
    if (this.renderPending) return this.renderChain;
    this.renderPending = true;
    this.renderChain = this.renderChain
      .catch(() => undefined)
      .then(() => {
        this.renderPending = false;
        return this.render();
      });
    return this.renderChain;
  }

  async onClose(): Promise<void> {
    for (const unsubscribe of this.subscriptions) unsubscribe();
    this.subscriptions.length = 0;
  }

  private async render(): Promise<void> {
    const container = this.contentEl;
    container.empty();
    container.createEl("h2", { text: "Test Hub Dashboard" });

    // refreshDashboard() emits dashboard.refreshed + dashboard.kpi.updated and
    // returns the snapshot the tiles/rows are projected from (UC-018 steps 2–3).
    const result = await this.deps.traceabilityService.refreshDashboard();
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
}
