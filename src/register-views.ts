import type { App, Plugin } from "obsidian";

import type { TestHubSettings } from "./domain/settings/settings";
import type { VaultPath } from "./domain/value-objects/identifiers";
import type { ObsidianVaultAdapter } from "./infrastructure/obsidian/obsidian-vault-adapter";
import type { ObsidianWorkspaceAdapter } from "./infrastructure/obsidian/obsidian-workspace-adapter";
import type { EventBus } from "./shared/event-bus/event-bus";
import type { ConsoleLogger } from "./shared/logging/logger";
import type { ComposedServices } from "./compose-services";
import type { NavigationTarget } from "./presentation/navigation/navigation-target";
import type { DashboardDocumentType } from "./presentation/views/dashboard-view";
import { DASHBOARD_VIEW_TYPE } from "./presentation/views/dashboard-view";
import {
  EVIDENCE_EXPLORER_VIEW_TYPE,
  EvidenceExplorerView,
} from "./presentation/views/evidence-explorer-view";
import { DashboardAliasView, HUB_VIEW_TYPE, HubView } from "./presentation/views/hub-view";
import {
  FEATURE_EDITOR_VIEW_TYPE,
  FeatureEditorView,
} from "./presentation/views/feature-editor-view";
import { generateFeatureForUseCase } from "./presentation/views/generate-feature-modal";
import { GUIDED_TOUR_VIEW_TYPE, GuidedTourView } from "./presentation/views/guided-tour-view";
import { dispatchTourAction, type TourActionFlows } from "./presentation/views/tour-actions";
import { PENDING_STEPS_VIEW_TYPE, PendingStepsView } from "./presentation/views/pending-steps-view";
import type { PendingStepsTarget } from "./presentation/views/pending-steps-rows";
import { PRD_VIEW_TYPE, PrdExplorerView } from "./presentation/views/prd-explorer-view";
import {
  STORY_MAP_VIEW_TYPE,
  StoryMapExplorerView,
} from "./presentation/views/story-map-explorer-view";
import {
  STORY_MAP_BOARD_VIEW_TYPE,
  StoryMapBoardView,
} from "./presentation/views/story-map-board-view";
import { StoryMapSettingsModal } from "./presentation/views/story-map-settings-modal";
import { SUITE_VIEW_TYPE, SuiteDashboardView } from "./presentation/views/suite-dashboard-view";
import { TEST_CONSOLE_VIEW_TYPE, TestConsoleView } from "./presentation/views/test-console-view";
import {
  USE_CASE_VIEW_TYPE,
  UseCaseDashboardView,
} from "./presentation/views/use-case-dashboard-view";
import {
  USE_CASE_DETAIL_VIEW_TYPE,
  UseCaseDetailView,
} from "./presentation/views/use-case-detail-view";

/**
 * Everything the registered views' factories close over: the composed service
 * graph, the Obsidian adapters/bus, the live-settings reader, and the
 * open-a-modal / switch-environment callbacks the composition root owns (a view
 * never re-implements those flows — Wave B/C altitude requirement).
 */
export interface ViewWiringDeps {
  app: App;
  eventBus: EventBus;
  workspace: ObsidianWorkspaceAdapter;
  vault: ObsidianVaultAdapter;
  logger: ConsoleLogger;
  services: ComposedServices;
  getSettings: () => TestHubSettings;
  openCreateUseCase: () => void;
  openUseCaseDetail: (useCaseId: string) => void;
  /** WS-B1 / ADR-0031: open (or reveal) the single Test Hub home leaf. */
  openHub: () => void | Promise<void>;
  /**
   * WS-A4/B4 deep-link port: open whatever node `target` names — PRD/UC/Story
   * Map by id, Feature/Suite/Evidence by path, or a Run by id.
   */
  navigate: (target: NavigationTarget) => void;
  openCreateSuite: () => void;
  /**
   * WS1/C2: open (or re-target) the Pending Steps sidebar companion at a target
   * (use-case / feature / vault). The entry points that call this — the Feature
   * row's Steps button, the loop rail, the Test Console hint, the command — are
   * wired in a follow-up; this leaf + opener make it reachable.
   */
  openPendingSteps: (target: PendingStepsTarget) => void;
  openPrdBuilder: (parentPrdId?: string) => void;
  openStoryMapBuilder: () => void;
  openStoryMapBoard: (storyMapId: string) => void;
  openWizard: () => void;
  openDocumentation: (documentType?: DashboardDocumentType | "index") => void | Promise<void>;
  generateDocumentation: () => void | Promise<void>;
  openEvidence: (path: VaultPath) => void | Promise<void>;
  switchEnvironment: (name: string) => Promise<void>;
  openLatestEvidence: () => void;
  generateCiWorkflow: () => Promise<void>;
}

