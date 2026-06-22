import { Notice, Plugin } from "obsidian";

import type { DocumentationGenerationService } from "./application/services/documentation-generation-service";
import type { EnvironmentValidationService } from "./application/services/environment-validation-service";
import type { InitializationService } from "./application/services/initialization-service";
import type { MaintenanceService } from "./application/services/maintenance-service";
import type { PipelineGenerationService } from "./application/services/pipeline-generation-service";
import type { FeatureInsightService } from "./application/services/feature-insight-service";
import type { PostRunCoordinator } from "./application/services/post-run-coordinator";
import type { GuidedTourService } from "./application/services/guided-tour-service";
import {
  DefaultSettingsService,
  type SettingsService,
} from "./application/services/settings-service";
import type { SpecificationService } from "./application/services/specification-service";
import type { StepDefinitionService } from "./application/services/step-definition-service";
import type { SuiteService } from "./application/services/suite-service";
import type { TestExecutionService } from "./application/services/test-execution-service";
import type { UseCaseService } from "./application/services/use-case-service";
import type { PrdService } from "./application/services/prd-service";
import type { StoryMapService } from "./application/services/story-map-service";
import type { DefaultRunnerInstallationService } from "./application/services/runner-installation-service";
import { DefaultPathSafetyPolicy } from "./domain/policies/path-safety-policy";
import type { VaultPath } from "./domain/value-objects/identifiers";
import {
  collectCredentialValues,
  DEFAULT_SETTINGS,
  type TestHubSettings,
} from "./domain/settings/settings";
import { ObsidianDataStore } from "./infrastructure/obsidian/obsidian-data-store";
import { ObsidianVaultAdapter } from "./infrastructure/obsidian/obsidian-vault-adapter";
import { ObsidianWorkspaceAdapter } from "./infrastructure/obsidian/obsidian-workspace-adapter";
import type { NodeChildProcessRunner } from "./infrastructure/runner/node-child-process-runner";
import { composeServices } from "./compose-services";
import { registerViews } from "./register-views";
import {
  registerCommands,
  type RegisteredCommandHelpers,
} from "./presentation/commands/register-commands";
import type { RunLauncher } from "./presentation/run/run-launcher";
import { TestHubSettingTab, type SettingsHost } from "./presentation/settings/settings-tab";
import { CreateSuiteModal } from "./presentation/views/create-suite-modal";
import { CreateUseCaseModal } from "./presentation/views/create-use-case-modal";
import { InitializationWizardModal } from "./presentation/views/initialization-wizard-modal";
import { PrdBuilderModal } from "./presentation/views/prd-builder-modal";
import { PRD_VIEW_TYPE } from "./presentation/views/prd-explorer-view";
import { StoryMapBuilderModal } from "./presentation/views/story-map-builder-modal";
import { STORY_MAP_VIEW_TYPE } from "./presentation/views/story-map-explorer-view";
import { TEST_CONSOLE_VIEW_TYPE } from "./presentation/views/test-console-view";
import { USE_CASE_DETAIL_VIEW_TYPE } from "./presentation/views/use-case-detail-view";
import { STORY_MAP_BOARD_VIEW_TYPE } from "./presentation/views/story-map-board-view";
import { HUB_VIEW_TYPE } from "./presentation/views/hub-view";
import { openOrNotice } from "./presentation/views/modal-helpers";
import { ArtifactNavigator } from "./presentation/navigation/artifact-navigator";
import type { ArtifactNavigationPort } from "./presentation/navigation/artifact-navigation-port";
import type { NavigationTarget } from "./presentation/navigation/navigation-target";
import { DASHBOARD_VIEW_TYPE } from "./presentation/views/dashboard-view";
import { GUIDED_TOUR_VIEW_TYPE } from "./presentation/views/guided-tour-view";
import { InMemoryEventBus, type EventBus } from "./shared/event-bus/event-bus";
import { ConsoleLogger } from "./shared/logging/logger";
import type { Result } from "./shared/result/result";

