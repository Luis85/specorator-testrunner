import type { WorkspaceLeaf } from "obsidian";
import type { WorkspacePort } from "../../application/ports/workspace-port";
import type { SpecificationService } from "../../application/services/specification-service";
import type { TraceabilityService } from "../../application/services/traceability-service";
import type { DomainEventType } from "../../domain/events/domain-event";
import type { EventBus } from "../../shared/event-bus/event-bus";
import type { RunLauncher } from "../run/run-launcher";
import { LiveDashboardView } from "./live-dashboard-view";
import { renderUseCaseDashboardBody } from "./use-case-dashboard-body";

export const USE_CASE_VIEW_TYPE = "e2e-test-hub-use-cases";

/** Use Case events that should refresh the live list (US-017). */
const REFRESH_ON: DomainEventType[] = [
  "usecase.created",
  "usecase.updated",
  "usecase.deleted",
  "usecase.status.changed",
  // Wave F: a newly generated Feature changes the "Features" column count.
  "specification.created",
  // US-057: the Automation column is derived via traceability.deriveAll() from
  // both the parsed Features and per-scenario history, so a Feature EDIT (adding
  // @wip, adding steps, renaming a scenario) changes the derived roll-up without
  // any Use Case event — re-render on it as the dashboard does.
  "specification.updated",
  // US-057: the Automation column is now derived from per-scenario history, so a
  // recorded run must re-render the explorer for it to reflect the new status.
  "scenario.history.recorded",
  // deriveAll() reads scenario history under the configured Evidence root, so an
  // evidencePath change (persisted via settings.updated) repoints the history
  // tree — re-render so the column isn't served from the old root.
  "settings.updated",
];

export interface UseCaseDashboardDeps {
  // Use Cases with history-derived automationStatus (US-057), so the Automation
  // column matches the dashboard KPIs rather than the stale frontmatter value.
  traceability: Pick<TraceabilityService, "deriveAll">;
  // Wave F insight: the Feature listing powers the per-Use-Case "Features"
  // column (count by the ADR-0012 filename back-reference).
  specificationService: Pick<SpecificationService, "listFeatures">;
  workspace: WorkspacePort;
  eventBus: EventBus;
  // Shared run-launch surface (Wave B): the per-row Run button starts a
  // use-case-scoped run through the same launcher the command palette uses.
  runLauncher: Pick<RunLauncher, "launch">;
  onCreate: () => void;
  // Wave D: clicking a Use Case id opens its detail view (the UI-driven
  // authoring & testing surface). Raw note access stays available via a
  // separate per-row "Note" link.
  onOpenDetail: (useCaseId: string) => void;
}

/**
 * Live "Use Cases" panel (US-017, UC-018 precursor). Lists each Use Case with
 * ID, Title, Status, and Automation Status, refreshing on use-case events. The
 * richer Markdown traceability dashboard arrives with EPIC-009.
 */
export class UseCaseDashboardView extends LiveDashboardView {
  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: UseCaseDashboardDeps,
  ) {
    super(leaf, deps.eventBus, REFRESH_ON);
  }

  getViewType(): string {
    return USE_CASE_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Use Cases";
  }

  getIcon(): string {
    return "list-checks";
  }

  protected async render(): Promise<void> {
    // Thin caller: the body builds entirely into this leaf's `contentEl` via the
    // host-agnostic renderer, so the standalone leaf and the (later) Test Hub
    // body render identically (ADR-0031).
    await renderUseCaseDashboardBody(this.contentEl, {
      traceability: this.deps.traceability,
      specificationService: this.deps.specificationService,
      workspace: this.deps.workspace,
      runLauncher: this.deps.runLauncher,
      onCreate: this.deps.onCreate,
      onOpenDetail: this.deps.onOpenDetail,
      refresh: () => void this.live.schedule(),
      // The standalone leaf has no KPI funnel to drill from, so it always shows
      // every Use Case: the filter is fixed "all" (no chip renders), and the
      // clearer is unreachable (the chip's ✕ is the only caller).
      filter: "all",
      clearFilter: () => undefined,
    });
  }
}