/**
 * Registers the plugin's Obsidian views and the `.feature` editor extension
 * (moved out of `main.ts` onload to keep the composition root under the size
 * budget). Each view is thin: its factory wires the narrow service slices +
 * composition-root callbacks the view's deps contract names.
 */
export const registerViews = (plugin: Plugin, deps: ViewWiringDeps): void => {
  const { app, eventBus, workspace, vault, services: s } = deps;

  // The tour action-button flows, built ONCE and shared by the sidebar
  // GuidedTourView and the hub's docked onboarding rail (both dispatch through
  // the shared dispatchTourAction) — each flow is an existing action, never
  // re-implemented here (spec 2026-06-11).
  const tourActionFlows: TourActionFlows = {
    runDemo: () => s.runLauncher.launch({ scope: "demo", target: "demo" }),
    openCreateUseCase: () => deps.openCreateUseCase(),
    openUseCases: () => void workspace.openView(USE_CASE_VIEW_TYPE),
    openPendingSteps: () => deps.openPendingSteps({ kind: "vault" }),
    openCreateSuite: () => deps.openCreateSuite(),
    openSuites: () => void workspace.openView(SUITE_VIEW_TYPE),
    openLatestEvidence: () => deps.openLatestEvidence(),
    generateCiWorkflow: () => deps.generateCiWorkflow(),
  };

  plugin.registerView(
    USE_CASE_VIEW_TYPE,
    (leaf) =>
      new UseCaseDashboardView(leaf, {
        // US-057: the Automation column derives from per-scenario history via
        // traceability.deriveAll(), not the stale frontmatter automationStatus.
        traceability: s.traceabilityService,
        specificationService: s.specificationService,
        workspace,
        eventBus,
        runLauncher: s.runLauncher,
        onCreate: () => deps.openCreateUseCase(),
        // Wave D: the id column opens the Use Case detail view (authoring &
        // testing surface); the per-row "Note" link keeps raw note access.
        onOpenDetail: (useCaseId) => deps.openUseCaseDetail(useCaseId),
      }),
  );
  // Wave D: the Use Case detail view — the UI-driven authoring & testing surface
  // for one Use Case. The generate-Feature opener reuses the command palette's
  // slug-prompt flow rather than forking the generation logic.
  plugin.registerView(
    USE_CASE_DETAIL_VIEW_TYPE,
    (leaf) =>
      new UseCaseDetailView(leaf, {
        // US-057: the header's Automation status derives from per-scenario
        // history via traceability.deriveById(), not the frontmatter value.
        traceability: s.traceabilityService,
        useCaseService: s.useCaseService,
        prdService: s.prdService,
        storyMapService: s.storyMapService,
        specificationService: s.specificationService,
        featureInsight: s.featureInsightService,
        workspace,
        eventBus,
        runLauncher: s.runLauncher,
        openCreateSuite: () => deps.openCreateSuite(),
        openPendingSteps: (target) => deps.openPendingSteps(target),
        navigate: (target) => deps.navigate(target),
        openGenerateFeature: (useCase, onGenerated) =>
          generateFeatureForUseCase(
            app,
            {
              useCaseService: s.useCaseService,
              specificationService: s.specificationService,
              workspace,
            },
            useCase,
            () => onGenerated(),
          ),
      }),
  );
  plugin.registerView(
    SUITE_VIEW_TYPE,
    (leaf) =>
      new SuiteDashboardView(leaf, {
        suiteService: s.suiteService,
        runLauncher: s.runLauncher,
        featureInsight: s.featureInsightService,
        onCreate: () => deps.openCreateSuite(),
        // WS-B4: a suite row opens through the unified deep-link port (a Suite is
        // addressed by its note path), not an ad-hoc openOrNotice.
        navigate: (target) => deps.navigate(target),
        // The body self-subscribes via useEventBus (ADR-0033 Phase 3).
        eventBus,
      }),
  );
  plugin.registerView(
    PRD_VIEW_TYPE,
    (leaf) =>
      new PrdExplorerView(leaf, {
        prdService: s.prdService,
        useCaseService: s.useCaseService,
        eventBus,
        openPrdBuilder: (parentPrdId) => deps.openPrdBuilder(parentPrdId),
        navigate: (target) => deps.navigate(target),
      }),
  );
  plugin.registerView(
    STORY_MAP_VIEW_TYPE,
    (leaf) =>
      new StoryMapExplorerView(leaf, {
        storyMapService: s.storyMapService,
        workspace,
        eventBus,
        openStoryMapBuilder: () => deps.openStoryMapBuilder(),
        openMapSettings: (map) =>
          new StoryMapSettingsModal(app, map, { storyMapService: s.storyMapService }).open(),
        openStoryMapBoard: (id) => deps.openStoryMapBoard(id),
      }),
  );
  plugin.registerView(
    STORY_MAP_BOARD_VIEW_TYPE,
    (leaf) =>
      new StoryMapBoardView(leaf, {
        storyMapService: s.storyMapService,
        useCaseService: s.useCaseService,
        eventBus,
        navigate: (target) => deps.navigate(target),
      }),
  );
  plugin.registerView(
    TEST_CONSOLE_VIEW_TYPE,
    (leaf) =>
      new TestConsoleView(leaf, {
        eventBus,
        runLauncher: s.runLauncher,
        // Narrow read-only slice: the toolbar checks for an active run on open
        // and reads the last run's scope to power Re-run.
        activeRunId: () => s.testExecutionService.activeRunId(),
        activeRunStartedAt: () => s.testExecutionService.activeRunStartedAt(),
        lastRun: () => s.testExecutionService.lastRun(),
        // Wave G §1: the "Open evidence" button. The coordinator owns the
        // post-run evidence flow, so it is the cleanest synchronous source for
        // "the last generated evidence note" when the console opens.
        lastEvidence: () => s.postRunCoordinator.lastEvidence(),
        openEvidence: (path) => deps.openEvidence(path),
        openPendingSteps: (target) => deps.openPendingSteps(target),
      }),
  );
  // WS1/C2: the Pending Steps right-sidebar companion — undefined-step listing,
  // stub generation with the read-only viewer, and the system-editor jump. A
  // targeted leaf (use-case / feature / vault); its narrow deps are the
  // detect/generate services, the Use Case lookup (use-case target → Features),
  // the vault fs (read-only stub viewer), and the workspace's system-editor jump.
  plugin.registerView(
    PENDING_STEPS_VIEW_TYPE,
    (leaf) =>
      new PendingStepsView(leaf, {
        specificationService: s.specificationService,
        stepDefinitionService: s.stepDefinitionService,
        useCaseService: s.useCaseService,
        fs: vault,
        workspace,
        eventBus,
      }),
  );
  // WS-B1 / ADR-0031: the Test Hub home shell — the SINGLE leaf hosting all the
  // demoted list surfaces in a left-rail section switcher. Its deps are the union
  // of the hosted bodies' deps: the overview dashboard (the superset, with the
  // same create/run/open/switch-environment callbacks the standalone dashboard
  // used), plus each explorer body's own service slices. Every callback reuses an
  // EXISTING helper — no run/create/navigate logic is duplicated here.
  plugin.registerView(
    HUB_VIEW_TYPE,
    (leaf) =>
      new HubView(leaf, {
        app,
        eventBus,
        workspace,
        // E1 PR2: the Overview hero body — health hero (pass-rate ring + verdict
        // + the durable execution log's last-run line) + primary actions + KPI
        // funnel. The `navigate`/`refresh` the hub owns are supplied in renderBody.
        hero: {
          traceabilityService: s.traceabilityService,
          executionLogService: s.executionLogService,
          // Real initialization signal: the Use Cases folder the snapshot reads
          // exists once the wizard has scaffolded the vault (a fresh vault lists
          // it as ok([]), so snapshot success can't distinguish "not set up").
          isInitialized: () => vault.exists(deps.getSettings().paths.useCasesPath),
          openWizard: () => deps.openWizard(),
          openCreateUseCase: () => deps.openCreateUseCase(),
          runAll: () => s.runLauncher.launch({ scope: "all", target: "all" }),
        },
        // E1 PR2: the Overview recent-runs body — its own snapshot-loaded run
        // table. `openEvidenceExplorer`/`refresh` the hub owns are supplied in
        // renderBody (it switches to the Review section).
        recentRuns: {
          traceabilityService: s.traceabilityService,
          // Same real init signal as the hero, so a fresh vault's Overview is
          // just the Initialize CTA — not an empty Recent Runs under it.
          isInitialized: () => vault.exists(deps.getSettings().paths.useCasesPath),
          openEvidence: (path) => deps.openEvidence(path),
        },
        // The Plan section's PRDs body — the Vue-native PrdExplorerBody (ADR-0033
        // Phase 3). It self-loads and subscribes to the bus, so the hub supplies
        // its deps MINUS `eventBus` (HubSection injects the hub's bus).
        prds: {
          prdService: s.prdService,
          useCaseService: s.useCaseService,
          openPrdBuilder: (parentPrdId) => deps.openPrdBuilder(parentPrdId),
          navigate: (target) => deps.navigate(target),
        },
        // The Plan section's Story Maps body — the Vue-native StoryMapExplorerBody
        // (ADR-0033 Phase 3). It self-loads and subscribes to the bus, so the hub
        // supplies its deps MINUS `eventBus` (HubSection injects the hub's bus).
        storyMaps: {
          storyMapService: s.storyMapService,
          workspace,
          openStoryMapBuilder: () => deps.openStoryMapBuilder(),
          openMapSettings: (map) =>
            new StoryMapSettingsModal(app, map, { storyMapService: s.storyMapService }).open(),
          openStoryMapBoard: (id) => deps.openStoryMapBoard(id),
        },
        // The Build section's Use Cases body — the Vue-native UseCaseDashboardBody
        // (ADR-0033 Phase 3). It self-loads and subscribes to the bus, so the hub
        // supplies its deps MINUS `eventBus` (HubSection injects the hub's bus);
        // the KPI funnel filter is a reactive prop from the hub store, not a dep.
        useCases: {
          traceability: s.traceabilityService,
          specificationService: s.specificationService,
          workspace,
          runLauncher: s.runLauncher,
          onCreate: () => deps.openCreateUseCase(),
          onOpenDetail: (useCaseId) => deps.openUseCaseDetail(useCaseId),
        },
        // The Run section's Test Suites body — the Vue-native SuiteDashboardBody
        // (ADR-0033 Phase 3). It self-loads and subscribes to the bus, so the hub
        // supplies its deps MINUS `eventBus` (HubSection injects the hub's bus).
        suites: {
          suiteService: s.suiteService,
          runLauncher: s.runLauncher,
          featureInsight: s.featureInsightService,
          onCreate: () => deps.openCreateSuite(),
          navigate: (target) => deps.navigate(target),
        },
        // The Review section's Evidence body — the Vue-native EvidenceExplorerBody
        // (ADR-0033 Phase 3). It self-loads and subscribes to the bus, so the hub
        // supplies its deps MINUS `eventBus` (HubSection injects the hub's bus);
        // filter/limit are reactive props from the hub store, not deps.
        evidence: {
          runHistory: s.runHistoryService,
          navigate: (target) => deps.navigate(target),
        },
        // B2 PR3: the docked onboarding rail. Reuses the hero's real init signal
        // and the SAME tour-action flows as the GuidedTourView (dispatched through
        // the shared dispatchTourAction). ucCount maps a failed snapshot read to
        // `null` so the rail shows its retryable load error rather than projecting
        // the failure as an empty hub (codex P2). `collapsed`/`onToggleCollapsed`/
        // `refresh` the hub supplies.
        onboarding: {
          isInitialized: () => vault.exists(deps.getSettings().paths.useCasesPath),
          ucCount: async () => {
            const snapshot = await s.traceabilityService.snapshot();
            return snapshot.ok ? snapshot.value.totalUseCases : null;
          },
          tour: s.guidedTourService,
          dispatchTourAction: (id) => dispatchTourAction(id, tourActionFlows),
          openWizard: () => deps.openWizard(),
          openCreateUseCase: () => deps.openCreateUseCase(),
          startTour: () => void s.guidedTourService.restart(),
        },
      }),
  );
  // ADR-0031 alias migration: the legacy dashboard view type stays registered so
  // a persisted layout never orphans, but mounts a thin redirect that opens the
  // hub and detaches itself — a restored dashboard leaf lands on the hub.
  plugin.registerView(
    DASHBOARD_VIEW_TYPE,
    (leaf) => new DashboardAliasView(leaf, () => deps.openHub()),
  );
  plugin.registerView(
    EVIDENCE_EXPLORER_VIEW_TYPE,
    (leaf) =>
      new EvidenceExplorerView(leaf, {
        runHistory: s.runHistoryService,
        eventBus,
        // WS-B4: a run row opens through the unified deep-link port by run id
        // (the port resolves the run to the evidence note it produced).
        navigate: (target) => deps.navigate(target),
      }),
  );
  plugin.registerView(
    GUIDED_TOUR_VIEW_TYPE,
    (leaf) =>
      new GuidedTourView(leaf, {
        tour: s.guidedTourService,
        eventBus,
        ...tourActionFlows,
      }),
  );

  // The `.feature` file handler renders the Feature Editor. registerExtensions
  // throws if another plugin already claimed the extension — degrade with a
  // warning instead of failing the whole onload.
  plugin.registerView(
    FEATURE_EDITOR_VIEW_TYPE,
    (leaf) =>
      new FeatureEditorView(leaf, {
        specifications: s.specificationService,
        featureInsight: s.featureInsightService,
        // WS-C1: ▶ Run (this feature) launches through the shared launcher.
        runLauncher: s.runLauncher,
      }),
  );
  try {
    plugin.registerExtensions(["feature"], FEATURE_EDITOR_VIEW_TYPE);
  } catch (error) {
    deps.logger.warn("Could not register the .feature extension", {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
};
