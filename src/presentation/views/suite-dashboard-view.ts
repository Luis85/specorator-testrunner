import type { WorkspaceLeaf } from "obsidian";
import type { FeatureInsightService } from "../../application/services/feature-insight-service";
import type { SuiteService } from "../../application/services/suite-service";
import type { DomainEventType } from "../../domain/events/domain-event";
import type { EventBus } from "../../shared/event-bus/event-bus";
import type { RunLauncher } from "../run/run-launcher";
import { type NavigationTarget } from "../navigation/navigation-target";
import { LiveDashboardView } from "./live-dashboard-view";
import { renderSuiteDashboardBody } from "./suite-dashboard-body";

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
  eventBus: EventBus;
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
}

/**
 * Live "Test Suites" panel (US-024/US-025, UC-008). Lists each suite's Name,
 * ID, and Tag Expression (membership is by tag per AD-4), refreshing on suite
 * events. The default Smoke/Regression suites seeded by `createDefaults` surface
 * here via `findAll`.
 */
export class SuiteDashboardView extends LiveDashboardView {
  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: SuiteDashboardDeps,
  ) {
    super(leaf, deps.eventBus, REFRESH_ON);
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

  protected async render(): Promise<void> {
    // Thin caller: the body builds entirely into this leaf's `contentEl` via the
    // host-agnostic renderer, so the standalone leaf and the (later) Test Hub
    // body render identically (ADR-0031).
    await renderSuiteDashboardBody(this.contentEl, {
      suiteService: this.deps.suiteService,
      runLauncher: this.deps.runLauncher,
      featureInsight: this.deps.featureInsight,
      onCreate: this.deps.onCreate,
      navigate: this.deps.navigate,
      refresh: () => void this.live.schedule(),
    });
  }
}