/**
 * Composition root for the Specorator Testrunner plugin. Instantiates the layered
 * graph (Shared Kernel → Domain → Application → Infrastructure → Presentation)
 * and registers the Obsidian surfaces.
 */
export default class E2ETestHubPlugin extends Plugin implements SettingsHost {
  private hubSettings: TestHubSettings = DEFAULT_SETTINGS;
  private logger!: ConsoleLogger;
  private eventBus!: EventBus;
  private hubSettingsService!: SettingsService;
  private initializationService!: InitializationService;
  private validationService!: EnvironmentValidationService;
  private maintenanceService!: MaintenanceService;
  private documentationService!: DocumentationGenerationService;
  private pipelineService!: PipelineGenerationService;
  private useCaseService!: UseCaseService;
  private prdService!: PrdService;
  private storyMapService!: StoryMapService;
  private specificationService!: SpecificationService;
  // Wave F insight: read-only scenario/tag queries (Tag Expression match
  // counts, per-Feature health) shared by the suites explorer, the
  // CreateSuiteModal preview, and the Use Case detail view.
  private featureInsightService!: FeatureInsightService;
  private stepDefinitionService!: StepDefinitionService;
  private suiteService!: SuiteService;
  private testExecutionService!: TestExecutionService;
  // Single owner of "start a run / cancel the active run" for every UI surface
  // (command palette, explorer Run buttons, Test Console toolbar). Wave B
  // altitude requirement: the launch logic lives here, not duplicated per call
  // site.
  private runLauncher!: RunLauncher;
  private workspaceAdapter!: ObsidianWorkspaceAdapter;
  // WS-A4 deep-link port: resolves an artifact id (PRD-NNN/UC-NNN/SM-NNN) and
  // opens the right view focused on it, reusing the existing findById services +
  // the leaf-opening flows below. Thin views link through this, not openView.
  private artifactNavigator!: ArtifactNavigationPort;
  // In-process post-run flow (P2-1/P2-6/P2-7). Subscribes to the EN-2 terminal
  // run events and runs import→evidence→dashboard-refresh, owning the `lastRun`
  // state, the run-status eligibility rule, and the serializing evidence chain
  // that used to live here.
  private postRunCoordinator!: PostRunCoordinator;
  private guidedTourService!: GuidedTourService;
  private commandHelpers!: RegisteredCommandHelpers;
  // Every NodeChildProcessRunner built by this composition root, so onunload
  // can issue best-effort kill signals to ANY still-running child — including
  // an in-flight `npm install` on the shared runner, which no command path can
  // reach once the plugin is gone (A6).
  private readonly processRunners: NodeChildProcessRunner[] = [];
  // Kept as a class field so the settings tab can invoke installBrowsers
  // directly (US-055 browser matrix "Install selected browsers" button).
  private runnerInstallService!: DefaultRunnerInstallationService;

