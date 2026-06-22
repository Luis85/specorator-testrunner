import type { RunHistoryService } from "../../application/services/run-history-service";
import { runTarget, type NavigationTarget } from "../navigation/navigation-target";
import {
  EVIDENCE_STATUS_FILTERS,
  projectEvidenceGroups,
  statusFilterLabel,
  type EvidenceMonthGroup,
  type EvidenceStatusFilter,
} from "./evidence-explorer-rows";
import { activateOnEnterOrSpace } from "./keyboard-activation";
import { renderLoadError } from "./modal-helpers";

/**
 * The deps the Evidence body needs to load + render, independent of the leaf:
 * the history service it reads, the navigate callback, and a `refresh` it wires
 * to the load-error retry (the standalone leaf passes `this.live.schedule`, the
 * later Test Hub its own section re-render).
 */
export interface EvidenceExplorerBodyDeps {
  runHistory: RunHistoryService;
  navigate: (target: NavigationTarget) => void;
  /** Re-renders the body (load-error retry). */
  refresh: () => void;
}

/**
 * The two pieces of ephemeral view state the explorer remembers across renders,
 * passed IN so the body stays host-agnostic: the current status `filter` and
 * how far "Load older" has extended the page (`visibleLimit`). The host owns the
 * state; the body's controls call back through {@link EvidenceExplorerBodyState}.
 */
export interface EvidenceExplorerBodyState {
  filter: EvidenceStatusFilter;
  visibleLimit: number;
  /** A filter change: the host stores it and re-renders. */
  onFilterChange: (filter: EvidenceStatusFilter) => void;
  /** "Load older runs": the host extends `visibleLimit` and re-renders. */
  onLoadOlder: () => void;
}

/**
 * Renders the Evidence Explorer body into `el` (host-agnostic, ADR-0031): the
 * `<h2>`, the status filter, the month-grouped run tables, and the "Load older"
 * affordance, or the empty/error state. The view's ephemeral filter/limit state
 * is passed IN via {@link EvidenceExplorerBodyState} so the body owns no `this`,
 * letting the standalone leaf and the (later) hub render it identically. Loads
 * its own data so the hub calls it the same way.
 */
export const renderEvidenceExplorerBody = async (
  el: HTMLElement,
  deps: EvidenceExplorerBodyDeps,
  state: EvidenceExplorerBodyState,
): Promise<void> => {
  el.empty();
  el.createEl("h2", { text: "Evidence Explorer" });

  const result = await deps.runHistory.list({ offset: 0, limit: state.visibleLimit });
  if (!result.ok) {
    // Recoverable dead-end: offer a retry instead of a bare terminal message.
    renderLoadError(
      el,
      `Could not load run history: ${result.error.message}`,
      "Retry loading the run history",
      () => deps.refresh(),
    );
    return;
  }
  const { entries, hasMore } = result.value;
  // entries is the page from offset 0, so empty means no history at all.
  if (entries.length === 0) {
    el.createEl("p", { text: "No Test Runs yet. Run a Test Suite to see results here." });
    return;
  }

  renderFilter(el, state);

  const groups = projectEvidenceGroups(entries, state.filter);
  if (groups.length === 0) {
    el.createEl("p", {
      text: `No loaded runs with status "${state.filter}". Load older runs or change the filter.`,
    });
  }
  for (const group of groups) renderGroup(el, group, deps);

  if (hasMore) {
    const button = el.createEl("button", {
      text: "Load older runs",
      cls: "e2e-test-hub-load-older",
      attr: { "aria-label": "Load older runs" },
    });
    button.addEventListener("click", () => {
      state.onLoadOlder();
    });
  }
};

const renderFilter = (el: HTMLElement, state: EvidenceExplorerBodyState): void => {
  const bar = el.createDiv({ cls: "e2e-test-hub-evidence-toolbar" });
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
  select.value = state.filter;
  select.addEventListener("change", () => {
    // The value space is exactly EVIDENCE_STATUS_FILTERS (options above).
    state.onFilterChange(select.value as EvidenceStatusFilter);
  });
};

const renderGroup = (
  el: HTMLElement,
  group: EvidenceMonthGroup,
  deps: EvidenceExplorerBodyDeps,
): void => {
  el.createEl("h3", { text: group.heading });
  const table = el.createEl("table", { cls: "e2e-test-hub-runs-table" });
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
      // WS-B4: navigate by run id (the row IS a run); the port resolves it to
      // the evidence note the run produced.
      deps.navigate(runTarget(row.runId));
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
};
