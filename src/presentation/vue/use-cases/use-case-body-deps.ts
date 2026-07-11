import type { WorkspacePort } from "../../../application/ports/workspace-port";
import type { SpecificationService } from "../../../application/services/specification-service";
import type { TraceabilityService } from "../../../application/services/traceability-service";
import type { EventBus } from "../../../shared/event-bus/event-bus";
import type { RunLauncher } from "../../run/run-launcher";

/**
 * Everything {@link UseCaseDashboardBody} needs to load, render, and stay live —
 * the services it reads, the workspace port for note access, the run launcher,
 * the create/open callbacks, and the bus it subscribes its own refresh to
 * (ADR-0033). The standalone Use Cases leaf and the hub's Build section both
 * construct this and pass it as a prop.
 *
 * The KPI funnel `filter` is NOT here: it is hub-owned ephemeral state (the Pinia
 * hub store), passed as a SEPARATE reactive prop so a filter change re-filters
 * the already-loaded rows without a reload. The standalone leaf omits it (fixed
 * `"all"`).
 */
export interface UseCaseBodyDeps {
  // Use Cases with history-derived automationStatus (US-057), so the Automation
  // column matches the dashboard KPIs rather than the stale frontmatter value.
  traceability: Pick<TraceabilityService, "deriveAll">;
  // Wave F insight: the Feature listing powers the per-Use-Case "Features" column.
  specificationService: Pick<SpecificationService, "listFeatures">;
  workspace: WorkspacePort;
  // Shared run-launch surface (Wave B): the per-row Run button starts a
  // use-case-scoped run through the same launcher the command palette uses.
  runLauncher: Pick<RunLauncher, "launch">;
  onCreate: () => void;
  // Wave D: clicking a Use Case id opens its detail view; raw note access stays
  // available via a separate per-row "Note" link.
  onOpenDetail: (useCaseId: string) => void;
  eventBus: EventBus;
}
