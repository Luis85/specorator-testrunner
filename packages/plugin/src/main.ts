import { App, Plugin, PluginSettingTab, Setting } from "obsidian";

interface SpecoratorSettings {
  defaultEnvironment: string;
  /** Path to the installed engine sidecar (resolved during setup). */
  enginePath: string;
}

const DEFAULT_SETTINGS: SpecoratorSettings = {
  defaultEnvironment: "staging",
  enginePath: "",
};

export default class SpecoratorPlugin extends Plugin {
  settings: SpecoratorSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();

    // Render the ```gherkin code fence (syntax + Run button + status pill).
    // TODO(phase-1): replace the passive render with an interactive Run control.
    this.registerMarkdownCodeBlockProcessor("gherkin", (source, el) => {
      const pre = el.createEl("pre", { cls: "specorator-gherkin" });
      pre.createEl("code", { text: source });
    });

    this.addCommand({
      id: "run-current-test-case",
      name: "Run current test case",
      callback: () => {
        // TODO(phase-1): spawn the engine sidecar and run the active note.
        console.log("Specorator: run current test case (not implemented yet)");
      },
    });

    this.addSettingTab(new SpecoratorSettingTab(this.app, this));
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

class SpecoratorSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: SpecoratorPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Default environment")
      .setDesc("Environment from Environments.md used when a case doesn't specify one.")
      .addText((text) =>
        text
          .setPlaceholder("staging")
          .setValue(this.plugin.settings.defaultEnvironment)
          .onChange(async (value) => {
            this.plugin.settings.defaultEnvironment = value;
            await this.plugin.saveSettings();
          }),
      );
  }
}
