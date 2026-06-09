import {
  Notice,
  type Plugin,
  PluginSettingTab,
  Setting,
  type TextComponent,
  debounce,
} from "obsidian";
import type { Result } from "../../shared/result/result";
import type { TestHubPathSettings, TestHubSettings } from "../../domain/settings/settings";
import { unsafeVaultPath } from "../../domain/value-objects/vault-path";

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

/** How long to wait after the last keystroke before persisting (PRES-M1). */
const PERSIST_DEBOUNCE_MS = 600;

/** Edit paths, validate, reset (US-003, BBV §4 `SettingsTab`). */
export class TestHubSettingTab extends PluginSettingTab {
  /** Pending per-field persist debouncers, cancelled on re-render / close. */
  private readonly pendingFlushes: { cancel(): void }[] = [];

  constructor(
    plugin: Plugin,
    private readonly host: SettingsHost,
  ) {
    super(plugin.app, plugin);
  }

  /** Cancels any debounced saves still queued from a prior render (PRES-L2). */
  private cancelPendingFlushes(): void {
    for (const flush of this.pendingFlushes) flush.cancel();
    this.pendingFlushes.length = 0;
  }

  hide(): void {
    this.cancelPendingFlushes();
  }

  display(): void {
    const { containerEl } = this;
    this.cancelPendingFlushes();
    containerEl.empty();
    const settings = this.host.getSettings();

    // Glossary term is "Test Hub" (CONTEXT.md) — not "E2E Test Hub"/"test hub".
    containerEl.createEl("h2", { text: "Test Hub" });

    new Setting(containerEl).setName("Folders").setHeading();
    for (const field of PATH_FIELDS) {
      new Setting(containerEl)
        .setName(field.name)
        .setDesc(field.desc)
        .addText((text) => {
          text.setPlaceholder(field.key).setValue(settings.paths[field.key]);
          // Persisting on every keystroke spams the service (and "Invalid
          // setting" Notices) with intermediate, half-typed paths. Debounce so
          // we only validate-then-save once typing settles (PRES-M1).
          const flush = debounce(
            (value: string) => void this.persistPath(field.key, value.trim(), text),
            PERSIST_DEBOUNCE_MS,
            true,
          );
          this.pendingFlushes.push(flush);
          text.onChange((value) => flush(value));
          // Also persist immediately on blur so a quick edit + tab-away isn't
          // lost to the still-pending debounce.
          text.inputEl.addEventListener("blur", () => {
            flush.cancel();
            void this.persistPath(field.key, text.getValue().trim(), text);
          });
        });
    }

    new Setting(containerEl).setName("Maintenance").setHeading();
    new Setting(containerEl)
      .setName("Reset Test Hub")
      .setDesc(
        "Restore a clean install: remove the regenerable .testrunner runtime, restore default settings, and re-initialize. Your Use Cases, Specifications, Features, Suites and Evidence are preserved.",
      )
      .addButton((button) =>
        button
          .setButtonText("Reset")
          .setWarning()
          .onClick(async () => {
            // The Notice + re-init outcome is owned by resetSettings() (UC-024).
            await this.host.resetSettings();
            this.display();
          }),
      );
  }

  private async persistPath(
    key: keyof TestHubPathSettings,
    value: string,
    field: TextComponent,
  ): Promise<void> {
    const current = this.host.getSettings();
    // No-op if the field already matches the persisted value (e.g. a blur after
    // the debounce already saved, or an unedited blur) — avoids redundant saves.
    if (current.paths[key] === value) return;

    // The user-typed value is staged here and authoritatively validated by
    // SettingsService.save() (US-003), so it is branded, not re-validated here;
    // a rejected save leaves persisted state unchanged.
    const paths = { ...current.paths, [key]: unsafeVaultPath(value) };
    // Documentation lives inside the Test Hub folder (see the vault layout), so
    // keep documentationPath in sync rather than orphaning the generated docs
    // in the previous location.
    if (key === "testHubPath") paths.documentationPath = unsafeVaultPath(value);
    const next: TestHubSettings = { ...current, paths };
    // The service is the authoritative validator (US-003); a rejected save must
    // leave persisted state unchanged.
    const result = await this.host.updateSettings(next);
    if (!result.ok) {
      new Notice(`Invalid setting: ${result.error.message}`);
      // Re-sync the input to the persisted value so the UI and state don't
      // diverge after a rejected save (PRES-M1).
      field.setValue(this.host.getSettings().paths[key]);
    }
  }
}
