import { ItemView, type WorkspaceLeaf } from "obsidian";
import type { WorkspacePort } from "../../application/ports/workspace-port";
import type { SuiteService } from "../../application/services/suite-service";
import type { DomainEventType } from "../../domain/events/domain-event";
import type { EventBus, Unsubscribe } from "../../shared/event-bus/event-bus";
import { RenderScheduler } from "./render-scheduler";
import { projectSuiteRows } from "./suite-rows";

export const SUITE_VIEW_TYPE = "e2e-test-hub-suites";

/** Suite events that should refresh the live list (US-024/US-025). */
const REFRESH_ON: DomainEventType[] = ["suite.created", "suite.updated", "suite.deleted"];

export interface SuiteDashboardDeps {
  suiteService: SuiteService;
  workspace: WorkspacePort;
  eventBus: EventBus;
  onCreate: () => void;
}

/**
 * Live "Test Suites" panel (US-024/US-025, UC-008). Lists each suite's Name,
 * ID, and Tag Expression (membership is by tag per AD-4), refreshing on suite
 * events. The default Smoke/Regression suites seeded by `createDefaults` surface
 * here via `findAll`.
 */
export class SuiteDashboardView extends ItemView {
  private readonly subscriptions: Unsubscribe[] = [];
  // Renders await findAll(); coalesce concurrent event-driven renders so a
  // slow render with stale data can't empty + rebuild the list last (PRES-M2).
  private readonly scheduler = new RenderScheduler(() => this.render());

  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: SuiteDashboardDeps,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return SUITE_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Test Suites";
  }

  getIcon(): string {
    return "layers";
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

    const header = container.createDiv({ cls: "e2e-test-hub-suite-header" });
    header.createEl("h2", { text: "Test Suites" });
    header
      .createEl("button", { text: "New Test Suite", cls: "mod-cta" })
      .addEventListener("click", () => this.deps.onCreate());

    const result = await this.deps.suiteService.findAll();
    if (!result.ok) {
      container.createEl("p", { text: `Could not load Test Suites: ${result.error.message}` });
      return;
    }

    const rows = projectSuiteRows(result.value);
    if (rows.length === 0) {
      container.createEl("p", { text: "No Test Suites yet. Create one to get started." });
      return;
    }

    const table = container.createEl("table", { cls: "e2e-test-hub-suite-table" });
    const headRow = table.createEl("thead").createEl("tr");
    for (const label of ["Name", "ID", "Tag Expression"]) {
      headRow.createEl("th", { text: label });
    }

    const body = table.createEl("tbody");
    for (const row of rows) {
      const tr = body.createEl("tr");
      const open = tr.createEl("td").createEl("button", {
        text: row.name,
        cls: "e2e-test-hub-link-button",
        attr: { "aria-label": `Open Test Suite ${row.name}` },
      });
      open.addEventListener("click", () => {
        void this.deps.workspace.openFile(row.path);
      });
      tr.createEl("td", { text: row.id });
      tr.createEl("td", { text: row.tagExpression });
    }
  }
}
