import { ItemView, type WorkspaceLeaf } from "obsidian";
import type { WorkspacePort } from "../../application/ports/workspace-port";
import type { UseCaseService } from "../../application/services/use-case-service";
import type { DomainEventType } from "../../domain/events/domain-event";
import type { EventBus, Unsubscribe } from "../../shared/event-bus/event-bus";
import type { RunLauncher } from "../run/run-launcher";
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
    // Unsubscribe BEFORE disposing the scheduler so a handler firing mid-teardown
    // can't schedule() on an already-disposed scheduler (PRES-M1 ordering).
    for (const unsubscribe of this.subscriptions) unsubscribe();
    this.subscriptions.length = 0;
    this.scheduler.dispose();
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
    for (const label of ["ID", "Title", "Status", "Automation", "Note", "Run"]) {
      headRow.createEl("th", { text: label });
    }

    const body = table.createEl("tbody");
    for (const row of rows) {
      const tr = body.createEl("tr");
      // Wave D: the id opens the Use Case detail view (Feature Specifications +
      // authoring/testing actions); raw note access stays a separate "Note"
      // link in its own column.
      const open = tr.createEl("td").createEl("button", {
        text: row.id,
        cls: "e2e-test-hub-link-button",
        attr: { "aria-label": `Open Use Case ${row.id} detail` },
      });
      open.addEventListener("click", () => {
        this.deps.onOpenDetail(row.id);
      });
      tr.createEl("td", { text: row.title });
      tr.createEl("td", { text: row.status });
      tr.createEl("td", { text: row.automationStatus });
      const note = tr.createEl("td").createEl("button", {
        text: "Note",
        cls: "e2e-test-hub-link-button",
        attr: { "aria-label": `Open the ${row.id} note` },
      });
      note.addEventListener("click", () => {
        void this.deps.workspace.openFile(row.path);
      });
      // Per-row Run button (Wave B): launches a use-case-scoped run via the
      // shared launcher, which reveals the Test Console first.
      const run = tr.createEl("td").createEl("button", {
        text: "Run",
        cls: "e2e-test-hub-run-button",
        attr: { "aria-label": `Run Use Case ${row.id}` },
      });
      run.addEventListener("click", () => {
        void this.deps.runLauncher.launch({ scope: "use-case", target: row.id });
      });
    }
  }
}
