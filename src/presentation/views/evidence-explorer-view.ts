import { ItemView, type WorkspaceLeaf } from "obsidian";
import type { RunHistoryService } from "../../application/services/run-history-service";
import type { VaultPath } from "../../domain/value-objects/identifiers";
import type { EventBus, Unsubscribe } from "../../shared/event-bus/event-bus";
import {
  EVIDENCE_PAGE_SIZE,
  EVIDENCE_STATUS_FILTERS,
  projectEvidenceGroups,
  type EvidenceMonthGroup,
  type EvidenceStatusFilter,
} from "./evidence-explorer-rows";
import { RenderScheduler } from "./render-scheduler";

export const EVIDENCE_EXPLORER_VIEW_TYPE = "e2e-test-hub-evidence";

/**
 * Callbacks/services the explorer drives. `openEvidence` is the same callback
 * the dashboard's recent-run rows use, wired in main.ts — the view never opens
 * files itself.
 */
export interface EvidenceExplorerViewDeps {
  runHistory: RunHistoryService;
  eventBus: EventBus;
  openEvidence: (path: VaultPath) => void | Promise<void>;
}

/**
 * Main-area Evidence Explorer (EPIC-008): browses the FULL partitioned run
 * history (`Test Evidence/YYYY/MM/<runId>/summary.md`), unlike the dashboard's
 * Recent Runs which shows only the latest run per Use Case. Month-grouped,
 * status-filterable, paged via "Load older"; every row opens its evidence note.
 */
export class EvidenceExplorerView extends ItemView {
  private readonly subscriptions: Unsubscribe[] = [];
  private readonly scheduler = new RenderScheduler(() => this.render());
  // Each render re-reads history fresh (same pattern as the other explorers);
  // visibleLimit only remembers how far "Load older" has extended the page.
  private visibleLimit = EVIDENCE_PAGE_SIZE;
  private filter: EvidenceStatusFilter = "all";

  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: EvidenceExplorerViewDeps,
  ) {
    super(leaf);
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

  async onOpen(): Promise<void> {
    this.subscriptions.push(
      this.deps.eventBus.subscribe("evidence.generated", () => this.scheduler.schedule()),
    );
    await this.scheduler.schedule();
  }

  async onClose(): Promise<void> {
    // Unsubscribe BEFORE disposing the scheduler so a handler firing
    // mid-teardown can't schedule() on a disposed scheduler (PRES-M1 ordering).
    for (const unsubscribe of this.subscriptions) unsubscribe();
    this.subscriptions.length = 0;
    this.scheduler.dispose();
  }

  private async render(): Promise<void> {
    const container = this.contentEl;
    container.empty();
    container.createEl("h2", { text: "Evidence Explorer" });

    const result = await this.deps.runHistory.list({ offset: 0, limit: this.visibleLimit });
    if (!result.ok) {
      container.createEl("p", { text: `Could not load run history: ${result.error.message}` });
      return;
    }
    const { entries, hasMore } = result.value;
    // entries is the page from offset 0, so empty means no history at all.
    if (entries.length === 0) {
      container.createEl("p", { text: "No Test Runs yet. Run a Test Suite to see results here." });
      return;
    }

    this.renderFilter(container);

    const groups = projectEvidenceGroups(entries, this.filter);
    if (groups.length === 0) {
      container.createEl("p", {
        text: `No loaded runs with status "${this.filter}". Load older runs or change the filter.`,
      });
    }
    for (const group of groups) this.renderGroup(container, group);

    if (hasMore) {
      const button = container.createEl("button", {
        text: "Load older runs",
        cls: "e2e-test-hub-load-older",
        attr: { "aria-label": "Load older runs" },
      });
      button.addEventListener("click", () => {
        this.visibleLimit += EVIDENCE_PAGE_SIZE;
        void this.scheduler.schedule();
      });
    }
  }

  private renderFilter(container: HTMLElement): void {
    const bar = container.createDiv({ cls: "e2e-test-hub-evidence-toolbar" });
    bar.createEl("label", { text: "Status: ", attr: { for: "e2e-test-hub-evidence-filter" } });
    const select = bar.createEl("select", {
      attr: { id: "e2e-test-hub-evidence-filter", "aria-label": "Filter runs by status" },
    });
    for (const option of EVIDENCE_STATUS_FILTERS) {
      select.createEl("option", {
        text: option === "all" ? "All" : option,
        attr: { value: option },
      });
    }
    select.value = this.filter;
    select.addEventListener("change", () => {
      // The value space is exactly EVIDENCE_STATUS_FILTERS (options above).
      this.filter = select.value as EvidenceStatusFilter;
      void this.scheduler.schedule();
    });
  }

  private renderGroup(container: HTMLElement, group: EvidenceMonthGroup): void {
    container.createEl("h3", { text: group.heading });
    const table = container.createEl("table", { cls: "e2e-test-hub-runs-table" });
    const headRow = table.createEl("thead").createEl("tr");
    for (const label of ["Run", "Status", "Passed", "Failed", "Total", "Scope", "Date"]) {
      headRow.createEl("th", { text: label, attr: { scope: "col" } });
    }
    const body = table.createEl("tbody");
    for (const row of group.rows) {
      const tr = body.createEl("tr", {
        cls: "e2e-test-hub-run-row is-navigable",
        attr: { "aria-label": row.ariaLabel, role: "link", tabindex: "0" },
      });
      tr.createEl("td", { text: row.runId });
      // data-status + visible text mirrors the dashboard's colour-blind-safe
      // status cells (styles.css tints on data-status, the label always stays).
      tr.createEl("td", {
        text: row.status,
        cls: "e2e-test-hub-run-status",
        attr: { "data-status": row.status },
      });
      tr.createEl("td", { text: row.passed });
      tr.createEl("td", { text: row.failed });
      tr.createEl("td", { text: row.total });
      tr.createEl("td", { text: row.scope });
      tr.createEl("td", { text: row.date });
      const open = (): void => {
        void this.deps.openEvidence(row.evidencePath);
      };
      tr.addEventListener("click", open);
      tr.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      });
    }
  }
}
