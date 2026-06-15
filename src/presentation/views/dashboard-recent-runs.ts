import type { VaultPath } from "../../domain/value-objects/identifiers";
import { activateOnEnterOrSpace } from "./keyboard-activation";
import { NO_EVIDENCE_TOOLTIP, type RecentRunRow } from "./dashboard-rows";

/**
 * Renders the dashboard's "Recent runs" section (US-038): the heading, the
 * empty-state line, the "View all runs" link into the Evidence Explorer
 * (EPIC-008), and the actionable run table (Wave C §3). Extracted from the view
 * so the table-building DOM stays out of the render() orchestration.
 */
export const renderRecentRuns = (
  container: HTMLElement,
  recentRuns: readonly RecentRunRow[],
  deps: {
    openEvidence: (path: VaultPath) => void | Promise<void>;
    openEvidenceExplorer: () => void | Promise<void>;
  },
): void => {
  container.createEl("h3", { text: "Recent runs" });
  if (recentRuns.length === 0) {
    container.createEl("p", { text: "No Test Runs yet. Run a Test Suite to see results here." });
    return;
  }
  // EPIC-008: only rendered once at least one run exists — an empty history
  // has nothing to "view all" of.
  container
    .createEl("button", {
      text: "View all runs",
      cls: "e2e-test-hub-doc-button",
      attr: { "aria-label": "Open the Evidence Explorer with the full run history" },
    })
    .addEventListener("click", () => {
      void deps.openEvidenceExplorer();
    });

  const table = container.createEl("table", { cls: "e2e-test-hub-runs-table" });
  const headRow = table.createEl("thead").createEl("tr");
  for (const label of ["Run", "Status", "Date"]) {
    // scope="col" ties each header to its column for screen-reader tables.
    headRow.createEl("th", { text: label, attr: { scope: "col" } });
  }
  const body = table.createEl("tbody");
  for (const run of recentRuns) renderRunRow(body, run, deps.openEvidence);
};

/**
 * One recent-run table row (Wave C §3). A navigable row's Run ID cell is a
 * link-button opening its Evidence note; the whole-row click is a sighted-user
 * convenience. Rows without evidence (e.g. errored runs) are inert with an
 * explanatory tooltip. The row carries no link role/tabindex — that would
 * destroy its table semantics for screen readers.
 */
const renderRunRow = (
  body: HTMLElement,
  run: RecentRunRow,
  openEvidence: (path: VaultPath) => void | Promise<void>,
): void => {
  const tr = body.createEl("tr", {
    cls: run.navigable ? "e2e-test-hub-run-row is-navigable" : "e2e-test-hub-run-row",
  });
  if (run.navigable && run.evidencePath !== undefined) {
    const path = run.evidencePath;
    const open = (): void => {
      void openEvidence(path);
    };
    // Same pattern as the Use Cases table's id link-button.
    const link = tr.createEl("td").createEl("button", {
      text: run.runId,
      cls: "e2e-test-hub-link-button",
      attr: { "aria-label": run.ariaLabel },
    });
    link.addEventListener("click", (event) => {
      // The row's convenience click listener below would fire open() again.
      event.stopPropagation();
      open();
    });
    activateOnEnterOrSpace(link, open);
    tr.addEventListener("click", open);
  } else {
    tr.createEl("td", { text: run.runId });
    tr.setAttr("title", NO_EVIDENCE_TOOLTIP);
  }
  // data-status mirrors the raw TestRunStatus so styles.css can tint the cell
  // via Obsidian theme vars. The status TEXT stays, so the outcome is legible
  // without colour (colour-blind / high-contrast safe).
  tr.createEl("td", {
    text: run.status,
    cls: "e2e-test-hub-run-status",
    attr: { "data-status": run.status },
  });
  tr.createEl("td", { text: run.date });
};