  async onload(): Promise<void> {
    this.eventBus = new InMemoryEventBus((error) =>
      this.logger?.error("Event handler failed", error as Error),
    );
    const eventBus = this.eventBus;
    const pathSafety = new DefaultPathSafetyPolicy();

    // The logger is built first so SettingsService.load() can report a tampered
    // path (P0-1) and so it exists before any settings/secrets are known. Its
    // value-based redaction set (ADR-0019) is populated from the loaded SUT
    // credentials immediately after load and refreshed on every settings change
    // (P0-2). The SAME instance is kept for the plugin's lifetime — services
    // constructed before settings load (e.g. SettingsService) would otherwise
    // hold a stale logger that never receives setSecrets refreshes or the
    // persisted log level (F3); only the level filter is adjusted in place.
    const consoleLogger = new ConsoleLogger("info");
    this.logger = consoleLogger;
    const dataStore = new ObsidianDataStore(this, this.logger);
    const vault = new ObsidianVaultAdapter(this.app);
    // The vault is passed so validate() can run the ADR-0015 one-project-per-vault
    // sibling Test Hub check.
    this.hubSettingsService = new DefaultSettingsService(
      dataStore,
      pathSafety,
      eventBus,
      this.logger,
      vault,
    );
    this.hubSettings = await this.hubSettingsService.load();
    consoleLogger.setMinLevel(this.hubSettings.logging.level);
    this.refreshLoggerSecrets();

    this.workspaceAdapter = new ObsidianWorkspaceAdapter(this.app);

    // Build the layered service graph (Domain → Application → Infrastructure →
    // Presentation) out-of-line to keep this composition root under the size
    // budget. The forward references that used to resolve lazily through `this`
    // (init/maintenance/spec probing the execution service, the coordinator
    // drain) resolve through the returned holder instead; construction order is
    // unchanged, so eager references still see a built dependency.
    const services = composeServices({
      app: this.app,
      plugin: this,
      eventBus,
      logger: this.logger,
      pathSafety,
      hubSettingsService: this.hubSettingsService,
      vault,
      workspaceAdapter: this.workspaceAdapter,
      getSettings: () => this.hubSettings,
      updateSettings: (next) => this.updateSettings(next),
      processRunners: this.processRunners,
    });
    // Keep the slices the settings tab, ribbons, command palette, onunload, and
    // the open-a-modal helpers reach for as class fields (the rest live only
    // inside the composed graph / the views wired below).
    this.documentationService = services.documentationService;
    this.suiteService = services.suiteService;
    this.runnerInstallService = services.runnerInstallService;
    this.validationService = services.validationService;
    this.pipelineService = services.pipelineService;
    this.initializationService = services.initializationService;
    this.maintenanceService = services.maintenanceService;
    this.prdService = services.prdService;
    this.storyMapService = services.storyMapService;
    this.useCaseService = services.useCaseService;
    this.specificationService = services.specificationService;
    this.featureInsightService = services.featureInsightService;
    this.stepDefinitionService = services.stepDefinitionService;
    this.testExecutionService = services.testExecutionService;
    this.runLauncher = services.runLauncher;
    this.postRunCoordinator = services.postRunCoordinator;
    this.guidedTourService = services.guidedTourService;

    // WS-A4: the deep-link navigator wires the findById services to the existing
    // leaf-opening flows. A PRD has no detail view, so it opens its note; a Use
    // Case / Story Map re-targets its single detail/board leaf.
    this.artifactNavigator = new ArtifactNavigator({
      prdService: this.prdService,
      useCaseService: this.useCaseService,
      storyMapService: this.storyMapService,
      // WS-B4: the Evidence↔Run hop resolves a run id to the evidence note it
      // produced (the run history's only by-id lookup).
      runHistory: services.runHistoryService,
      openUseCaseDetail: (useCaseId) => void this.openUseCaseDetail(useCaseId),
      openStoryMapBoard: (storyMapId) => void this.openStoryMapBoard(storyMapId),
      openFile: (path) => this.workspaceAdapter.openFile(path),
    });

    // Register the Obsidian views + the `.feature` editor extension out-of-line
    // (size budget). Each view's factory closes over the composed services and
    // the open-a-modal / switch-environment callbacks this composition root owns
    // — a view never re-implements those flows.
    registerViews(this, {
      app: this.app,
      eventBus,
      workspace: this.workspaceAdapter,
      vault,
      logger: this.logger,
      services,
      getSettings: () => this.hubSettings,
      openCreateUseCase: () => this.openCreateUseCase(),
      openUseCaseDetail: (useCaseId) => void this.openUseCaseDetail(useCaseId),
      openHub: () => this.openHub(),
      navigate: (target) => void this.navigate(target),
      openCreateSuite: () => this.openCreateSuite(),
      openPrdBuilder: (parentPrdId) => this.openPrdBuilder(parentPrdId),
      openStoryMapBuilder: () => this.openStoryMapBuilder(),
      openStoryMapBoard: (storyMapId) => void this.openStoryMapBoard(storyMapId),
      openWizard: () => this.openWizard(),
      openDocumentation: (documentType) => this.openDocumentation(documentType),
      generateDocumentation: () => this.generateDocumentation(),
      openEvidence: (path) => this.openEvidenceNote(path),
      switchEnvironment: (name) => this.switchEnvironment(name),
      openLatestEvidence: () => this.openLatestEvidence(),
      // Lazy: commandHelpers is assigned by registerCommands() below, before any
      // view can open.
      generateCiWorkflow: () => this.commandHelpers.generateCiWorkflow(),
    });

    // The settings tab drives validate/repair/CI inline (Wave A); it receives
    // only the narrow service slices its SettingsTabServices contract names.
    this.addSettingTab(
      new TestHubSettingTab(this, this, {
        validation: this.validationService,
        maintenance: this.maintenanceService,
        pipeline: this.pipelineService,
        installation: this.runnerInstallService,
      }),
    );

    // Ribbon icons stay in the composition root (they are plugin chrome, not
    // command bodies). Default chrome is deliberately minimal (2026-06-11
    // review §4 product call): Dashboard + Test Console only — the dashboard
    // is the hub (incl. the Initialize call to action when uninitialized);
    // every other surface stays reachable via the command palette and the
    // dashboard's quick actions.
    this.addRibbonIcon(
      "gauge",
      "Open Test Hub dashboard",
      () => void this.workspaceAdapter.openView(DASHBOARD_VIEW_TYPE),
    );
    this.addRibbonIcon(
      "terminal",
      "Open Test Console",
      () => void this.workspaceAdapter.openView(TEST_CONSOLE_VIEW_TYPE, "sidebar"),
    );
    this.addRibbonIcon(
      "git-fork",
      "Open PRDs",
      () => void this.workspaceAdapter.openView(PRD_VIEW_TYPE, "sidebar"),
    );
    this.addRibbonIcon(
      "map",
      "Open Story Maps",
      () => void this.workspaceAdapter.openView(STORY_MAP_VIEW_TYPE, "sidebar"),
    );

    // Command-palette surface (P2-7): the command bodies live in
    // presentation/commands/register-commands.ts behind a narrow deps contract;
    // the composition root only supplies the wired services plus the few
    // open-a-modal helpers it shares with the ribbons/views above.
    this.commandHelpers = registerCommands(this, {
      getSettings: () => this.hubSettings,
      validationService: this.validationService,
      maintenanceService: this.maintenanceService,
      pipelineService: this.pipelineService,
      documentationService: this.documentationService,
      useCaseService: this.useCaseService,
      specificationService: this.specificationService,
      stepDefinitionService: this.stepDefinitionService,
      suiteService: this.suiteService,
      runLauncher: this.runLauncher,
      postRunCoordinator: this.postRunCoordinator,
      workspace: this.workspaceAdapter,
      openWizard: () => this.openWizard(),
      openCreateUseCase: () => this.openCreateUseCase(),
      openCreateSuite: () => this.openCreateSuite(),
      openPrdBuilder: () => this.openPrdBuilder(),
      openStoryMapBuilder: () => this.openStoryMapBuilder(),
      openDocumentation: (documentType) => this.openDocumentation(documentType),
    });

    this.logger.info("Test Hub loaded");
  }

