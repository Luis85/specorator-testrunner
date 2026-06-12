import { Notice, Plugin } from "obsidian";

import { DefaultDemoContentService } from "./application/services/demo-content-service";
import {
  DefaultDocumentationGenerationService,
  type DocumentationGenerationService,
} from "./application/services/documentation-generation-service";
import {
  DefaultEnvironmentValidationService,
  type EnvironmentValidationService,
} from "./application/services/environment-validation-service";
import {
  DefaultInitializationService,
  type InitializationService,
} from "./application/services/initialization-service";
import {
  DefaultMaintenanceService,
  type MaintenanceService,
} from "./application/services/maintenance-service";
import {
  DefaultPipelineGenerationService,
  type PipelineGenerationService,
} from "./application/services/pipeline-generation-service";
import {
  DefaultEvidenceGenerationService,
  type EvidenceGenerationService,
} from "./application/services/evidence-generation-service";
import {
  DefaultFeatureInsightService,
  type FeatureInsightService,
} from "./application/services/feature-insight-service";
import {
  DefaultReportImportService,
  type ReportImportService,
} from "./application/services/report-import-service";
import { PostRunCoordinator } from "./application/services/post-run-coordinator";
import {
  DefaultGuidedTourService,
  type GuidedTourService,
} from "./application/services/guided-tour-service";
import { DEMO_FEATURE_FILE_NAME, DEMO_USE_CASE_ID } from "./application/content/demo-content";
import { DEFAULT_SUITES } from "./application/content/default-suites";
import { DefaultRunnerInstallationService } from "./application/services/runner-installation-service";
import {
  DefaultSettingsService,
  type SettingsService,
} from "./application/services/settings-service";
import {
  DefaultSpecificationService,
  type SpecificationService,
} from "./application/services/specification-service";
import {
  DefaultStepDefinitionService,
  type StepDefinitionService,
} from "./application/services/step-definition-service";
import { DefaultSuiteService, type SuiteService } from "./application/services/suite-service";
import {
  DefaultTraceabilityService,
  type TraceabilityService,
} from "./application/services/traceability-service";
import {
  DefaultTestExecutionService,
  type TestExecutionService,
} from "./application/services/test-execution-service";
import {
  DefaultUseCaseService,
  type UseCaseService,
} from "./application/services/use-case-service";
import { DefaultCommandSafetyPolicy } from "./domain/policies/command-safety-policy";
import { DefaultPathSafetyPolicy } from "./domain/policies/path-safety-policy";
import type { VaultPath } from "./domain/value-objects/identifiers";
import {
  collectCredentialValues,
  DEFAULT_SETTINGS,
  type TestHubSettings,
} from "./domain/settings/settings";
import { NodeAbsoluteFileSystem } from "./infrastructure/filesystem/node-absolute-file-system";
import { ObsidianDataStore } from "./infrastructure/obsidian/obsidian-data-store";
import { ObsidianVaultAdapter } from "./infrastructure/obsidian/obsidian-vault-adapter";
import { ObsidianWorkspaceAdapter } from "./infrastructure/obsidian/obsidian-workspace-adapter";
import { NodeChildProcessRunner } from "./infrastructure/runner/node-child-process-runner";
import { RunnerTemplateWriter } from "./infrastructure/runner/runner-template-writer";
import {
  registerCommands,
  type RegisteredCommandHelpers,
} from "./presentation/commands/register-commands";
import { RunLauncher } from "./presentation/run/run-launcher";
import { TestHubSettingTab, type SettingsHost } from "./presentation/settings/settings-tab";
import { CreateSuiteModal } from "./presentation/views/create-suite-modal";
import { CreateUseCaseModal } from "./presentation/views/create-use-case-modal";
import { InitializationWizardModal } from "./presentation/views/initialization-wizard-modal";
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
import { generateFeatureForUseCase } from "./presentation/views/generate-feature-modal";
import { openOrNotice } from "./presentation/views/modal-helpers";
import { DASHBOARD_VIEW_TYPE, DashboardView } from "./presentation/views/dashboard-view";
import { GUIDED_TOUR_VIEW_TYPE, GuidedTourView } from "./presentation/views/guided-tour-view";
import {
  DefaultRunHistoryService,
  type RunHistoryService,
} from "./application/services/run-history-service";
import {
  EVIDENCE_EXPLORER_VIEW_TYPE,
  EvidenceExplorerView,
} from "./presentation/views/evidence-explorer-view";
import {
  FEATURE_EDITOR_VIEW_TYPE,
  FeatureEditorView,
} from "./presentation/views/feature-editor-view";
import { InMemoryEventBus } from "./shared/event-bus/event-bus";
import { ConsoleLogger } from "./shared/logging/logger";
import type { Result } from "./shared/result/result";

