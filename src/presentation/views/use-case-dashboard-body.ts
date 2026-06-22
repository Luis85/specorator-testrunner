import type { SpecificationService } from "../../application/services/specification-service";
import type { TraceabilityService } from "../../application/services/traceability-service";
import type { WorkspacePort } from "../../application/ports/workspace-port";
import type { RunLauncher } from "../run/run-launcher";
import { useCaseFilterLabel, type UseCaseKpiFilter } from "./dashboard-rows";
import { appendLinkButtonCell } from "./link-button-cell";
import { renderListHeader } from "./list-header";
import { openOrNotice, renderLoadError } from "./modal-helpers";
import { featureCountCell, filterUseCaseRows, projectUseCaseRows } from "./use-case-rows";

/**
 * The deps the Use Cases body needs to load + render, independent of the leaf:
 * the services it reads, the workspace port for note access, the run launcher,
 * the create/open callbacks, and a `refresh` it wires to the load-error retry
 * (the standalone leaf passes `this.live.schedule`, the later Test Hub its own
 * section re-render).
 */
export interface UseCaseDashboardBodyDeps {
  // Use Cases with history-derived automationStatus (US-057), so the Automation
  // column matches the dashboard KPIs rather than the stale frontmatter value.
  traceability: Pick<TraceabilityService, "deriveAll">;
  // Wave F insight: the Feature listing powers the per-Use-Case "Features"
  // column (count by the ADR-0012 filename back-reference).
  specificationService: Pick<SpecificationService, "listFeatures">;
  workspace: WorkspacePort;
  // Shared run-launch surface (Wave B): the per-row Run button starts a
  // use-case-scoped run through the same launcher the command palette uses.
  runLauncher: Pick<RunLauncher, "launch">;
  onCreate: () => void;
  // Wave D: clicking a Use Case id opens its detail view (the UI-driven
  // authoring & testing surface). Raw note access stays available via a
  // separate per-row "Note" link.
  onOpenDetail: (useCaseId: string) => void;
  /** Re-renders the body (load-error retry). */
  refresh: () => void;
  /**
   * The active KPI funnel filter (E1 PR3): a tile drill-down carries the stage
   * it represents, scoping the table to those rows and showing a clear-able
   * chip. `"all"` is the default no-filter view (no chip). Hub-owned ephemeral
   * state, supplied in `renderBody` like `refresh` — mirrors the Evidence
   * explorer's filter lifecycle.
   */
  filter: UseCaseKpiFilter;
  /** Clears the active filter back to `"all"` and re-renders (the chip's ✕). */
  clearFilter: () => void;
}

/**
 * Renders the "Use Cases" body into `el` (host-agnostic, ADR-0031): the header
 * bar, then the per-Use-Case table (id/title/status/automation/features/note/run),
 * or the empty/error state. Builds entirely into the passed element via the
 * shared {@link renderListHeader}, so the standalone leaf and the (later) hub
 * render it identically. Loads its own data so the hub calls it the same way.
 */
export const renderUseCaseDashboardBody = async (
  el: HTMLElement,
  deps: UseCaseDashboardBodyDeps,
): Promise<void> => {
  renderListHeader(el, {
    headerCls: "e2e-test-hub-uc-header",
    title: "Use Cases",
    actionLabel: "New Use Case",
    onAction: () => deps.onCreate(),
  });

  const [result, listed] = await Promise.all([
    deps.traceability.deriveAll(),
    deps.specificationService.listFeatures(),
  ]);
  if (!result.ok) {
    // Recoverable dead-end: offer a retry instead of a bare terminal message.
    renderLoadError(
      el,
      `Could not load Use Cases: ${result.error.message}`,
      "Retry loading the Use Cases",
      () => deps.refresh(),
    );
    return;
  }

  // A failed Feature listing degrades the "Features" column to "—" (unknown)
  // rather than hiding the whole explorer — the listing is insight, not data.
  const allRows = projectUseCaseRows(result.value, listed.ok ? listed.value : null);
  if (allRows.length === 0) {
    el.createEl("p", { text: "No Use Cases yet. Create one to get started." });
    return;
  }

  // A KPI tile drilled in carrying its funnel stage: show the clear-able chip
  // (chrome affordance, never a status colour) above the table, then scope the
  // rows to that stage with the SAME predicate the funnel counts with.
  renderFilterChip(el, deps);
  const rows = filterUseCaseRows(allRows, deps.filter);
  if (rows.length === 0) {
    el.createEl("p", {
      text: `No Use Cases match the ${deps.filter} filter. Clear the filter to see all Use Cases.`,
    });
    return;
  }

  const table = el.createEl("table", { cls: "e2e-test-hub-uc-table" });
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
    appendLinkButtonCell(tr, {
      text: row.id,
      ariaLabel: `Open Use Case ${row.id} detail`,
      onClick: () => deps.onOpenDetail(row.id),
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
    appendLinkButtonCell(tr, {
      text: "Note",
      ariaLabel: `Open the ${row.id} note`,
      onClick: () => void openOrNotice(deps.workspace, row.path),
    });
    // Per-row Run button (Wave B): launches a use-case-scoped run via the
    // shared launcher, which reveals the Test Console first.
    const run = tr.createEl("td").createEl("button", {
      text: "Run",
      cls: "e2e-test-hub-run-button",
      attr: { "aria-label": `Run Use Case ${row.id}` },
    });
    run.addEventListener("click", () => {
      void deps.runLauncher.launch({ scope: "use-case", target: row.id });
    });
  }
};

/**
 * Renders the active-filter chip (E1 PR3) above the table: a labelled pill with
 * a focusable clear button (real `<button>` semantics + an `aria-label`) that
 * resets the filter to `"all"` via {@link UseCaseDashboardBodyDeps.clearFilter}.
 * `"all"` is the no-filter state, so it renders nothing. Chip styling is chrome
 * (`--spec-accent`/neutral), NOT a status colour — it is an affordance, not a
 * verdict. Built with createDiv/createEl/setText only (never innerHTML).
 */
const renderFilterChip = (el: HTMLElement, deps: UseCaseDashboardBodyDeps): void => {
  if (deps.filter === "all") return;
  const label = useCaseFilterLabel(deps.filter);
  const bar = el.createDiv({ cls: "e2e-test-hub-uc-filter" });
  const chip = bar.createDiv({ cls: "e2e-test-hub-uc-filter-chip" });
  chip.createSpan({ cls: "e2e-test-hub-uc-filter-label", text: `${label} Use Cases` });
  const clear = chip.createEl("button", {
    cls: "e2e-test-hub-uc-filter-clear",
    text: "✕",
    attr: { "aria-label": `Clear the ${deps.filter} filter`, type: "button" },
  });
  clear.addEventListener("click", () => {
    deps.clearFilter();
  });
};
