import { Plugin } from "obsidian";

import { DefaultDemoContentService } from "./application/services/demo-content-service";
import { DefaultDocumentationGenerationService } from "./application/services/documentation-generation-service";
import {
  DefaultInitializationService,
  type InitializationService,
} from "./application/services/initialization-service";
import {
  DefaultSettingsService,
  type SettingsService,
} from "./application/services/settings-service";
import { DefaultSuiteService } from "./application/services/suite-service";
import { DefaultPathSafetyPolicy } from "./domain/policies/path-safety-policy";
import { DEFAULT_SETTINGS, type TestHubSettings } from "./domain/settings/settings";
import { ObsidianDataStore } from "./infrastructure/obsidian/obsidian-data-store";
import { ObsidianVaultAdapter } from "./infrastructure/obsidian/obsidian-vault-adapter";
import { ObsidianWorkspaceAdapter } from "./infrastructure/obsidian/obsidian-workspace-adapter";
import { TestHubSettingTab, type SettingsHost } from "./presentation/settings/settings-tab";
import { InitializationWizardModal } from "./presentation/views/initialization-wizard-modal";
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
    this.initializationService = new DefaultInitializationService(
      this.hubSettingsService,
      vault,
      documentation,
      suites,
      demo,
      pathSafety,
      eventBus,
      this.logger,
    );

    this.addSettingTab(new TestHubSettingTab(this, this));

    this.addRibbonIcon("flask-conical", "Initialize Test Hub", () => this.openWizard());
    this.addCommand({
      id: "initialize-test-hub",
      name: "Initialize Test Hub",
      callback: () => this.openWizard(),
    });

    this.logger.info("E2E Test Hub loaded");
  }

  async onunload(): Promise<void> {
    this.logger?.info("E2E Test Hub unloaded");
  }

  private openWizard(): void {
    new InitializationWizardModal(this.app, {
      initialization: this.initializationService,
      workspace: this.workspaceAdapter,
      getSettings: () => this.hubSettings,
    }).open();
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