/**
 * Composition root for the E2E Test Hub plugin. Instantiates the layered
 * graph (Shared Kernel → Domain → Application → Infrastructure → Presentation)
 * and registers the Obsidian surfaces.
 */
export default class E2ETestHubPlugin extends Plugin implements SettingsHost {
  private hubSettings: TestHubSettings = DEFAULT_SETTINGS;
  private logger!: ConsoleLogger;
  private hubSettingsService!: SettingsService;
  private initializationService!: InitializationService;
  private validationService!: EnvironmentValidationService;
  private maintenanceService!: MaintenanceService;
  private documentationService!: DocumentationGenerationService;
  private pipelineService!: PipelineGenerationService;
  private useCaseService!: UseCaseService;
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
  private reportImportService!: ReportImportService;
  private evidenceGenerationService!: EvidenceGenerationService;
  private traceabilityService!: TraceabilityService;
  private runHistoryService!: RunHistoryService;
  private workspaceAdapter!: ObsidianWorkspaceAdapter;
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

  async onload(): Promise<void> {
    const eventBus = new InMemoryEventBus((error) =>
      this.logger?.error("Event handler failed", error as Error),
    );
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

    // EPIC-011 Documentation (FEAT-024/025). The workspace adapter is passed so
    // the "Open Documentation" command (US-046) can open a generated note.
    this.documentationService = new DefaultDocumentationGenerationService(
      this.hubSettingsService,
      vault,
      eventBus,
      this.workspaceAdapter,
    );
    const documentation = this.documentationService;
    this.suiteService = new DefaultSuiteService(this.hubSettingsService, vault, eventBus);
    const suites = this.suiteService;
    const demo = new DefaultDemoContentService(this.hubSettingsService, vault, eventBus);

    const absoluteFs = new NodeAbsoluteFileSystem(this.app);
    const childProcess = new NodeChildProcessRunner();
    this.processRunners.push(childProcess);
    const templateWriter = new RunnerTemplateWriter(absoluteFs);
    const commandSafety = new DefaultCommandSafetyPolicy();

    const runnerInstall = new DefaultRunnerInstallationService(
      templateWriter,
      childProcess,
      absoluteFs,
      commandSafety,
      eventBus,
      this.logger,
    );
    this.validationService = new DefaultEnvironmentValidationService(
      this.hubSettingsService,
      childProcess,
      absoluteFs,
      commandSafety,
      eventBus,
      process.env,
      process.platform,
    );
    // EPIC-010 CI/CD (UC-019): generate the GitHub Actions workflow into the
    // user's repo root via the absolute filesystem (the workflow is not a
    // VaultPath; it must live where GitHub Actions discovers it, TIS §8.13).
    this.pipelineService = new DefaultPipelineGenerationService(
      absoluteFs,
      eventBus,
      commandSafety,
    );
    this.initializationService = new DefaultInitializationService(
      this.hubSettingsService,
      vault,
      documentation,
      suites,
      demo,
      runnerInstall,
      this.validationService,
      pathSafety,
      eventBus,
      this.logger,
      // Init rewrites the `.testrunner` files an in-flight run reads, so it
      // refuses while a run is active (entry-point review). The execution
      // service is built further down — probe lazily through `this`. During a
      // reset's nested re-init the maintenance lock already blocks new runs,
      // so this probe reads null there (no deadlock).
      () => this.testExecutionService?.activeRunId() ?? null,
    );
    // Maintenance (repair/reset). The execution service — which owns the
    // synchronous maintenance lock that closes the reset/run TOCTOU (security
    // L1) — is built further down, so delegate to it lazily through `this`. The
    // lock's begin() performs the ADR-0018 active-run refusal synchronously, so
    // the active-run guard here is the legacy fallback only.
    this.maintenanceService = new DefaultMaintenanceService(
      this.hubSettingsService,
      this.validationService,
      runnerInstall,
      eventBus,
      this.logger,
      {
        activeRunId: () => this.testExecutionService.activeRunId(),
        whenActiveSettles: () => this.testExecutionService.whenActiveSettles(),
      },
      this.initializationService,
      vault,
      {
        inProgress: () => this.testExecutionService.maintenanceLock.inProgress(),
        begin: () => this.testExecutionService.maintenanceLock.begin(),
        end: () => this.testExecutionService.maintenanceLock.end(),
      },
      // Drained INSIDE repair()/reset() after the lock is acquired, so the tail
      // of the previous run's import/evidence chain (which outlives the
      // active-run slot) settles before maintenance touches any files.
      () => this.postRunCoordinator.whenSettled(),
    );
    this.useCaseService = new DefaultUseCaseService(
      this.hubSettingsService,
      vault,
      eventBus,
      this.logger,
    );
    this.specificationService = new DefaultSpecificationService(
      this.hubSettingsService,
      this.useCaseService,
      vault,
      eventBus,
      this.logger,
    );
    // Wave F insight: composes listFeatures (discovery stays defined once) with
    // the shared Gherkin parser to answer "how many scenarios does this Tag
    // Expression match?" and "how healthy is this Feature?" for the views.
    this.featureInsightService = new DefaultFeatureInsightService(this.specificationService, vault);
    // UC-010 / RV-4: generate step-definition stubs for a feature's undefined
    // steps. Writes via the same VaultFileSystem + `.testrunner/src/steps` path
    // that detectMissingSteps reads from, so a stub is picked up next detection.
    this.stepDefinitionService = new DefaultStepDefinitionService(
      this.hubSettingsService,
      vault,
      eventBus,
      this.logger,
    );
    // A dedicated runner instance for test execution: cancel() kills only the
    // (single, ADR-0018) active test process, never a concurrent validation,
    // repair, or install spawned on the shared `childProcess`.
    const runProcessRunner = new NodeChildProcessRunner();
    this.processRunners.push(runProcessRunner);
    this.testExecutionService = new DefaultTestExecutionService(
      this.hubSettingsService,
      this.suiteService,
      this.useCaseService,
      runProcessRunner,
      absoluteFs,
      commandSafety,
      eventBus,
      this.logger,
    );

    // Single run-launch surface shared by the command palette and the explorer
    // / Test Console buttons (Wave B). It reveals the live Test Console BEFORE
    // execute() publishes (the bus does not replay) and surfaces
    // RUN_IN_PROGRESS / errors as Notices. The open-console port is backed by
    // the workspace adapter so the launcher itself stays free of Obsidian view
    // plumbing.
    this.runLauncher = new RunLauncher(this.testExecutionService, {
      openConsole: () => this.workspaceAdapter.openView(TEST_CONSOLE_VIEW_TYPE, "sidebar"),
    });

    // EPIC-008 Reporting & Evidence (UC-016): import the runner's JSON report
    // and generate linked Markdown evidence once a run finishes.
    this.reportImportService = new DefaultReportImportService(
      this.hubSettingsService,
      absoluteFs,
      eventBus,
      this.logger,
    );
    this.evidenceGenerationService = new DefaultEvidenceGenerationService(
      this.hubSettingsService,
      vault,
      this.useCaseService,
      eventBus,
      this.logger,
    );

    // EPIC-009 Dashboard (UC-018): aggregate the Use Case index into KPI counts
    // + recent runs for the live Test Hub Dashboard.
    this.traceabilityService = new DefaultTraceabilityService(
      this.useCaseService,
      vault,
      eventBus,
      this.logger,
    );
    this.runHistoryService = new DefaultRunHistoryService(
      this.hubSettingsService,
      vault,
      this.logger,
    );

    // After a run reaches a terminal state (EN-2), the coordinator reacts to the
    // bus event and runs import → evidence → dashboard refresh for the just-
    // finished run, serialized so back-to-back runs can't clobber each other's
    // Use Case frontmatter. It replaces the never-built ReportFileWatcher / the
    // imperative await chain that previously lived in `main.ts` (P2-1/P2-6/P2-7).
    this.postRunCoordinator = new PostRunCoordinator({
      reportImportService: this.reportImportService,
      evidenceGenerationService: this.evidenceGenerationService,
      traceabilityService: this.traceabilityService,
      eventBus,
      logger: this.logger,
      lastRun: () => this.testExecutionService.lastRun(),
      activeRunId: () => this.testExecutionService.activeRunId(),
      whenActiveSettles: () => this.testExecutionService.whenActiveSettles(),
      isEvidenceMarkdownEnabled: () => this.hubSettings.automation.generateEvidenceMarkdown,
    });
    this.postRunCoordinator.start();

    // Guided Tour (spec 2026-06-11): observes the user's real actions on the
    // bus and advances the onboarding checklist whether or not the view is
    // open. Persistence goes through the SettingsHost so the in-memory
    // settings copy stays current (optimistic swap in updateSettings).
    this.guidedTourService = new DefaultGuidedTourService(
      {
        getSettings: () => this.hubSettings,
        updateSettings: (next) => this.updateSettings(next),
      },
      eventBus,
      this.logger,
      {
        demoUseCaseId: DEMO_USE_CASE_ID,
        demoFeatureFileName: DEMO_FEATURE_FILE_NAME,
        defaultSuiteIds: DEFAULT_SUITES.map((suite) => suite.id),
      },
    );
    this.guidedTourService.start();

    this.registerView(
      USE_CASE_VIEW_TYPE,
      (leaf) =>
        new UseCaseDashboardView(leaf, {
          useCaseService: this.useCaseService,
          specificationService: this.specificationService,
          workspace: this.workspaceAdapter,
          eventBus,
          runLauncher: this.runLauncher,
          onCreate: () => this.openCreateUseCase(),
          // Wave D: the id column opens the Use Case detail view (authoring &
          // testing surface); the per-row "Note" link keeps raw note access.
          onOpenDetail: (useCaseId) => void this.openUseCaseDetail(useCaseId),
        }),
    );
    // Wave D: the Use Case detail view — the UI-driven authoring & testing
    // surface for one Use Case. Deps are the narrow lookup + spec/step services
    // it orchestrates, the workspace port, the shared run launcher, and the
    // generate-Feature opener (which reuses the command palette's slug-prompt
    // flow rather than forking the generation logic).
    this.registerView(
      USE_CASE_DETAIL_VIEW_TYPE,
      (leaf) =>
        new UseCaseDetailView(leaf, {
          useCaseService: this.useCaseService,
          specificationService: this.specificationService,
          stepDefinitionService: this.stepDefinitionService,
          featureInsight: this.featureInsightService,
          workspace: this.workspaceAdapter,
          eventBus,
          runLauncher: this.runLauncher,
          openGenerateFeature: (useCase, onGenerated) =>
            generateFeatureForUseCase(
              this.app,
              {
                useCaseService: this.useCaseService,
                specificationService: this.specificationService,
                workspace: this.workspaceAdapter,
              },
              useCase,
              () => onGenerated(),
            ),
        }),
    );
    this.registerView(
      SUITE_VIEW_TYPE,
      (leaf) =>
        new SuiteDashboardView(leaf, {
          suiteService: this.suiteService,
          workspace: this.workspaceAdapter,
          eventBus,
          runLauncher: this.runLauncher,
          featureInsight: this.featureInsightService,
          onCreate: () => this.openCreateSuite(),
        }),
    );
    this.registerView(
      TEST_CONSOLE_VIEW_TYPE,
      (leaf) =>
        new TestConsoleView(leaf, {
          eventBus,
          runLauncher: this.runLauncher,
          // Narrow read-only slice: the toolbar checks for an active run on open
          // and reads the last run's scope to power Re-run.
          activeRunId: () => this.testExecutionService.activeRunId(),
          activeRunStartedAt: () => this.testExecutionService.activeRunStartedAt(),
          lastRun: () => this.testExecutionService.lastRun(),
          // Wave G §1: the "Open evidence" button. The coordinator already owns
          // the post-run evidence flow, so it is the cleanest synchronous source
          // for "the last generated evidence note" when the console opens after
          // `evidence.generated` already fired (the bus does not replay).
          lastEvidence: () => this.postRunCoordinator.lastEvidence(),
          openEvidence: (path) => this.openEvidenceNote(path),
        }),
    );
    this.registerView(
      DASHBOARD_VIEW_TYPE,
      (leaf) =>
        // Wave C: the dashboard hub drives create/run/open/generate-docs/switch-
        // environment/open-evidence through callbacks wired to the EXISTING
        // helpers + the Wave B RunLauncher (no run/create logic is duplicated).
        new DashboardView(leaf, {
          traceabilityService: this.traceabilityService,
          eventBus,
          // Real initialization signal: the Use Cases folder the snapshot reads
          // exists once the wizard has scaffolded the vault. A fresh vault lists
          // it as ok([]), so snapshot success can't distinguish "not set up" —
          // this folder-existence check can.
          isInitialized: () => vault.exists(this.hubSettings.paths.useCasesPath),
          openDocumentation: (documentType) => this.openDocumentation(documentType),
          openWizard: () => this.openWizard(),
          openCreateUseCase: () => this.openCreateUseCase(),
          openCreateSuite: () => this.openCreateSuite(),
          runAll: () => this.runLauncher.launch({ scope: "all", target: "all" }),
          runDemo: () => this.runLauncher.launch({ scope: "demo", target: "demo" }),
          generateDocumentation: () => this.generateDocumentation(),
          navigate: () => void this.workspaceAdapter.openView(USE_CASE_VIEW_TYPE),
          openSuites: () => void this.workspaceAdapter.openView(SUITE_VIEW_TYPE),
          openConsole: () => void this.workspaceAdapter.openView(TEST_CONSOLE_VIEW_TYPE, "sidebar"),
          openEvidence: (path) => this.openEvidenceNote(path),
          getEnvironments: () => ({
            active: this.hubSettings.sut.active,
            names: Object.keys(this.hubSettings.sut.environments),
          }),
          switchEnvironment: (name) => this.switchEnvironment(name),
          openEvidenceExplorer: () =>
            void this.workspaceAdapter.openView(EVIDENCE_EXPLORER_VIEW_TYPE),
          tourVisible: () => {
            const state = this.guidedTourService.getState();
            return !state.completed && !state.dismissed;
          },
          openGuidedTour: () =>
            void this.workspaceAdapter.openView(GUIDED_TOUR_VIEW_TYPE, "sidebar"),
        }),
    );
    this.registerView(
      EVIDENCE_EXPLORER_VIEW_TYPE,
      (leaf) =>
        new EvidenceExplorerView(leaf, {
          runHistory: this.runHistoryService,
          eventBus,
          openEvidence: (path) => this.openEvidenceNote(path),
        }),
    );
    this.registerView(
      GUIDED_TOUR_VIEW_TYPE,
      (leaf) =>
        new GuidedTourView(leaf, {
          tour: this.guidedTourService,
          eventBus,
          runDemo: () => this.runLauncher.launch({ scope: "demo", target: "demo" }),
          openCreateUseCase: () => this.openCreateUseCase(),
          openUseCases: () => void this.workspaceAdapter.openView(USE_CASE_VIEW_TYPE),
          openCreateSuite: () => this.openCreateSuite(),
          openSuites: () => void this.workspaceAdapter.openView(SUITE_VIEW_TYPE),
          openLatestEvidence: () => this.openLatestEvidence(),
          // Lazy: commandHelpers is assigned by registerCommands() below,
          // before any view can open.
          generateCiWorkflow: () => this.commandHelpers.generateCiWorkflow(),
        }),
    );

    // The `.feature` file handler: clicking a Feature file in the explorer /
    // quick switcher (or a detail-view "Open" button) now renders the Feature
    // Editor. registerExtensions throws if another plugin already claimed the
    // extension — degrade with a warning instead of failing the whole onload.
    this.registerView(
      FEATURE_EDITOR_VIEW_TYPE,
      (leaf) =>
        new FeatureEditorView(leaf, {
          specifications: this.specificationService,
          featureInsight: this.featureInsightService,
        }),
    );
    try {
      this.registerExtensions(["feature"], FEATURE_EDITOR_VIEW_TYPE);
    } catch (error) {
      this.logger.warn("Could not register the .feature extension", {
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    // The settings tab drives validate/repair/CI inline (Wave A); it receives
    // only the narrow service slices its SettingsTabServices contract names.
    this.addSettingTab(
      new TestHubSettingTab(this, this, {
        validation: this.validationService,
        maintenance: this.maintenanceService,
        pipeline: this.pipelineService,
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
    // disable/reload doesn't leave the runner's npm/Cucumber child alive inside
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
      workspace: this.workspaceAdapter,
    }).open();
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

  private openCreateSuite(): void {
    new CreateSuiteModal(this.app, {
      suiteService: this.suiteService,
      workspace: this.workspaceAdapter,
      featureInsight: this.featureInsightService,
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
