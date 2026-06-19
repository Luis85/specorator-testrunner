import type { App, Plugin } from "obsidian";

import { DefaultDemoContentService } from "./application/services/demo-content-service";
import { DefaultDocumentationGenerationService } from "./application/services/documentation-generation-service";
import { DefaultEnvironmentValidationService } from "./application/services/environment-validation-service";
import { DefaultInitializationService } from "./application/services/initialization-service";
import { DefaultMaintenanceService } from "./application/services/maintenance-service";
import { DefaultPipelineGenerationService } from "./application/services/pipeline-generation-service";
import { DefaultEvidenceGenerationService } from "./application/services/evidence-generation-service";
import { DefaultFeatureInsightService } from "./application/services/feature-insight-service";
import { CucumberJsonReportParser } from "./application/services/cucumber-json-report-parser";
import { DefaultReportImportService } from "./application/services/report-import-service";
import { PostRunCoordinator } from "./application/services/post-run-coordinator";
import { DefaultScenarioHistoryService } from "./application/services/scenario-history-service";
import { ScenarioIdentityResolver } from "./application/services/scenario-identity-resolver";
import { DefaultGuidedTourService } from "./application/services/guided-tour-service";
import { DEMO_FEATURE_FILE_NAME, DEMO_USE_CASE_ID } from "./application/content/demo-content";
import { DEFAULT_SUITES } from "./application/content/default-suites";
import { DefaultRunnerInstallationService } from "./application/services/runner-installation-service";
import { DefaultSpecificationService } from "./application/services/specification-service";
import { DefaultStepDefinitionService } from "./application/services/step-definition-service";
import { DefaultSuiteService } from "./application/services/suite-service";
import { DefaultTraceabilityService } from "./application/services/traceability-service";
import { DefaultTestExecutionService } from "./application/services/test-execution-service";
import { DefaultUseCaseService } from "./application/services/use-case-service";
import { DefaultPrdService } from "./application/services/prd-service";
import { DefaultStoryMapService } from "./application/services/story-map-service";
import { DefaultRunHistoryService } from "./application/services/run-history-service";
import { DefaultCommandSafetyPolicy } from "./domain/policies/command-safety-policy";
import type { PathSafetyPolicy } from "./domain/policies/path-safety-policy";
import type { SettingsService } from "./application/services/settings-service";
import type { TestHubSettings } from "./domain/settings/settings";
import { NodeAbsoluteFileSystem } from "./infrastructure/filesystem/node-absolute-file-system";
import type { ObsidianVaultAdapter } from "./infrastructure/obsidian/obsidian-vault-adapter";
import type { ObsidianWorkspaceAdapter } from "./infrastructure/obsidian/obsidian-workspace-adapter";
import { NodeChildProcessRunner } from "./infrastructure/runner/node-child-process-runner";
import { RunnerTemplateWriter } from "./infrastructure/runner/runner-template-writer";
import { RunLauncher } from "./presentation/run/run-launcher";
import { TEST_CONSOLE_VIEW_TYPE } from "./presentation/views/test-console-view";
import type { EventBus } from "./shared/event-bus/event-bus";
import type { ConsoleLogger } from "./shared/logging/logger";
import type { Result } from "./shared/result/result";

/**
 * The primitives the composition root builds first (logger, bus, settings
 * service, vault/workspace adapters) and the live-settings host, handed to
 * {@link composeServices} so it can construct the rest of the layered graph.
 */
export interface ComposeContext {
  app: App;
  plugin: Plugin;
  eventBus: EventBus;
  logger: ConsoleLogger;
  pathSafety: PathSafetyPolicy;
  hubSettingsService: SettingsService;
  vault: ObsidianVaultAdapter;
  workspaceAdapter: ObsidianWorkspaceAdapter;
  /** Live in-memory settings snapshot, read lazily by tour/coordinator. */
  getSettings: () => TestHubSettings;
  /** Persist-and-emit path the Guided Tour writes through. */
  updateSettings: (next: TestHubSettings) => Promise<Result<void>>;
  /** Every NodeChildProcessRunner is tracked here so onunload can kill children. */
  processRunners: NodeChildProcessRunner[];
}

/** The application/presentation services wired by {@link composeServices}. */
export interface ComposedServices {
  documentationService: DefaultDocumentationGenerationService;
  suiteService: DefaultSuiteService;
  runnerInstallService: DefaultRunnerInstallationService;
  validationService: DefaultEnvironmentValidationService;
  pipelineService: DefaultPipelineGenerationService;
  initializationService: DefaultInitializationService;
  maintenanceService: DefaultMaintenanceService;
  prdService: DefaultPrdService;
  storyMapService: DefaultStoryMapService;
  useCaseService: DefaultUseCaseService;
  specificationService: DefaultSpecificationService;
  featureInsightService: DefaultFeatureInsightService;
  stepDefinitionService: DefaultStepDefinitionService;
  testExecutionService: DefaultTestExecutionService;
  runLauncher: RunLauncher;
  reportImportService: DefaultReportImportService;
  evidenceGenerationService: DefaultEvidenceGenerationService;
  scenarioHistoryService: DefaultScenarioHistoryService;
  traceabilityService: DefaultTraceabilityService;
  runHistoryService: DefaultRunHistoryService;
  postRunCoordinator: PostRunCoordinator;
  guidedTourService: DefaultGuidedTourService;
}

