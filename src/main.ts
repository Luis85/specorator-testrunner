import { Notice, Plugin } from "obsidian";

import { DefaultDemoContentService } from "./application/services/demo-content-service";
import { DefaultDocumentationGenerationService } from "./application/services/documentation-generation-service";
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
  DefaultEvidenceGenerationService,
  type EvidenceGenerationService,
} from "./application/services/evidence-generation-service";
import {
  DefaultReportImportService,
  type ReportImportService,
} from "./application/services/report-import-service";
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
  DefaultSuiteService,
  type SuiteService,
} from "./application/services/suite-service";
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
import type { TestRun } from "./domain/entities/test-run";
import { DEFAULT_SETTINGS, type TestHubSettings } from "./domain/settings/settings";
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
import {
  SUITE_VIEW_TYPE,
  SuiteDashboardView,
} from "./presentation/views/suite-dashboard-view";
import { RunPickerModal } from "./presentation/views/run-picker-modal";
import {
  TEST_CONSOLE_VIEW_TYPE,
  TestConsoleView,
} from "./presentation/views/test-console-view";
import {
  USE_CASE_VIEW_TYPE,
  UseCaseDashboardView,
} from "./presentation/views/use-case-dashboard-view";
import {
  DASHBOARD_VIEW_TYPE,
  DashboardView,
} from "./presentation/views/dashboard-view";
import { InMemoryEventBus } from "./shared/event-bus/event-bus";
import { ConsoleLogger, type Logger } from "./shared/logging/logger";
import type { Result } from "./shared/result/result";

/**
 * Composition root for the E2E Test Hub plugin. Instantiates the layered
 * graph (Shared Kernel → Domain → Application → Infrastructure → Presentation)
 * and registers the Obsidian surfaces.
 */
export default class E2ETestHubPlugin extends Plugin implements SettingsHost {
  private hubSettings: TestHubSettings = DEFAULT_SETTINGS;
  private logger!: Logger;
  private hubSettingsService!: SettingsService;
  private initializationService!: InitializationService;
  private validationService!: EnvironmentValidationService;
  private maintenanceService!: MaintenanceService;
  private useCaseService!: UseCaseService;
  private specificationService!: SpecificationService;
  private suiteService!: SuiteService;
  private testExecutionService!: TestExecutionService;
  private reportImportService!: ReportImportService;
  private evidenceGenerationService!: EvidenceGenerationService;
  private traceabilityService!: TraceabilityService;
  private vaultAdapter!: ObsidianVaultAdapter;
  private workspaceAdapter!: ObsidianWorkspaceAdapter;
  /** Last run started this session, so report import can re-run on demand. */
  private lastRun: TestRun | null = null;
  /** In-flight run completion, so unload can await the process actually exiting. */
  private activeRunTest: Promise<void> | null = null;