  onunload(): void {
    // Best-effort SYNCHRONOUS teardown (PRES-H1, P1-4). Obsidian does NOT await
    // the promise onunload returns, so we cannot meaningfully `await` the cancel
    // or `whenActiveSettles()` here — the awaits would be fire-and-forget and the
    // "wait for the child to exit before teardown" guarantee would not hold.
    //
    // Instead: issue the kill signal immediately so a run active during a
    // disable/reload doesn't leave the runner's npm/Playwright child alive inside
    // Obsidian with no console subscribers and no command path to stop it. We
    // `void` the discarded promise — cancel() reserves nothing and only signals
    // the child; the service's single-active-run slot (reserved synchronously in
    // execute(), freed only when the process actually closes) prevents overlap
    // WITHIN this instance.
    //
    // Residual limitation: a brand-new plugin instance can onload() while this
    // instance's child is still closing. That cross-instance overlap is inherent
    // without a cross-instance lock and is acceptable for V1 (the per-run report
    // snapshot already protects evidence attribution).
    const active = this.testExecutionService?.activeRunId() ?? null;
    if (active !== null) {
      void this.testExecutionService.cancel(active).then((cancelled) => {
        if (!cancelled.ok) {
          this.logger?.warn("Could not cancel active run on unload", {
            runId: active,
            reason: cancelled.error.message,
          });
        }
      });
    }
    // Detach the post-run coordinator's bus subscriptions so a late terminal
    // event after unload can't drive a new import (synchronous, race-free).
    // Any in-flight import/evidence task is awaited where evidence I/O must
    // settle before files are mutated (MaintenanceService.repair()/reset()
    // drain it under the maintenance lock); onunload is best-effort
    // synchronous per PRES-H1, and the per-run snapshot already protects
    // attribution, so we do not block teardown on whenSettled() here.
    this.postRunCoordinator?.stop();
    this.guidedTourService?.stop();
    // Best-effort kill signal to ANY child still tracked by either runner —
    // notably an in-flight `npm install`/`playwright install` on the shared
    // runner, which would otherwise survive unload with no way to stop it (A6).
    // Idempotent with the cancel() above (an already-signalled child is gone
    // from the tracking map or tolerates a second signal).
    for (const runner of this.processRunners) runner.disposeAll();
    // registerView + each view's onClose already tear the views down on unload;
    // detachLeavesOfType is explicitly discouraged (it destroys the user's saved
    // workspace layout across reloads/updates), so it is intentionally NOT called
    // here (P1-3 / PRES-H2).
    this.logger?.info("Test Hub unloaded");
  }