/**
 * Constructs the layered service graph (Domain → Application → Infrastructure →
 * Presentation) for the plugin, in dependency order. Moved out of `main.ts`'s
 * onload to keep the composition root under the size budget. Forward references
 * (a service that probes one built later — e.g. init/maintenance/spec probing
 * the execution service's active run, the coordinator-drain hook) are wired
 * lazily through the returned `services` holder, exactly as they were through
 * `this` before; construction order is unchanged so eager references resolve.
 */
export const composeServices = (ctx: ComposeContext): ComposedServices => {
  const { eventBus, logger, pathSafety, hubSettingsService, vault, workspaceAdapter } = ctx;

  // Populated as each service is built; lazy forward-reference closures below
  // read from it so they resolve once the whole graph exists.
  const services = {} as ComposedServices;

  const absoluteFs = new NodeAbsoluteFileSystem(ctx.app);
  const childProcess = new NodeChildProcessRunner();
  ctx.processRunners.push(childProcess);
  const templateWriter = new RunnerTemplateWriter(absoluteFs);
  const commandSafety = new DefaultCommandSafetyPolicy();

  // EPIC-011 Documentation (FEAT-024/025). The workspace adapter is passed so
  // the "Open Documentation" command (US-046) can open a generated note.
  services.documentationService = new DefaultDocumentationGenerationService(
    hubSettingsService,
    vault,
    eventBus,
    workspaceAdapter,
  );
  services.suiteService = new DefaultSuiteService(hubSettingsService, vault, eventBus);
  const demo = new DefaultDemoContentService(hubSettingsService, vault, eventBus);

  services.runnerInstallService = new DefaultRunnerInstallationService(
    templateWriter,
    childProcess,
    absoluteFs,
    commandSafety,
    eventBus,
    logger,
  );
  services.validationService = new DefaultEnvironmentValidationService(
    hubSettingsService,
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
  services.pipelineService = new DefaultPipelineGenerationService(
    absoluteFs,
    eventBus,
    commandSafety,
  );
  services.initializationService = new DefaultInitializationService(
    hubSettingsService,
    vault,
    services.documentationService,
    services.suiteService,
    demo,
    services.runnerInstallService,
    services.validationService,
    pathSafety,
    eventBus,
    logger,
    // Init rewrites the `.testrunner` files an in-flight run reads, so it
    // refuses while a run is active (entry-point review). The execution service
    // is built further down — probe it lazily through `services`.
    () => services.testExecutionService?.activeRunId() ?? null,
  );
  // Maintenance (repair/reset). The execution service — which owns the
  // synchronous maintenance lock that closes the reset/run TOCTOU (security
  // L1) — is built further down, so delegate to it lazily through `services`.
  services.maintenanceService = new DefaultMaintenanceService(
    hubSettingsService,
    services.validationService,
    services.runnerInstallService,
    eventBus,
    logger,
    {
      activeRunId: () => services.testExecutionService.activeRunId(),
      whenActiveSettles: () => services.testExecutionService.whenActiveSettles(),
    },
    services.initializationService,
    vault,
    {
      inProgress: () => services.testExecutionService.maintenanceLock.inProgress(),
      begin: () => services.testExecutionService.maintenanceLock.begin(),
      end: () => services.testExecutionService.maintenanceLock.end(),
    },
    // Drained INSIDE repair()/reset() after the lock is acquired, so the tail
    // of the previous run's import/evidence chain settles before maintenance
    // touches any files.
    () => services.postRunCoordinator.whenSettled(),
  );
  // Built before useCaseService (which links to it): PrdService depends only on
  // settings/vault/bus/logger, so constructing it first lets assignToPrd's
  // PRD-lookup + shared-mutation-lock probes reference the already-built one.
  services.prdService = new DefaultPrdService(hubSettingsService, vault, eventBus, logger);
  services.useCaseService = new DefaultUseCaseService(hubSettingsService, vault, eventBus, logger, {
    findById: (id) => services.prdService.findById(id),
    withMutationLock: (op) => services.prdService.withMutationLock(op),
  });
  // Story Maps (ADR "Story Map as PRD-sibling overlay"): an upstream-design
  // artifact that references Use Cases by id. Built after useCaseService since it
  // resolves each card's `UC-NNN` to a real note name so grid links never dangle.
  services.storyMapService = new DefaultStoryMapService(
    hubSettingsService,
    vault,
    eventBus,
    logger,
    services.useCaseService,
  );
  services.specificationService = new DefaultSpecificationService(
    hubSettingsService,
    services.useCaseService,
    vault,
    eventBus,
    logger,
    childProcess,
    absoluteFs,
    commandSafety,
    // bddgen diagnostics regenerate `.features-gen` under the shared runner cwd,
    // so detection refuses while a run is active — probe lazily through `services`.
    () => services.testExecutionService?.activeRunId() ?? null,
  );
  services.featureInsightService = new DefaultFeatureInsightService(
    services.specificationService,
    vault,
  );
  services.stepDefinitionService = new DefaultStepDefinitionService(
    hubSettingsService,
    vault,
    eventBus,
    logger,
  );
  // A dedicated runner instance for test execution: cancel() kills only the
  // (single, ADR-0018) active test process, never a concurrent validation,
  // repair, or install spawned on the shared `childProcess`.
  const runProcessRunner = new NodeChildProcessRunner();
  ctx.processRunners.push(runProcessRunner);
  services.testExecutionService = new DefaultTestExecutionService(
    hubSettingsService,
    services.suiteService,
    services.useCaseService,
    runProcessRunner,
    absoluteFs,
    commandSafety,
    eventBus,
    logger,
  );

  // Single run-launch surface shared by the command palette and the explorer /
  // Test Console buttons (Wave B). It reveals the live Test Console BEFORE
  // execute() publishes and surfaces RUN_IN_PROGRESS / errors as Notices.
  services.runLauncher = new RunLauncher(services.testExecutionService, {
    openConsole: () => workspaceAdapter.openView(TEST_CONSOLE_VIEW_TYPE, "sidebar"),
  });

  // EPIC-008 Reporting & Evidence (UC-016): import the runner's JSON report and
  // generate linked Markdown evidence once a run finishes.
  const reportParser = new CucumberJsonReportParser();
  services.reportImportService = new DefaultReportImportService(
    hubSettingsService,
    absoluteFs,
    reportParser,
    eventBus,
    logger,
  );
  const scenarioIdentityResolver = new ScenarioIdentityResolver(vault, logger);
  services.evidenceGenerationService = new DefaultEvidenceGenerationService(
    hubSettingsService,
    vault,
    services.useCaseService,
    eventBus,
    logger,
  );

  // EPIC-014 (US-057): per-scenario run history. Records a committed per-run
  // NDJSON log + a regenerable .testrunner index that the Use Case roll-up reads
  // (ADR-0022). Rebuilt from the committed logs on load so a git-pulled history
  // surfaces without a fresh run.
  services.scenarioHistoryService = new DefaultScenarioHistoryService(
    hubSettingsService,
    vault,
    absoluteFs,
    eventBus,
    logger,
  );
  void services.scenarioHistoryService.rebuildIndex().catch((error: unknown) =>
    logger.warn("Scenario history index rebuild on load failed", {
      reason: (error as Error).message,
    }),
  );

  // EPIC-009 Dashboard (UC-018): aggregate the Use Case index into KPI counts +
  // recent runs for the live Test Hub Dashboard. The roll-up derives the
  // automation status from per-scenario history (US-057).
  services.traceabilityService = new DefaultTraceabilityService(
    services.useCaseService,
    vault,
    eventBus,
    logger,
    services.scenarioHistoryService,
  );
  services.runHistoryService = new DefaultRunHistoryService(hubSettingsService, vault, logger);

  // After a run reaches a terminal state (EN-2), the coordinator reacts to the
  // bus event and runs import → evidence → dashboard refresh for the just-
  // finished run, serialized so back-to-back runs can't clobber each other.
  services.postRunCoordinator = new PostRunCoordinator({
    reportImportService: services.reportImportService,
    evidenceGenerationService: services.evidenceGenerationService,
    scenarioIdentityResolver,
    scenarioHistoryService: services.scenarioHistoryService,
    traceabilityService: services.traceabilityService,
    eventBus,
    logger,
    lastRun: () => services.testExecutionService.lastRun(),
    activeRunId: () => services.testExecutionService.activeRunId(),
    whenActiveSettles: () => services.testExecutionService.whenActiveSettles(),
    isEvidenceMarkdownEnabled: () => ctx.getSettings().automation.generateEvidenceMarkdown,
  });
  services.postRunCoordinator.start();

  // Guided Tour (spec 2026-06-11): observes the user's real actions on the bus
  // and advances the onboarding checklist whether or not the view is open.
  services.guidedTourService = new DefaultGuidedTourService(
    {
      getSettings: () => ctx.getSettings(),
      updateSettings: (next) => ctx.updateSettings(next),
    },
    eventBus,
    logger,
    {
      demoUseCaseId: DEMO_USE_CASE_ID,
      demoFeatureFileName: DEMO_FEATURE_FILE_NAME,
      defaultSuiteIds: DEFAULT_SUITES.map((suite) => suite.id),
    },
  );
  services.guidedTourService.start();

  return services;
};
