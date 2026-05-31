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
import { DefaultRunnerInstallationService } from "./application/services/runner-installation-service";
import {
  DefaultSettingsService,
  type SettingsService,
} from "./application/services/settings-service";
import { DefaultSuiteService } from "./application/services/suite-service";
import {
  DefaultUseCaseService,
  type UseCaseService,
} from "./application/services/use-case-service";
import { DefaultCommandSafetyPolicy } from "./domain/policies/command-safety-policy";
import { DefaultPathSafetyPolicy } from "./domain/policies/path-safety-policy";
import { DEFAULT_SETTINGS, type TestHubSettings } from "./domain/settings/settings";
import { NodeAbsoluteFileSystem } from "./infrastructure/filesystem/node-absolute-file-system";
import { ObsidianDataStore } from "./infrastructure/obsidian/obsidian-data-store";
import { ObsidianVaultAdapter } from "./infrastructure/obsidian/obsidian-vault-adapter";
import { ObsidianWorkspaceAdapter } from "./infrastructure/obsidian/obsidian-workspace-adapter";
import { NodeChildProcessRunner } from "./infrastructure/runner/node-child-process-runner";
import { RunnerTemplateWriter } from "./infrastructure/runner/runner-template-writer";
import { TestHubSettingTab, type SettingsHost } from "./presentation/settings/settings-tab";
import { CreateUseCaseModal } from "./presentation/views/create-use-case-modal";
import { InitializationWizardModal } from "./presentation/views/initialization-wizard-modal";
import {
  USE_CASE_VIEW_TYPE,
  UseCaseDashboardView,
} from "./presentation/views/use-case-dashboard-view";
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
  private workspaceAdapter!: ObsidianWorkspaceAdapter;

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
    this.workspaceAdapter = new ObsidianWorkspaceAdapter(this.app);

    const documentation = new DefaultDocumentationGenerationService(
      this.hubSettingsService,
      vault,
      eventBus,
    );
    const suites = new DefaultSuiteService(this.hubSettingsService, vault, eventBus);
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

    this.logger.info("E2E Test Hub loaded");
  }

  async onunload(): Promise<void> {
    this.app.workspace.detachLeavesOfType(USE_CASE_VIEW_TYPE);
    this.logger?.info("E2E Test Hub unloaded");
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