  private openWizard(): void {
    new InitializationWizardModal(this.app, {
      initialization: this.initializationService,
      workspace: this.workspaceAdapter,
      getSettings: () => this.hubSettings,
      openGuidedTour: () => void this.workspaceAdapter.openView(GUIDED_TOUR_VIEW_TYPE, "sidebar"),
    }).open();
  }

  private openCreateUseCase(): void {
    new CreateUseCaseModal(this.app, {
      useCaseService: this.useCaseService,
      // C1: open the detail cockpit for the new Use Case (forward momentum),
      // not the raw note — the cockpit hosts the loop rail's next step.
      openUseCaseDetail: (useCaseId) => void this.openUseCaseDetail(useCaseId),
    }).open();
  }

  // WS-A4/B4: open whatever node `target` names (PRD/UC/Story Map by id;
  // Feature/Suite/Evidence by path; Run by id) through the deep-link port,
  // surfacing a graceful Notice when the target can't be resolved
  // (renamed/deleted/unrecognized) rather than failing silently.
  private async navigate(target: NavigationTarget): Promise<void> {
    const result = await this.artifactNavigator.navigate(target);
    if (!result.ok) new Notice(result.error.message, 8000);
  }

  // WS-B1 / ADR-0031: open (or reveal) the SINGLE Test Hub home leaf. Mirrors
  // openUseCaseDetail/openStoryMapBoard — reuse the existing hub leaf if one is
  // open, else create a new main tab; setViewState then revealLeaf brings it
  // forward. The hub is a singleton home, so there is never more than one leaf.
  private async openHub(): Promise<void> {
    const { workspace } = this.app;
    const leaf = workspace.getLeavesOfType(HUB_VIEW_TYPE)[0] ?? workspace.getLeaf("tab");
    await leaf.setViewState({ type: HUB_VIEW_TYPE, active: true });
    void workspace.revealLeaf(leaf);
  }

