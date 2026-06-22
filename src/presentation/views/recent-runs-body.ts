import type { TraceabilityService } from "../../application/services/traceability-service";
import type { VaultPath } from "../../domain/value-objects/identifiers";
import { projectDashboard } from "./dashboard-rows";
import { renderRecentRuns } from "./dashboard-recent-runs";
import { renderLoadError } from "./modal-helpers";

/**
 * The deps the Overview "Recent runs" body needs, independent of the leaf (E1
 * PR2 body split): the traceability snapshot it projects the rows from, the
 * evidence openers a row links to, and a `refresh` it wires to the load-error
 * retry (the hub passes its active-panel re-render). Loads its own snapshot —
 * consistent with every other in-hub body (ADR-0031), so the recent-runs section
 * is independent of the hero body above it.
 */
export interface RecentRunsBodyDeps {
  traceabilityService: Pick<TraceabilityService, "snapshot">;
  /** Wave C §3: open the Evidence note a recent-run row links to. */
  openEvidence: (path: VaultPath) => void | Promise<void>;
  /** EPIC-008: the Recent Runs header links into the full history explorer. */
  openEvidenceExplorer: () => void | Promise<void>;
  /** Re-renders the body (load-error retry). */
  refresh: () => void;
}

/**
 * Renders the Overview "Recent runs" body into `el` (host-agnostic, ADR-0031):
 * loads the non-emitting snapshot, then the actionable run table via the shared
 * {@link renderRecentRuns} — or a retryable load-error. Lifted verbatim out of
 * the legacy combined dashboard body so the funnel/hero hero body and the
 * recent-runs table no longer share one render pass (the empty-div hack the hub
 * carried is retired). Loads its own data so the hub calls it the same way.
 */
export const renderRecentRunsBody = async (
  el: HTMLElement,
  deps: RecentRunsBodyDeps,
): Promise<void> => {
  el.empty();

  const result = await deps.traceabilityService.snapshot();
  if (!result.ok) {
    renderLoadError(
      el,
      `Could not load recent runs: ${result.error.message}`,
      "Retry loading recent runs",
      () => deps.refresh(),
    );
    return;
  }

  const view = projectDashboard(result.value);
  renderRecentRuns(el, view.recentRuns, {
    openEvidence: deps.openEvidence,
    openEvidenceExplorer: deps.openEvidenceExplorer,
  });
};
