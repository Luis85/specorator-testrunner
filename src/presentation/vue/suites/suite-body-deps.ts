import type { FeatureInsightService } from "../../../application/services/feature-insight-service";
import type { SuiteService } from "../../../application/services/suite-service";
import type { EventBus } from "../../../shared/event-bus/event-bus";
import type { NavigationTarget } from "../../navigation/navigation-target";
import type { RunLauncher } from "../../run/run-launcher";

/**
 * Everything {@link SuiteDashboardBody} needs to load, render, and stay live —
 * the services it reads, the shared run launcher, the create/navigate callbacks,
 * and the bus it subscribes its own refresh to (ADR-0033). The standalone Test
 * Suites leaf and the hub's Run section both construct this and pass it as a prop.
 */
export interface SuiteBodyDeps {
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
  eventBus: EventBus;
}
