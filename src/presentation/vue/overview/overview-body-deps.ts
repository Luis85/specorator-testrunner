import type { ExecutionLogService } from "../../../application/services/execution-log-service";
import type { TraceabilityService } from "../../../application/services/traceability-service";
import type { VaultPath } from "../../../domain/value-objects/identifiers";
import type { EventBus } from "../../../shared/event-bus/event-bus";
import type { DashboardNavTarget } from "../../views/dashboard-rows";

/**
 * The Overview hero body's deps (ADR-0033 Phase 3): the health hero (pass-rate
 * ring + verdict + the durable execution log's last-run line), the two primary
 * actions, and the KPI funnel. Hub-only (the Overview section has no standalone
 * leaf); the hub composes this from the composition-root slice + its own
 * `navigate` (KPI-tile → Build with the funnel filter) + the bus. `refresh` is
 * internal (a useEventBus binding).
 */
export interface HeroBodyDeps {
  traceabilityService: Pick<TraceabilityService, "snapshot">;
  /** The durable execution log read path (E1): the honest last-run verdict. */
  executionLogService: Pick<ExecutionLogService, "latest">;
  /** A REAL initialization signal (Wave C §1): is the Test Hub vault scaffolded? */
  isInitialized: () => Promise<boolean>;
  openWizard: () => void;
  openCreateUseCase: () => void;
  runAll: () => void | Promise<void>;
  /** A KPI funnel tile drills into the Use Cases explorer carrying its filter. */
  navigate: (target: DashboardNavTarget) => void | Promise<void>;
  eventBus: EventBus;
}

/**
 * The Overview "Recent runs" body's deps (ADR-0033 Phase 3): the snapshot it
 * projects rows from, the evidence openers a row links to, and the bus. Hub-only;
 * `refresh` is internal.
 */
export interface RecentRunsBodyDeps {
  traceabilityService: Pick<TraceabilityService, "snapshot">;
  /** The same real init signal as the hero — gates a pre-init empty Recent Runs. */
  isInitialized: () => Promise<boolean>;
  /** Open the Evidence note a recent-run row links to. */
  openEvidence: (path: VaultPath) => void | Promise<void>;
  /** The Recent Runs header links into the full history explorer (EPIC-008). */
  openEvidenceExplorer: () => void | Promise<void>;
  eventBus: EventBus;
}
