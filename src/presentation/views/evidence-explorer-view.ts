import { ItemView, type WorkspaceLeaf } from "obsidian";
import type { RunHistoryService } from "../../application/services/run-history-service";
import type { VaultPath } from "../../domain/value-objects/identifiers";
import type { EventBus } from "../../shared/event-bus/event-bus";
import {
  EVIDENCE_PAGE_SIZE,
  EVIDENCE_STATUS_FILTERS,
  projectEvidenceGroups,
  statusFilterLabel,
  type EvidenceMonthGroup,
  type EvidenceStatusFilter,
} from "./evidence-explorer-rows";
import { activateOnEnterOrSpace } from "./keyboard-activation";
import { LiveRefresh } from "./live-refresh";
import { renderLoadError } from "./modal-helpers";

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
  private readonly live: LiveRefresh;
  // Each render re-reads history fresh (same pattern as the other explorers);
  // visibleLimit only remembers how far "Load older" has extended the page.
  private visibleLimit = EVIDENCE_PAGE_SIZE;
  private filter: EvidenceStatusFilter = "all";

  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: EvidenceExplorerViewDeps,
  ) {
    super(leaf);
    this.live = new LiveRefresh(deps.eventBus, () => this.render());
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
    await this.live.open(["evidence.generated"]);
  }

  async onClose(): Promise<void> {
    this.live.close();
  }

  private async render(): Promise<void> {
    const container = this.contentEl;
    container.empty();
    container.createEl("h2", { text: "Evidence Explorer" });

    const result = await this.deps.runHistory.list({ offset: 0, limit: this.visibleLimit });
    if (!result.ok) {
      // Recoverable dead-end: offer a retry instead of a bare terminal message.
      renderLoadError(
        container,
        `Could not load run history: ${result.error.message}`,
        "Retry loading the run history",
        () => void this.live.schedule(),
      );
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
        void this.live.schedule();
      });
    }
  }

  private renderFilter(container: HTMLElement): void {
    const bar = container.createDiv({ cls: "e2e-test-hub-evidence-toolbar" });
    // The <select> nests inside its <label> so the association is structural —
    // no hardcoded id/for pair to drift (or collide across open leaves).
    const label = bar.createEl("label", { text: "Status: " });
    const select = label.createEl("select", {
      attr: { "aria-label": "Filter runs by status" },
    });
    for (const option of EVIDENCE_STATUS_FILTERS) {
      // Display labels are capitalized; the VALUE stays the lowercase filter.
      select.createEl("option", {
        text: statusFilterLabel(option),
        attr: { value: option },
      });
    }
    select.value = this.filter;
    select.addEventListener("change", () => {
      // The value space is exactly EVIDENCE_STATUS_FILTERS (options above).
      this.filter = select.value as EvidenceStatusFilter;
      void this.live.schedule();
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
      // The row carries no link role/tabindex — that would destroy its table
      // semantics for screen readers; the Run ID cell holds the real
      // link-button and the whole-row click is a sighted-user convenience.
      const tr = body.createEl("tr", { cls: "e2e-test-hub-run-row is-navigable" });
      const open = (): void => {
        void this.deps.openEvidence(row.evidencePath);
      };
      // Same pattern as the Use Cases table's id link-button.
      const link = tr.createEl("td").createEl("button", {
        text: row.runId,
        cls: "e2e-test-hub-link-button",
        attr: { "aria-label": row.ariaLabel },
      });
      link.addEventListener("click", (event) => {
        // The row's convenience click listener below would fire open() again.
        event.stopPropagation();
        open();
      });
      activateOnEnterOrSpace(link, open);
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
      tr.addEventListener("click", open);
    }
  }
}