  // Wave D: open (or re-target) the Use Case detail view for `useCaseId`. The id
  // travels in the leaf's view state so the leaf survives a workspace reload and
  // the view re-renders itself for the new target. A single detail leaf is
  // reused (re-targeted) rather than stacking one per Use Case.
  private async openUseCaseDetail(useCaseId: string): Promise<void> {
    const { workspace } = this.app;
    const leaf =
      workspace.getLeavesOfType(USE_CASE_DETAIL_VIEW_TYPE)[0] ?? workspace.getLeaf("tab");
    await leaf.setViewState({
      type: USE_CASE_DETAIL_VIEW_TYPE,
      active: true,
      state: { useCaseId },
    });
    void workspace.revealLeaf(leaf);
  }

  // Opens the read-only Story Map board in the main area. A single board leaf is
  // reused (re-targeted) per map, mirroring openUseCaseDetail.
  private async openStoryMapBoard(storyMapId: string): Promise<void> {
    const { workspace } = this.app;
    const leaf =
      workspace.getLeavesOfType(STORY_MAP_BOARD_VIEW_TYPE)[0] ?? workspace.getLeaf("tab");
    await leaf.setViewState({
      type: STORY_MAP_BOARD_VIEW_TYPE,
      active: true,
      state: { storyMapId },
    });
    void workspace.revealLeaf(leaf);
  }

  private openCreateSuite(): void {
    new CreateSuiteModal(this.app, {
      suiteService: this.suiteService,
      workspace: this.workspaceAdapter,
      featureInsight: this.featureInsightService,
    }).open();
  }

  private openPrdBuilder(parentPrdId?: string): void {
    new PrdBuilderModal(this.app, {
      prdService: this.prdService,
      useCaseService: this.useCaseService,
      parentPrdId,
    }).open();
  }

  private openStoryMapBuilder(): void {
    new StoryMapBuilderModal(this.app, {
      storyMapService: this.storyMapService,
      prdService: this.prdService,
      onCreated: (id) => void this.openStoryMapBoard(id),
    }).open();
  }

  // EPIC-011 FEAT-025 (US-046, UC-021/022/023): open the documentation index
  // hub and emit `documentation.opened`. Generates the docs first if absent so
  // the command is self-sufficient (generate() is idempotent / skip-existing).
  private async openDocumentation(
    documentType: "getting-started" | "manual" | "troubleshooting" | "index" = "index",
  ): Promise<void> {
    // open() ensures the target note exists silently (no documentation.generated).
    const opened = await this.documentationService.open(documentType);
    if (!opened.ok) {
      new Notice(`Could not open documentation: ${opened.error.message}`, 10000);
    }
  }

  // Opens a linked Evidence note from the console/dashboard. An evidence note
  // can be deleted after its link was rendered (entry-point review) — a silent
  // no-op there left the user clicking a dead button, so surface the failure
  // (via the same openOrNotice helper the views use, with a specific message).
  private async openEvidenceNote(path: VaultPath): Promise<void> {
    await openOrNotice(this.workspaceAdapter, path, {
      message: `Could not open the evidence note "${path}". It may have been moved or deleted.`,
      timeout: 10000,
    });
  }

  // Guided Tour step 9: open the most recent Evidence note, or say why not.
  // lastEvidence() returns the { runId, evidencePath } record (or null), so the
  // null check guards the whole record and the path is read off it.
  private openLatestEvidence(): void {
    const latest = this.postRunCoordinator.lastEvidence();
    if (latest === null) {
      new Notice("No evidence note yet — run a test first.");
      return;
    }
    void this.openEvidenceNote(latest.evidencePath);
  }

  // Reuses the documentation service the command palette uses; the UI is thin.
  private async generateDocumentation(): Promise<void> {
    new Notice("Generating Test Hub documentation…");
    const result = await this.documentationService.generate();
    if (result.ok) {
      new Notice(`Documentation generated (${result.value.documents.length} note(s)).`);
    } else {
      new Notice(`Could not generate documentation: ${result.error.message}`, 10000);
    }
  }

