import { ItemView, type WorkspaceLeaf } from "obsidian";
import type { WorkspacePort } from "../../application/ports/workspace-port";
import type { SpecificationService } from "../../application/services/specification-service";
import type { TraceabilityService } from "../../application/services/traceability-service";
import type { DomainEventType } from "../../domain/events/domain-event";
import type { EventBus } from "../../shared/event-bus/event-bus";
import type { RunLauncher } from "../run/run-launcher";
import { LiveRefresh } from "./live-refresh";
import { openOrNotice, renderLoadError } from "./modal-helpers";
import { featureCountCell, projectUseCaseRows } from "./use-case-rows";

export const USE_CASE_VIEW_TYPE = "e2e-test-hub-use-cases";

/** Use Case events that should refresh the live list (US-017). */
const REFRESH_ON: DomainEventType[] = [
  "usecase.created",
  "usecase.updated",
  "usecase.deleted",
  "usecase.status.changed",
  // Wave F: a newly generated Feature changes the "Features" column count.
  "specification.created",
  // US-057: the Automation column is now derived from per-scenario history, so a
  // recorded run must re-render the explorer for it to reflect the new status.
  "scenario.history.recorded",
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
export class UseCaseDashboardView extends ItemView {
  private readonly live: LiveRefresh;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: UseCaseDashboardDeps,
  ) {
    super(leaf);
    // Renders await findAll(); coalesce concurrent event-driven renders so a
    // slow render with stale data can't empty + rebuild the list last (PRES-M2).
    this.live = new LiveRefresh(deps.eventBus, () => this.render());
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
    await this.live.open(REFRESH_ON);
  }

  async onClose(): Promise<void> {
    this.live.close();
  }

  private async render(): Promise<void> {
    const container = this.contentEl;
    container.empty();

    const header = container.createDiv({ cls: "e2e-test-hub-uc-header" });
    header.createEl("h2", { text: "Use Cases" });
    header
      .createEl("button", { text: "New Use Case", cls: "mod-cta" })
      .addEventListener("click", () => this.deps.onCreate());

    const [result, listed] = await Promise.all([
      this.deps.traceability.deriveAll(),
      this.deps.specificationService.listFeatures(),
    ]);
    if (!result.ok) {
      // Recoverable dead-end: offer a retry instead of a bare terminal message.
      renderLoadError(
        container,
        `Could not load Use Cases: ${result.error.message}`,
        "Retry loading the Use Cases",
        () => void this.live.schedule(),
      );
      return;
    }

    // A failed Feature listing degrades the "Features" column to "—" (unknown)
    // rather than hiding the whole explorer — the listing is insight, not data.
    const rows = projectUseCaseRows(result.value, listed.ok ? listed.value : null);
    if (rows.length === 0) {
      container.createEl("p", { text: "No Use Cases yet. Create one to get started." });
      return;
    }

    const table = container.createEl("table", { cls: "e2e-test-hub-uc-table" });
    const headRow = table.createEl("thead").createEl("tr");
    for (const label of ["ID", "Title", "Status", "Automation", "Features", "Note", "Run"]) {
      // scope="col" ties each header to its column for screen-reader tables.
      headRow.createEl("th", { text: label, attr: { scope: "col" } });
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
      // Wave F insight: Feature Specification count per Use Case, warning-
      // accented at 0 so a spec gap is visible without opening anything.
      const featuresCell = featureCountCell(row.featureCount);
      const featuresTd = tr.createEl("td", {
        text: featuresCell.text,
        cls: "e2e-test-hub-uc-features",
        attr: {
          "aria-label":
            row.featureCount === null
              ? `Feature Specifications for ${row.id} could not be listed`
              : `${row.featureCount} Feature Specification${row.featureCount === 1 ? "" : "s"}`,
        },
      });
      if (featuresCell.tooltip !== null) featuresTd.setAttr("title", featuresCell.tooltip);
      if (featuresCell.status !== null) featuresTd.dataset.status = featuresCell.status;
      const note = tr.createEl("td").createEl("button", {
        text: "Note",
        cls: "e2e-test-hub-link-button",
        attr: { "aria-label": `Open the ${row.id} note` },
      });
      note.addEventListener("click", () => {
        void openOrNotice(this.deps.workspace, row.path);
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
