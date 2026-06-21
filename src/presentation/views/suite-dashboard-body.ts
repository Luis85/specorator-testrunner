import type { FeatureInsightService } from "../../application/services/feature-insight-service";
import type { SuiteService } from "../../application/services/suite-service";
import type { RunLauncher } from "../run/run-launcher";
import { suiteTarget, type NavigationTarget } from "../navigation/navigation-target";
import { renderListHeader } from "./list-header";
import { renderLoadError } from "./modal-helpers";
import { projectSuiteRows, scenarioCountCell } from "./suite-rows";

/**
 * The deps the Test Suites body needs to load + render, independent of the leaf:
 * the services it reads, the run launcher, the create/navigate callbacks, and a
 * `refresh` it wires to the load-error retry (the standalone leaf passes
 * `this.live.schedule`, the later Test Hub its own section re-render).
 */
export interface SuiteDashboardBodyDeps {
  suiteService: SuiteService;
  // Shared run-launch surface (Wave B): the per-row Run button starts a
  // suite-scoped run through the same launcher the command palette uses.
  runLauncher: Pick<RunLauncher, "launch">;
  // Wave F insight: evaluates a suite's Tag Expression against every Feature's
  // scenarios so the "Scenarios" column shows the actual matched count.
  featureInsight: Pick<FeatureInsightService, "scenarioCounter">;
  onCreate: () => void;
  // WS-B4 deep-link port: a suite row opens by its note path (a Suite is not
  // id-resolvable), routed through the one unified navigator.
  navigate: (target: NavigationTarget) => void;
  /** Re-renders the body (load-error retry). */
  refresh: () => void;
}

/**
 * Renders the "Test Suites" body into `el` (host-agnostic, ADR-0031): the header
 * bar, then the per-suite table (name/id/tag expression/scenarios/run), or the
 * empty/error state. Builds entirely into the passed element via the shared
 * {@link renderListHeader}, so the standalone leaf and the (later) hub render it
 * identically. Loads its own data so the hub calls it the same way.
 */
export const renderSuiteDashboardBody = async (
  el: HTMLElement,
  deps: SuiteDashboardBodyDeps,
): Promise<void> => {
  renderListHeader(el, {
    headerCls: "e2e-test-hub-suite-header",
    title: "Test Suites",
    actionLabel: "New Test Suite",
    onAction: () => deps.onCreate(),
  });

  const result = await deps.suiteService.findAll();
  if (!result.ok) {
    // Recoverable dead-end: offer a retry instead of a bare terminal message.
    renderLoadError(
      el,
      `Could not load Test Suites: ${result.error.message}`,
      "Retry loading the Test Suites",
      () => deps.refresh(),
    );
    return;
  }

  const rows = projectSuiteRows(result.value);
  if (rows.length === 0) {
    el.createEl("p", { text: "No Test Suites yet. Create one to get started." });
    return;
  }

  const table = el.createEl("table", { cls: "e2e-test-hub-suite-table" });
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
  const counter = await deps.featureInsight.scenarioCounter();

  const body = table.createEl("tbody");
  for (const row of rows) {
    const tr = body.createEl("tr");
    const open = tr.createEl("td").createEl("button", {
      text: row.name,
      cls: "e2e-test-hub-link-button",
      attr: { "aria-label": `Open Test Suite ${row.name}` },
    });
    open.addEventListener("click", () => {
      deps.navigate(suiteTarget(row.path));
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
      attr: { "aria-label": `Run Test Suite ${row.name}` },
    });
    run.addEventListener("click", () => {
      void deps.runLauncher.launch({ scope: "suite", target: row.id });
    });
  }
};
