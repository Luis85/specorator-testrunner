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
  DefaultReportImportService,
  type ReportImportService,
} from "./application/services/report-import-service";
import { PostRunCoordinator } from "./application/services/post-run-coordinator";
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
  type ExecuteTestRequest,
  type TestExecutionService,
} from "./application/services/test-execution-service";
import {
  DefaultUseCaseService,
  type UseCaseService,
} from "./application/services/use-case-service";
import { DefaultCommandSafetyPolicy } from "./domain/policies/command-safety-policy";
import { DefaultPathSafetyPolicy } from "./domain/policies/path-safety-policy";
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
import { TestHubSettingTab, type SettingsHost } from "./presentation/settings/settings-tab";
import { CreateSuiteModal } from "./presentation/views/create-suite-modal";
import { CreateUseCaseModal } from "./presentation/views/create-use-case-modal";
import { GenerateFeatureModal } from "./presentation/views/generate-feature-modal";
import { InitializationWizardModal } from "./presentation/views/initialization-wizard-modal";
import { SUITE_VIEW_TYPE, SuiteDashboardView } from "./presentation/views/suite-dashboard-view";
import { RunPickerModal } from "./presentation/views/run-picker-modal";
import { TEST_CONSOLE_VIEW_TYPE, TestConsoleView } from "./presentation/views/test-console-view";
import {
  USE_CASE_VIEW_TYPE,
  UseCaseDashboardView,
} from "./presentation/views/use-case-dashboard-view";
import { DASHBOARD_VIEW_TYPE, DashboardView } from "./presentation/views/dashboard-view";
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
  private stepDefinitionService!: StepDefinitionService;
  private suiteService!: SuiteService;
  private testExecutionService!: TestExecutionService;
  private reportImportService!: ReportImportService;
  private evidenceGenerationService!: EvidenceGenerationService;
  private traceabilityService!: TraceabilityService;
  private vaultAdapter!: ObsidianVaultAdapter;
  private workspaceAdapter!: ObsidianWorkspaceAdapter;
  // In-process post-run flow (P2-1/P2-6/P2-7). Subscribes to the EN-2 terminal
  // run events and runs import→evidence→dashboard-refresh, owning the `lastRun`
  // state, the run-status eligibility rule, and the serializing evidence chain
  // that used to live here.
  private postRunCoordinator!: PostRunCoordinator;

  async onload(): Promise<void> {
    const eventBus = new InMemoryEventBus((error) =>
      this.logger?.error("Event handler failed", error as Error),
    );
    const pathSafety = new DefaultPathSafetyPolicy();
    const dataStore = new ObsidianDataStore(this);

    // The logger is built first so SettingsService.load() can report a tampered
    // path (P0-1) and so it exists before any settings/secrets are known. Its
    // value-based redaction set (ADR-0019) is populated from the loaded SUT
    // credentials immediately after load and refreshed on every settings change
    // (P0-2). Reconstructed once the persisted log level is known.
    const consoleLogger = new ConsoleLogger("info");
    this.logger = consoleLogger;
    this.hubSettingsService = new DefaultSettingsService(
      dataStore,
      pathSafety,
      eventBus,
      this.logger,
    );
    this.hubSettings = await this.hubSettingsService.load();
    this.logger = new ConsoleLogger(this.hubSettings.logging.level);
    this.refreshLoggerSecrets();

    const vault = new ObsidianVaultAdapter(this.app);
    this.vaultAdapter = vault;
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
    // Guard repair() against an active run (P0-3). The execution service is
    // built further down, so delegate lazily through `this`.
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
    this.testExecutionService = new DefaultTestExecutionService(
      this.hubSettingsService,
      this.suiteService,
      this.useCaseService,
      new NodeChildProcessRunner(),
      absoluteFs,
      commandSafety,
      eventBus,
      this.logger,
    );

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
      isEvidenceMarkdownEnabled: () => this.hubSettings.automation.generateEvidenceMarkdown,
    });
    this.postRunCoordinator.start();

    this.registerView(
      USE_CASE_VIEW_TYPE,
      (leaf) =>
        new UseCaseDashboardView(leaf, {
          useCaseService: this.useCaseService,
          workspace: this.workspaceAdapter,
          eventBus,
          onCreate: () => this.openCreateUseCase(),
        }),
    );
    this.registerView(
      SUITE_VIEW_TYPE,
      (leaf) =>
        new SuiteDashboardView(leaf, {
          suiteService: this.suiteService,
          workspace: this.workspaceAdapter,
          eventBus,
          onCreate: () => this.openCreateSuite(),
        }),
    );
    this.registerView(TEST_CONSOLE_VIEW_TYPE, (leaf) => new TestConsoleView(leaf, eventBus));
    this.registerView(
      DASHBOARD_VIEW_TYPE,
      (leaf) =>
        new DashboardView(leaf, {
          traceabilityService: this.traceabilityService,
          eventBus,
          openDocumentation: (documentType) => this.openDocumentation(documentType),
        }),
    );

    this.addSettingTab(new TestHubSettingTab(this, this));

    this.addRibbonIcon("flask-conical", "Initialize Test Hub", () => this.openWizard());
    this.addCommand({
      id: "initialize-test-hub",
      name: "Initialize Test Hub",
      callback: () => this.openWizard(),
    });
    this.addCommand({
      id: "validate-environment",
      name: "Validate Environment",
      callback: () => void this.validateEnvironment(),
    });
    this.addCommand({
      id: "repair-installation",
      name: "Repair Installation",
      callback: () => void this.repairInstallation(),
    });
    this.addCommand({
      id: "generate-ci-workflow",
      name: "Generate CI Workflow",
      callback: () => void this.generateCiWorkflow(),
    });
    this.addCommand({
      id: "overwrite-ci-workflow",
      name: "Overwrite CI Workflow",
      callback: () => void this.generateCiWorkflow(true),
    });
    this.addCommand({
      id: "check-ci-readiness",
      name: "Check CI Readiness",
      callback: () => void this.checkCiReadiness(),
    });
    this.addCommand({
      id: "create-use-case",
      name: "Create Use Case",
      callback: () => this.openCreateUseCase(),
    });
    this.addCommand({
      id: "open-use-cases",
      name: "Open Use Cases",
      callback: () => void this.workspaceAdapter.openView(USE_CASE_VIEW_TYPE),
    });
    this.addRibbonIcon(
      "list-checks",
      "Open Use Cases",
      () => void this.workspaceAdapter.openView(USE_CASE_VIEW_TYPE),
    );
    this.addCommand({
      id: "create-test-suite",
      name: "Create Test Suite",
      callback: () => this.openCreateSuite(),
    });
    this.addCommand({
      id: "open-test-suites",
      name: "Open Test Suites",
      callback: () => void this.workspaceAdapter.openView(SUITE_VIEW_TYPE),
    });
    this.addRibbonIcon(
      "layers",
      "Open Test Suites",
      () => void this.workspaceAdapter.openView(SUITE_VIEW_TYPE),
    );
    this.addCommand({
      id: "generate-feature",
      name: "Generate Feature from Use Case",
      callback: () => void this.openGenerateFeature(),
    });
    this.addCommand({
      id: "validate-feature",
      name: "Validate Feature",
      callback: () => void this.validateActiveFeature(),
    });
    this.addCommand({
      id: "detect-missing-steps",
      name: "Detect Missing Steps",
      callback: () => void this.detectMissingSteps(),
    });
    // UC-010 / RV-4: explicit user command (NOT auto-on-edit) — detect the
    // active feature's missing steps, then generate non-destructive stubs.
    this.addCommand({
      id: "generate-step-definitions",
      name: "Generate Step Definitions",
      callback: () => void this.generateStepDefinitions(),
    });

    // EPIC-007 Test Execution (US-026/027/028/029/030).
    this.addCommand({
      id: "run-demo-test",
      name: "Run Demo Test",
      callback: () => void this.runTest({ scope: "demo", target: "demo" }),
    });
    this.addCommand({
      id: "run-all-tests",
      name: "Run All Tests",
      callback: () => void this.runTest({ scope: "all", target: "all" }),
    });
    this.addCommand({
      id: "run-suite",
      name: "Run Suite…",
      callback: () => void this.runSuite(),
    });
    this.addCommand({
      id: "run-use-case",
      name: "Run Use Case…",
      callback: () => void this.runUseCase(),
    });
    this.addCommand({
      id: "run-feature",
      name: "Run Feature…",
      callback: () => void this.runFeature(),
    });
    this.addCommand({
      id: "cancel-test-run",
      name: "Cancel Test Run",
      callback: () => void this.cancelTestRun(),
    });
    this.addCommand({
      id: "open-test-console",
      name: "Open Test Console",
      callback: () => void this.workspaceAdapter.openView(TEST_CONSOLE_VIEW_TYPE),
    });

    // EPIC-008 (US-032 / UC-016): re-run report import + evidence for the last run.
    this.addCommand({
      id: "import-report-last-run",
      name: "Import Report for Last Run",
      callback: () => void this.importLastRun(),
    });
    this.addRibbonIcon(
      "terminal",
      "Open Test Console",
      () => void this.workspaceAdapter.openView(TEST_CONSOLE_VIEW_TYPE),
    );

    // EPIC-009 Dashboard (UC-018).
    this.addCommand({
      id: "open-dashboard",
      name: "Open Dashboard",
      callback: () => void this.workspaceAdapter.openView(DASHBOARD_VIEW_TYPE),
    });
    this.addRibbonIcon(
      "gauge",
      "Open Test Hub Dashboard",
      () => void this.workspaceAdapter.openView(DASHBOARD_VIEW_TYPE),
    );

    // EPIC-011 Documentation (FEAT-024 US-043/044/045, FEAT-025 US-046).
    this.addCommand({
      id: "generate-documentation",
      name: "Generate Documentation",
      callback: () => void this.generateDocumentation(),
    });
    this.addCommand({
      id: "open-documentation",
      name: "Open Documentation",
      callback: () => void this.openDocumentation(),
    });
    this.addCommand({
      id: "open-user-manual",
      name: "Open User Manual",
      callback: () => void this.openDocumentation("manual"),
    });
    this.addCommand({
      id: "open-troubleshooting",
      name: "Open Troubleshooting",
      callback: () => void this.openDocumentation("troubleshooting"),
    });

    this.logger.info("E2E Test Hub loaded");
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
    // settle before mutating settings (resetSettings); onunload is best-effort
    // synchronous per PRES-H1, and the per-run snapshot already protects
    // attribution, so we do not block teardown on whenSettled() here.
    this.postRunCoordinator?.stop();
    // registerView + each view's onClose already tear the views down on unload;
    // detachLeavesOfType is explicitly discouraged (it destroys the user's saved
    // workspace layout across reloads/updates), so it is intentionally NOT called
    // here (P1-3 / PRES-H2).
    this.logger?.info("E2E Test Hub unloaded");
  }

  /**
   * Starts a run, revealing the live Test Console first so output streams in
   * (US-030, UC-015). ADR-0018 surfaces `RUN_IN_PROGRESS` as a Notice with the
   * active run id so the user can cancel it.
   */
  private async runTest(request: ExecuteTestRequest): Promise<void> {
    // Reveal the live console FIRST so it is subscribed to testrun.started /
    // output events before execute() publishes them (the bus doesn't replay).
    // The single-active slot is reserved synchronously inside execute(), and the
    // service owns the cancel-and-wait completion (whenActiveSettles), so onunload
    // no longer needs to track the run promise here.
    await this.workspaceAdapter.openView(TEST_CONSOLE_VIEW_TYPE);
    const result = await this.testExecutionService.execute(request);
    if (!result.ok) {
      // `details` is typed `Record<string, unknown>`, so `activeRunId` widens
      // to `unknown`; at runtime it is always the active run's id string.
      const active =
        typeof result.error.details?.activeRunId === "string"
          ? result.error.details.activeRunId
          : "";
      new Notice(
        active
          ? `A run is already in progress (${active}). Cancel it first.`
          : `Could not start run: ${result.error.message}`,
        10000,
      );
      return;
    }
    // The PostRunCoordinator reacts to the terminal run event (EN-2) and runs
    // import → evidence → dashboard refresh for the finished run; runTest no
    // longer imports here, so the flow happens exactly once (no double-process).
  }

  /**
   * Re-runs report import + evidence for the last finished run on demand
   * (UC-016, US-032). The eligibility rule and serialization live in the
   * coordinator; this surfaces its typed outcome as a Notice.
   */
  private async importLastRun(): Promise<void> {
    const result = await this.postRunCoordinator.importLastRun();
    if (!result.ok) {
      new Notice(`Report import failed: ${result.error.message}`, 10000);
      return;
    }
    switch (result.value.kind) {
      case "imported":
        new Notice(`Evidence written to ${result.value.evidencePath}`);
        break;
      case "recorded":
        new Notice("Last run recorded (evidence Markdown generation is disabled).");
        break;
      case "no-run":
        new Notice("No test run to import a report for yet.");
        break;
      case "run-in-progress":
        new Notice("A test run is in progress; import its report once it finishes.");
        break;
      case "ineligible":
        new Notice(`The last run (${result.value.status}) produced no report to import.`);
        break;
    }
  }

  private async runSuite(): Promise<void> {
    const suites = await this.suiteService.findAll();
    if (!suites.ok) {
      new Notice(`Could not load Test Suites: ${suites.error.message}`, 10000);
      return;
    }
    if (suites.value.length === 0) {
      new Notice("No Test Suites found. Create one first.");
      return;
    }
    new RunPickerModal(
      this.app,
      "Select a Test Suite to run",
      suites.value.map((s) => ({ id: s.id, label: `${s.id} — ${s.name}` })),
      (id) => void this.runTest({ scope: "suite", target: id }),
    ).open();
  }

  private async runUseCase(): Promise<void> {
    const useCases = await this.useCaseService.findAll();
    if (!useCases.ok) {
      new Notice(`Could not load Use Cases: ${useCases.error.message}`, 10000);
      return;
    }
    if (useCases.value.length === 0) {
      new Notice("No Use Cases found. Create one first.");
      return;
    }
    new RunPickerModal(
      this.app,
      "Select a Use Case to run",
      useCases.value.map((u) => ({ id: u.id, label: `${u.id} — ${u.title}` })),
      (id) => void this.runTest({ scope: "use-case", target: id }),
    ).open();
  }

  private async runFeature(): Promise<void> {
    const folder = this.hubSettings.paths.featureFilesPath;
    const listed = await this.vaultAdapter.listFilesRecursive(folder);
    if (!listed.ok) {
      new Notice(`Could not list Feature files: ${listed.error.message}`, 10000);
      return;
    }
    const features = listed.value.filter((p) => p.endsWith(".feature"));
    if (features.length === 0) {
      new Notice("No Feature files found. Generate one first.");
      return;
    }
    new RunPickerModal(
      this.app,
      "Select a Feature file to run",
      features.map((path) => ({ id: path, label: path.slice(folder.length + 1) })),
      (path) => void this.runTest({ scope: "feature", target: path }),
    ).open();
  }

  private async cancelTestRun(): Promise<void> {
    const active = this.testExecutionService.activeRunId();
    if (active === null) {
      new Notice("No test run is in progress.");
      return;
    }
    const result = await this.testExecutionService.cancel(active);
    new Notice(
      result.ok ? "Test run cancelled." : `Could not cancel run: ${result.error.message}`,
      result.ok ? undefined : 10000,
    );
  }

  private openWizard(): void {
    new InitializationWizardModal(this.app, {
      initialization: this.initializationService,
      workspace: this.workspaceAdapter,
      getSettings: () => this.hubSettings,
    }).open();
  }

  private openCreateUseCase(): void {
    new CreateUseCaseModal(this.app, {
      useCaseService: this.useCaseService,
      workspace: this.workspaceAdapter,
    }).open();
  }

  private openCreateSuite(): void {
    new CreateSuiteModal(this.app, {
      suiteService: this.suiteService,
      workspace: this.workspaceAdapter,
    }).open();
  }

  private async openGenerateFeature(): Promise<void> {
    const useCases = await this.useCaseService.findAll();
    if (!useCases.ok) {
      new Notice(`Could not load Use Cases: ${useCases.error.message}`, 10000);
      return;
    }
    if (useCases.value.length === 0) {
      new Notice("No Use Cases found. Create one first.");
      return;
    }
    new GenerateFeatureModal(
      this.app,
      {
        useCaseService: this.useCaseService,
        specificationService: this.specificationService,
        workspace: this.workspaceAdapter,
      },
      useCases.value,
    ).open();
  }

  /** Path of the active note, or a Notice when there is no feature open. */
  private activeFeaturePath(): string | null {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "feature") {
      new Notice("Open a .feature file first.");
      return null;
    }
    return file.path;
  }

  private async validateActiveFeature(): Promise<void> {
    const path = this.activeFeaturePath();
    if (path === null) return;
    const result = await this.specificationService.validate(path);
    if (!result.ok) {
      new Notice(`Validation failed: ${result.error.message}`, 10000);
      return;
    }
    new Notice(
      result.value.valid
        ? "Feature is valid."
        : `Feature has ${result.value.errors.length} issue(s): ${result.value.errors
            .map((e) => e.message)
            .join("; ")}`,
      result.value.valid ? undefined : 10000,
    );
  }

  private async detectMissingSteps(): Promise<void> {
    const path = this.activeFeaturePath();
    if (path === null) return;
    const result = await this.specificationService.detectMissingSteps(path);
    if (!result.ok) {
      new Notice(`Detection failed: ${result.error.message}`, 10000);
      return;
    }
    new Notice(
      result.value.missingSteps.length === 0
        ? "All steps are defined."
        : `${result.value.missingSteps.length} missing step(s): ${result.value.missingSteps.join(
            "; ",
          )}`,
      10000,
    );
  }

  /**
   * UC-010 / RV-4: detect the active feature's undefined steps via
   * `SpecificationService`, then generate non-destructive step-definition stubs
   * via `StepDefinitionService`. Generation is an explicit user command (not
   * auto-on-every-edit); the detection event's id is threaded through as the
   * `causationId` of `stepdefinition.generated` (Event Catalog §5), so a future
   * auto-path can reuse the same wiring. Logic lives in the services — this only
   * orchestrates the two calls and surfaces the outcome as a Notice.
   */
  private async generateStepDefinitions(): Promise<void> {
    const path = this.activeFeaturePath();
    if (path === null) return;
    const detected = await this.specificationService.detectMissingSteps(path);
    if (!detected.ok) {
      new Notice(`Detection failed: ${detected.error.message}`, 10000);
      return;
    }
    if (detected.value.missingSteps.length === 0) {
      new Notice("No missing steps — nothing to generate.");
      return;
    }
    const generated = await this.stepDefinitionService.generate(
      path,
      detected.value.missingSteps,
      detected.value.detectionEventId,
    );
    if (!generated.ok) {
      new Notice(`Could not generate step definitions: ${generated.error.message}`, 10000);
      return;
    }
    const count = generated.value.generatedSteps.length;
    new Notice(
      count === 0
        ? "No missing steps — nothing to generate."
        : `Generated ${count} step stub(s) in ${generated.value.stepFile}.`,
    );
  }

  private async validateEnvironment(): Promise<void> {
    new Notice("Validating environment…");
    const result = await this.validationService.validateEnvironment();
    new Notice(
      result.valid
        ? "Environment is ready."
        : `Environment has ${result.issues.length} issue(s): ${result.issues
            .map((issue) => issue.message)
            .join("; ")}`,
      result.valid ? undefined : 10000,
    );
  }

  private async repairInstallation(): Promise<void> {
    new Notice("Repairing runner installation…");
    const result = await this.maintenanceService.repair();
    if (result.ok) {
      new Notice(`Runner repaired: ${result.value.repairedFiles.length} file(s) re-synced.`);
    } else {
      new Notice(`Repair failed: ${result.error.message}`, 10000);
    }
  }

  // EPIC-010 CI/CD (US-040, UC-019): write the GitHub Actions workflow into the
  // user's repo. UI is thin — the generate/overwrite policy lives in the service.
  private async generateCiWorkflow(overwriteExisting = false): Promise<void> {
    new Notice(overwriteExisting ? "Overwriting CI workflow…" : "Generating CI workflow…");
    const result = await this.pipelineService.generate({
      provider: this.hubSettings.ci.provider,
      settings: this.hubSettings,
      overwriteExisting,
    });
    if (result.ok) {
      new Notice(`CI workflow written to ${result.value.path}.`);
    } else if (!overwriteExisting && result.error.details?.path) {
      // The file exists; make the documented overwrite flow reachable (UC-019).
      new Notice(`${result.error.message} Use "Overwrite CI Workflow" to replace it.`, 10000);
    } else {
      new Notice(`Could not generate CI workflow: ${result.error.message}`, 10000);
    }
  }

  // US-041 / UC-020: report whether the repo is ready for CI.
  private async checkCiReadiness(): Promise<void> {
    new Notice("Checking CI readiness…");
    const result = await this.validationService.validateCiReadiness(this.hubSettings);
    // Spell out the warnings (e.g. which repository secrets to create), not just
    // a count — this Notice is the only UI surface for the readiness result.
    const warnings = result.warnings.length > 0 ? `\nWarnings: ${result.warnings.join("; ")}` : "";
    if (result.ready) {
      new Notice(`CI is ready.${warnings}`, warnings ? 10000 : undefined);
    } else {
      new Notice(`CI not ready — missing: ${result.missingItems.join("; ")}${warnings}`, 10000);
    }
  }

  // EPIC-011 FEAT-024 (US-043/044/045, UC-021/022/023): write the document set
  // into the vault's documentation folder and emit `documentation.generated`.
  private async generateDocumentation(): Promise<void> {
    new Notice("Generating Test Hub documentation…");
    const result = await this.documentationService.generate();
    if (result.ok) {
      new Notice(`Documentation generated (${result.value.documents.length} note(s)).`);
    } else {
      new Notice(`Could not generate documentation: ${result.error.message}`, 10000);
    }
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

  // --- SettingsHost --------------------------------------------------------

  getSettings(): TestHubSettings {
    return this.hubSettings;
  }

  async updateSettings(next: TestHubSettings): Promise<Result<void>> {
    const result = await this.hubSettingsService.save(next);
    if (result.ok) {
      this.hubSettings = next;
      // New/changed SUT credentials must start being scrubbed immediately
      // (ADR-0019 value-based redaction, P0-2 / T3).
      this.refreshLoggerSecrets();
      this.logger.info("Settings updated");
    }
    return result;
  }

  async resetSettings(): Promise<void> {
    // A reset overwrites settings/credentials; refuse while a run is active so
    // it can't redirect evidence writes or swap credentials mid-run (P0-3).
    if (this.testExecutionService.activeRunId() !== null) {
      new Notice("A test run is in progress; cancel it before resetting settings.", 10000);
      return;
    }
    // Let the active-run completion + in-flight evidence writes settle before
    // mutating settings (defensive: the guard above already covers the common
    // case, but evidence I/O outlives the active slot — see evidenceChain).
    await this.testExecutionService.whenActiveSettles().catch(() => undefined);
    // The active-run completion frees the slot before evidence I/O finishes, so
    // also let the coordinator's in-flight import/evidence chain settle (it
    // writes Use Case frontmatter) before mutating settings (P0-3).
    await this.postRunCoordinator.whenSettled();
    const result = await this.hubSettingsService.reset();
    if (result.ok) {
      this.hubSettings = result.value;
      this.refreshLoggerSecrets();
    }
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
