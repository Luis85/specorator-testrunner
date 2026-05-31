import { ItemView, type WorkspaceLeaf } from "obsidian";
import type { WorkspacePort } from "../../application/ports/workspace-port";
import type { UseCaseService } from "../../application/services/use-case-service";
import type { DomainEventType } from "../../domain/events/domain-event";
import type { EventBus, Unsubscribe } from "../../shared/event-bus/event-bus";
import { RenderScheduler } from "./render-scheduler";
import { projectUseCaseRows } from "./use-case-rows";

export const USE_CASE_VIEW_TYPE = "e2e-test-hub-use-cases";

/** Use Case events that should refresh the live list (US-017). */
const REFRESH_ON: DomainEventType[] = [
  "usecase.created",
  "usecase.updated",
  "usecase.deleted",
  "usecase.status.changed",
];

export interface UseCaseDashboardDeps {
  useCaseService: UseCaseService;
  workspace: WorkspacePort;
  eventBus: EventBus;
  onCreate: () => void;
}

/**
 * Live "Use Cases" panel (US-017, UC-018 precursor). Lists each Use Case with
 * ID, Title, Status, and Automation Status, refreshing on use-case events. The
 * richer Markdown traceability dashboard arrives with EPIC-009.
 */
export class UseCaseDashboardView extends ItemView {
  private readonly subscriptions: Unsubscribe[] = [];
  // Renders await findAll(); coalesce concurrent event-driven renders so a
  // slow render with stale data can't empty + rebuild the list last (PRES-M2).
  private readonly scheduler = new RenderScheduler(() => this.render());

  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: UseCaseDashboardDeps,
  ) {
    super(leaf);
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

  async onOpen(): Promise<void> {
    for (const type of REFRESH_ON) {
      this.subscriptions.push(this.deps.eventBus.subscribe(type, () => this.scheduler.schedule()));
    }
    await this.scheduler.schedule();
  }

  async onClose(): Promise<void> {
    for (const unsubscribe of this.subscriptions) unsubscribe();
    this.subscriptions.length = 0;
  }

  private async render(): Promise<void> {
    const container = this.contentEl;
    container.empty();

    const header = container.createDiv({ cls: "e2e-test-hub-uc-header" });
    header.createEl("h2", { text: "Use Cases" });
    header
      .createEl("button", { text: "New Use Case", cls: "mod-cta" })
      .addEventListener("click", () => this.deps.onCreate());

    const result = await this.deps.useCaseService.findAll();
    if (!result.ok) {
      container.createEl("p", { text: `Could not load Use Cases: ${result.error.message}` });
      return;
    }

    const rows = projectUseCaseRows(result.value);
    if (rows.length === 0) {
      container.createEl("p", { text: "No Use Cases yet. Create one to get started." });
      return;
    }

    const table = container.createEl("table", { cls: "e2e-test-hub-uc-table" });
    const headRow = table.createEl("thead").createEl("tr");
    for (const label of ["ID", "Title", "Status", "Automation"]) {
      headRow.createEl("th", { text: label });
    }

    const body = table.createEl("tbody");
    for (const row of rows) {
      const tr = body.createEl("tr");
      const open = tr.createEl("td").createEl("button", {
        text: row.id,
        cls: "e2e-test-hub-link-button",
        attr: { "aria-label": `Open Use Case ${row.id}` },
      });
      open.addEventListener("click", () => {
        void this.deps.workspace.openFile(row.path);
      });
      tr.createEl("td", { text: row.title });
      tr.createEl("td", { text: row.status });
      tr.createEl("td", { text: row.automationStatus });
    }
  }
}
