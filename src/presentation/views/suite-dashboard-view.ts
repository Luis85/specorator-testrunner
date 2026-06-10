import { ItemView, type WorkspaceLeaf } from "obsidian";
import type { WorkspacePort } from "../../application/ports/workspace-port";
import type { FeatureInsightService } from "../../application/services/feature-insight-service";
import type { SuiteService } from "../../application/services/suite-service";
import type { DomainEventType } from "../../domain/events/domain-event";
import type { EventBus, Unsubscribe } from "../../shared/event-bus/event-bus";
import type { RunLauncher } from "../run/run-launcher";
import { RenderScheduler } from "./render-scheduler";
import { projectSuiteRows, scenarioCountCell } from "./suite-rows";

export const SUITE_VIEW_TYPE = "e2e-test-hub-suites";

/**
 * Suite events that should refresh the live list (US-024/US-025), plus the
 * Feature lifecycle events (Wave F): a created/edited Feature changes which
 * scenarios a Tag Expression matches, so the "Scenarios" column re-counts.
 */
const REFRESH_ON: DomainEventType[] = [
  "suite.created",
  "suite.updated",
  "suite.deleted",
  "specification.created",
  "specification.updated",
];

export interface SuiteDashboardDeps {
  suiteService: SuiteService;
  workspace: WorkspacePort;
  eventBus: EventBus;
  // Shared run-launch surface (Wave B): the per-row Run button starts a
  // suite-scoped run through the same launcher the command palette uses.
  runLauncher: Pick<RunLauncher, "launch">;
  // Wave F insight: evaluates a suite's Tag Expression against every Feature's
  // scenarios so the "Scenarios" column shows the actual matched count.
  featureInsight: Pick<FeatureInsightService, "scenarioCounter">;
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
    // Unsubscribe BEFORE disposing the scheduler so a handler firing mid-teardown
    // can't schedule() on an already-disposed scheduler (PRES-M1 ordering).
    for (const unsubscribe of this.subscriptions) unsubscribe();
    this.subscriptions.length = 0;
    this.scheduler.dispose();
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
    for (const label of ["Name", "ID", "Tag Expression", "Scenarios", "Run"]) {
      // scope="col" ties each header to its column for screen-reader tables.
      headRow.createEl("th", { text: label, attr: { scope: "col" } });
    }

    // Wave F insight, batched (review): load + parse the Feature corpus ONCE
    // per render and count per suite synchronously — the per-row variant
    // re-read every Feature file once PER SUITE (O(suites × features) I/O on
    // every event-driven re-render). A corpus-load failure degrades every
    // row's cell the same way a per-row failure did.
    const counter = await this.deps.featureInsight.scenarioCounter();

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
      // How many scenarios this Tag Expression actually matches (effective
      // tags, so feature-level tags count). The projection is pure
      // (scenarioCountCell); a malformed expression surfaces its parse error.
      const cell = scenarioCountCell(counter.ok ? counter.value(row.tagExpression) : counter);
      const scenariosTd = tr.createEl("td", {
        text: cell.text,
        cls: "e2e-test-hub-suite-scenarios",
        attr: { "aria-label": cell.ariaLabel },
      });
      if (cell.tooltip !== null) scenariosTd.setAttr("title", cell.tooltip);
      if (cell.status !== null) scenariosTd.dataset.status = cell.status;
      // Per-row Run button (Wave B): launches a suite-scoped run via the shared
      // launcher, which reveals the Test Console first so output streams in.
      const run = tr.createEl("td").createEl("button", {
        text: "Run",
        cls: "e2e-test-hub-run-button",
        attr: { "aria-label": `Run suite ${row.name}` },
      });
      run.addEventListener("click", () => {
        void this.deps.runLauncher.launch({ scope: "suite", target: row.id });
      });
    }
  }
}
