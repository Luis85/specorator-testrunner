import type { WorkspaceLeaf } from "obsidian";
import type { RunHistoryService } from "../../application/services/run-history-service";
import type { EventBus } from "../../shared/event-bus/event-bus";
import { type NavigationTarget } from "../navigation/navigation-target";
import { EVIDENCE_PAGE_SIZE, type EvidenceStatusFilter } from "./evidence-explorer-rows";
import { renderEvidenceExplorerBody } from "./evidence-explorer-body";
import { LiveDashboardView } from "./live-dashboard-view";

export const EVIDENCE_EXPLORER_VIEW_TYPE = "e2e-test-hub-evidence";

/**
 * Callbacks/services the explorer drives. A run row navigates by run id through
 * the unified deep-link port (WS-B4), which resolves the run to the evidence
 * note it produced — the view never opens files itself.
 */
export interface EvidenceExplorerViewDeps {
  runHistory: RunHistoryService;
  eventBus: EventBus;
  navigate: (target: NavigationTarget) => void;
}

/**
 * Main-area Evidence Explorer (EPIC-008): browses the FULL partitioned run
 * history (`Test Evidence/YYYY/MM/<runId>/summary.md`), unlike the dashboard's
 * Recent Runs which shows only the latest run per Use Case. Month-grouped,
 * status-filterable, paged via "Load older"; every row opens its evidence note.
 */
export class EvidenceExplorerView extends LiveDashboardView {
  // Each render re-reads history fresh (same pattern as the other explorers);
  // visibleLimit only remembers how far "Load older" has extended the page.
  private visibleLimit = EVIDENCE_PAGE_SIZE;
  private filter: EvidenceStatusFilter = "all";

  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: EvidenceExplorerViewDeps,
  ) {
    super(leaf, deps.eventBus, ["evidence.generated"]);
  }

  getViewType(): string {
    return EVIDENCE_EXPLORER_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Evidence Explorer";
  }

  getIcon(): string {
    return "history";
  }

  protected async render(): Promise<void> {
    // Thin caller: the body builds entirely into this leaf's `contentEl` via the
    // host-agnostic renderer, so the standalone leaf and the (later) Test Hub
    // body render identically (ADR-0031). The view owns the ephemeral
    // filter/limit state and passes it in with mutators that re-render.
    await renderEvidenceExplorerBody(
      this.contentEl,
      {
        runHistory: this.deps.runHistory,
        navigate: this.deps.navigate,
        refresh: () => void this.live.schedule(),
      },
      {
        filter: this.filter,
        visibleLimit: this.visibleLimit,
        onFilterChange: (filter) => {
          this.filter = filter;
          void this.live.schedule();
        },
        onLoadOlder: () => {
          this.visibleLimit += EVIDENCE_PAGE_SIZE;
          void this.live.schedule();
        },
      },
    );
  }
}
