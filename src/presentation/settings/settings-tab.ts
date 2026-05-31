import { Notice, type Plugin, PluginSettingTab, Setting } from "obsidian";
import type { Result } from "../../shared/result/result";
import type {
  TestHubPathSettings,
  TestHubSettings,
} from "../../domain/settings/settings";

/** What the settings tab needs from the plugin to read/persist settings. */
export interface SettingsHost {
  getSettings(): TestHubSettings;
  updateSettings(next: TestHubSettings): Promise<Result<void>>;
  resetSettings(): Promise<void>;
}

interface PathFieldSpec {
  key: keyof TestHubPathSettings;
  name: string;
  desc: string;
}

const PATH_FIELDS: PathFieldSpec[] = [
  { key: "testHubPath", name: "Test Hub folder", desc: "Dashboard and documentation." },
  { key: "useCasesPath", name: "Use Cases folder", desc: "Business-facing Use Case notes." },
  { key: "specificationsPath", name: "Specifications folder", desc: "Specification notes." },
  { key: "featureFilesPath", name: "Feature files folder", desc: "Gherkin `.feature` files." },
  { key: "testSuitesPath", name: "Test Suites folder", desc: "Tag-driven suite notes." },
  { key: "evidencePath", name: "Test Evidence folder", desc: "Audit trail for each run." },
  { key: "testRunnerPath", name: "Runner folder", desc: "The self-contained `.testrunner`." },
];

/** Edit paths, validate, reset (US-003, BBV §4 `SettingsTab`). */
export class TestHubSettingTab extends PluginSettingTab {
  constructor(plugin: Plugin, private readonly host: SettingsHost) {
    super(plugin.app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const settings = this.host.getSettings();

    containerEl.createEl("h2", { text: "E2E Test Hub" });

    new Setting(containerEl).setName("Folders").setHeading();
    for (const field of PATH_FIELDS) {
      new Setting(containerEl)
        .setName(field.name)
        .setDesc(field.desc)
        .addText((text) =>
          text
            .setPlaceholder(field.key)
            .setValue(settings.paths[field.key])
            .onChange(async (value) => {
              await this.persistPath(field.key, value.trim());
            }),
        );
    }

    new Setting(containerEl).setName("Maintenance").setHeading();
    new Setting(containerEl)
      .setName("Reset to defaults")
      .setDesc("Restore the shipped configuration. Does not delete vault content.")
      .addButton((button) =>
        button
          .setButtonText("Reset")
          .setWarning()
          .onClick(async () => {
            await this.host.resetSettings();
            new Notice("Settings reset to defaults.");
            this.display();
          }),
      );
  }

  private async persistPath(
    key: keyof TestHubPathSettings,
    value: string,
  ): Promise<void> {
    const current = this.host.getSettings();
    const next: TestHubSettings = {
      ...current,
      paths: { ...current.paths, [key]: value },
    };
    const result = await this.host.updateSettings(next);
    if (!result.ok) {
      new Notice(`Invalid setting: ${result.error.message}`);
    }
  }
}