  // Wave C §2: switch the active environment from the dashboard top bar. The
  // composition root owns the settings save path (updateSettings persists +
  // emits settings.updated, which the dashboard subscribes to for its refresh),
  // so the view passes a name and never writes settings itself.
  private async switchEnvironment(name: string): Promise<void> {
    // Object.hasOwn, not `in`: a name like "toString" would hit the prototype
    // chain with `in` and pass the guard without a real environment.
    if (!Object.hasOwn(this.hubSettings.sut.environments, name)) {
      new Notice(`Unknown environment: ${name}`, 10000);
      return;
    }
    if (name === this.hubSettings.sut.active) return;
    const next: TestHubSettings = {
      ...this.hubSettings,
      sut: { ...this.hubSettings.sut, active: name },
    };
    const result = await this.updateSettings(next);
    if (result.ok) {
      new Notice(`Active environment: ${name}.`);
    } else {
      new Notice(`Could not switch environment: ${result.error.message}`, 10000);
    }
  }

  // --- SettingsHost --------------------------------------------------------

  getSettings(): TestHubSettings {
    return this.hubSettings;
  }

  async updateSettings(next: TestHubSettings): Promise<Result<void>> {
    // Optimistic in-memory swap BEFORE the awaited save, for two reasons:
    // (1) save() publishes `settings.updated` while it is awaited, and the
    //     bus synchronously drives the dashboard re-render — which reads
    //     getSettings(); assigning afterwards made that one render (the one
    //     meant to show the change) paint the STALE settings.
    // (2) the settings tab debounces saves PER FIELD and each handler builds
    //     `next` from getSettings(); assigning afterwards let a second field's
    //     handler snapshot a base that missed the first field's edit, silently
    //     reverting it (the F2 lost-update, on the caller side).
    const previous = this.hubSettings;
    this.hubSettings = next;
    this.refreshLoggerSecrets();
    const result = await this.hubSettingsService.save(next);
    if (!result.ok) {
      // Roll back — but only if no newer update superseded this one while the
      // save was in flight (their optimistic state must not be clobbered).
      if (this.hubSettings === next) {
        this.hubSettings = previous;
        this.refreshLoggerSecrets();
      }
      return result;
    }
    this.logger.info("Settings updated");
    return result;
  }

  async resetSettings(): Promise<void> {
    // Full UC-024 reset: remove the regenerable `.testrunner` runtime, restore
    // default settings, and re-initialize — all under one reset correlationId.
    // The active-run refusal and the run/maintenance mutual exclusion are
    // enforced SYNCHRONOUSLY inside MaintenanceService.reset() via the shared
    // maintenance lock (security L1 TOCTOU close), so the run can't reserve a
    // slot in a check-then-act gap here. Evidence I/O outlives the active run
    // slot (the coordinator writes Use Case frontmatter after the slot frees);
    // reset() drains it via the injected whenPostRunSettled hook AFTER the lock
    // is acquired, so no pre-await is needed — or safe — here.
    const result = await this.maintenanceService.reset();
    if (!result.ok) {
      new Notice(
        result.error.code === "RUN_IN_PROGRESS"
          ? "A Test Run is in progress; cancel it before resetting."
          : `Reset failed: ${result.error.message}`,
        10000,
      );
      return;
    }
    // Re-load the now-default settings so the in-memory copy, redaction set,
    // AND the logger's level filter match the persisted reset (the in-place
    // setMinLevel exists precisely so this stays one logger instance, F3).
    this.hubSettings = await this.hubSettingsService.load();
    this.refreshLoggerSecrets();
    this.logger.setMinLevel(this.hubSettings.logging.level);
    new Notice("Test Hub reset to a clean state.");
  }

  /**
   * Rebuilds the Logger's value-based redaction set (ADR-0019) from the current
   * SUT credential values, so a credential logged positionally under a
   * non-sensitive key (e.g. streamed runner stderr) is scrubbed to `***`
   * (P0-2 / T3). Called after load and on every settings change.
   */
  private refreshLoggerSecrets(): void {
    this.logger.setSecrets(collectCredentialValues(this.hubSettings));
  }
}