  async onload(): Promise<void> {
    const eventBus = new InMemoryEventBus((error) =>
      this.logger?.error("Event handler failed", error as Error),
    );
    const pathSafety = new DefaultPathSafetyPolicy();
    const dataStore = new ObsidianDataStore(this);

    this.hubSettingsService = new DefaultSettingsService(dataStore, pathSafety, eventBus);
    this.hubSettings = await this.hubSettingsService.load();
    this.logger = new ConsoleLogger(this.hubSettings.logging.level);

    const vault = new ObsidianVaultAdapter(this.app);
    this.vaultAdapter = vault;
    this.workspaceAdapter = new ObsidianWorkspaceAdapter(this.app);

    const documentation = new DefaultDocumentationGenerationService(
      this.hubSettingsService,
      vault,
      eventBus,
    );
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
    this.maintenanceService = new DefaultMaintenanceService(
      this.hubSettingsService,
      this.validationService,
      runnerInstall,
      eventBus,
      this.logger,
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
    // After a run reaches a terminal completed/failed state, import + generate
    // evidence best-effort. Subscribers must never throw into the bus (EN-1), so
    // every fault is caught, logged, and surfaced as a Notice.

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
    this.registerView(
      TEST_CONSOLE_VIEW_TYPE,
      (leaf) => new TestConsoleView(leaf, eventBus),
    );
    this.registerView(
      DASHBOARD_VIEW_TYPE,
      (leaf) =>
        new DashboardView(leaf, {
          traceabilityService: this.traceabilityService,
          eventBus,
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
      id: "create-use-case",
      name: "Create Use Case",
      callback: () => this.openCreateUseCase(),
    });
    this.addCommand({
      id: "open-use-cases",
      name: "Open Use Cases",
      callback: () => void this.workspaceAdapter.openView(USE_CASE_VIEW_TYPE),
    });
    this.addRibbonIcon("list-checks", "Open Use Cases", () =>
      void this.workspaceAdapter.openView(USE_CASE_VIEW_TYPE),
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
    this.addRibbonIcon("layers", "Open Test Suites", () =>
      void this.workspaceAdapter.openView(SUITE_VIEW_TYPE),
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
      callback: () => {
        // A run in progress has already deleted and is reusing the fixed
        // reports path, so re-importing now would attach the active run's
        // missing/partial report to the PREVIOUS run id. Block until it settles.
        if (this.testExecutionService.activeRunId() !== null) {
          new Notice("A test run is in progress; import its report once it finishes.");
          return;
        }
        // Import for runs that can produce a report: passed/failed, and
        // cancelled (which may have flushed a valid partial report — the
        // pre-run cleanup means any report on disk is this run's). The importer
        // returns a safe logged failure when no report exists. An errored spawn
        // fault never produced one.
        if (!this.lastRun) {
          new Notice("No test run to import a report for yet.");
        } else if (
          this.lastRun.status === "passed" ||
          this.lastRun.status === "failed" ||
          this.lastRun.status === "cancelled"
        ) {
          void this.importAndGenerateEvidence(this.lastRun, true);
        } else {
          new Notice(`The last run (${this.lastRun.status}) produced no report to import.`);
        }
      },
    });
    this.addRibbonIcon("terminal", "Open Test Console", () =>
      void this.workspaceAdapter.openView(TEST_CONSOLE_VIEW_TYPE),
    );

    // EPIC-009 Dashboard (UC-018).
    this.addCommand({
      id: "open-dashboard",
      name: "Open Dashboard",
      callback: () => void this.workspaceAdapter.openView(DASHBOARD_VIEW_TYPE),
    });
    this.addRibbonIcon("gauge", "Open Test Hub Dashboard", () =>
      void this.workspaceAdapter.openView(DASHBOARD_VIEW_TYPE),
    );

    this.logger.info("E2E Test Hub loaded");
  }

  async onunload(): Promise<void> {
    // A disable/reload while a run is active would otherwise leave the runner's
    // npm/Cucumber child alive inside Obsidian with no console subscribers and
    // no command path to stop it — cancel it before tearing down the UI.
    const active = this.testExecutionService?.activeRunId() ?? null;
    if (active !== null) {
      const cancelled = await this.testExecutionService.cancel(active);
      if (!cancelled.ok) {
        this.logger?.warn("Could not cancel active run on unload", {
          runId: active,
          reason: cancelled.error.message,
        });
      }
    }
    // cancel() only signals the child; the run's execute() promise settles when
    // runStreaming observes the process close. Await the tracked in-flight run so
    // the npm/Cucumber process has actually exited (and stopped writing reports)
    // before this instance tears down and a new one could start.
    if (this.activeRunTest !== null) {
      await this.activeRunTest.catch(() => undefined);
    }
    this.app.workspace.detachLeavesOfType(USE_CASE_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(SUITE_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(TEST_CONSOLE_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(DASHBOARD_VIEW_TYPE);
    this.logger?.info("E2E Test Hub unloaded");
  }

  /**
   * Starts a run, revealing the live Test Console first so output streams in
   * (US-030, UC-015). ADR-0018 surfaces `RUN_IN_PROGRESS` as a Notice with the
   * active run id so the user can cancel it.
   */
  private runTest(request: ExecuteTestRequest): Promise<void> {
    // Track the in-flight run so onunload can await the process actually exiting
    // (cancel-and-wait shutdown), then clear the slot when it settles.
    const completion = this.executeRun(request).finally(() => {
      if (this.activeRunTest === completion) this.activeRunTest = null;
    });
    // Only adopt this as THE tracked run when none is tracked yet. An overlapping
    // Run is rejected by the service (RUN_IN_PROGRESS) and its short-lived promise
    // must not replace the real active run's promise, or onunload would have
    // nothing to await (ADR-0018 single-active).
    if (this.activeRunTest === null) this.activeRunTest = completion;
    return completion;
  }

  private async executeRun(request: ExecuteTestRequest): Promise<void> {
    // Reserve the single-active slot (execute() does so synchronously) BEFORE
    // yielding. Opening the console is fire-and-forget so a second Run command
    // can't slip in during an `await` and win the slot while runTest tracked the
    // first command's promise (the run that actually starts is the one tracked).
    void this.workspaceAdapter.openView(TEST_CONSOLE_VIEW_TYPE);
    const result = await this.testExecutionService.execute(request);
    if (!result.ok) {
      const active = result.error.details?.activeRunId;
      new Notice(
        active
          ? `A run is already in progress (${String(active)}). Cancel it first.`
          : `Could not start run: ${result.error.message}`,
        10000,
      );
      return;
    }
    this.lastRun = result.value;
    // Import the report + generate evidence for THIS finished run (UC-016).
    // Driven from the returned run — not event/instance state — so the report
    // is attributed to the correct run. A cancelled run may have flushed a valid
    // partial report (the pre-run cleanup means it can only be THIS run's), so
    // import it too; a spawn-error `errored` run never produced one. Missing/
    // invalid reports return a logged Result, so this is always safe.
    if (
      result.value.status === "passed" ||
      result.value.status === "failed" ||
      result.value.status === "cancelled"
    ) {
      await this.importAndGenerateEvidence(result.value);
    }
  }

  /**
   * Imports a finished run's Cucumber report and generates linked evidence
   * (UC-016). Never rejects — every fault is logged and (when `notify`) shown.
   */
  private async importAndGenerateEvidence(run: TestRun, notify = false): Promise<void> {
    try {
      const imported = await this.reportImportService.import(run);
      if (!imported.ok) {
        this.logger.warn("Report import failed", {
          runId: run.id,
          reason: imported.error.message,
        });
        if (notify) new Notice(`Report import failed: ${imported.error.message}`, 10000);
        return;
      }
      // Honor the opt-out: skip evidence-note generation when disabled.
      if (!this.hubSettings.automation.generateEvidenceMarkdown) {
        if (notify) new Notice("Evidence Markdown generation is disabled in settings.");
        return;
      }
      const evidence = await this.evidenceGenerationService.generate({
        run,
        report: imported.value,
      });
      if (!evidence.ok) {
        this.logger.warn("Evidence generation failed", {
          runId: run.id,
          reason: evidence.error.message,
        });
        if (notify) new Notice(`Evidence generation failed: ${evidence.error.message}`, 10000);
        return;
      }
      if (notify) new Notice(`Evidence written to ${evidence.value.path}`);
    } catch (error) {
      // The subscriber must not throw into the bus (EN-1).
      this.logger.error("Report import / evidence generation threw", error as Error);
      if (notify) new Notice("Report import / evidence generation failed unexpectedly.", 10000);
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

  // --- SettingsHost --------------------------------------------------------

  getSettings(): TestHubSettings {
    return this.hubSettings;
  }

  async updateSettings(next: TestHubSettings): Promise<Result<void>> {
    const result = await this.hubSettingsService.save(next);
    if (result.ok) {
      this.hubSettings = next;
      this.logger.info("Settings updated");
    }
    return result;
  }

  async resetSettings(): Promise<void> {
    const result = await this.hubSettingsService.reset();
    if (result.ok) this.hubSettings = result.value;
  }
}
