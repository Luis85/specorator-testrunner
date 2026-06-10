import {
  type ButtonComponent,
  type DropdownComponent,
  Notice,
  type Plugin,
  PluginSettingTab,
  Setting,
  type TextComponent,
  debounce,
} from "obsidian";
import type { EnvironmentValidationService } from "../../application/services/environment-validation-service";
import type { MaintenanceService } from "../../application/services/maintenance-service";
import type { PipelineGenerationService } from "../../application/services/pipeline-generation-service";
import type { Result } from "../../shared/result/result";
import type {
  SutEnvironment,
  TestHubPathSettings,
  TestHubSettings,
} from "../../domain/settings/settings";
import { unsafeVaultPath } from "../../domain/value-objects/vault-path";
import { AddEnvironmentModal } from "./add-environment-modal";
import {
  type AuthVarPair,
  buildAuthEnv,
  type ChecklistRow,
  checklistRow,
  ciReadinessRows,
  isWorkflowAlreadyExistsError,
  repairFailureRow,
  repairRows,
  runnerValidationRows,
  settingsErrorMessages,
} from "./settings-rows";

/** What the settings tab needs from the plugin to read/persist settings. */
export interface SettingsHost {
  getSettings(): TestHubSettings;
  updateSettings(next: TestHubSettings): Promise<Result<void>>;
  resetSettings(): Promise<void>;
}

/**
 * The narrow slice of the application services the settings tab drives (Wave A:
 * validate/repair/CI from the UI, not only the command palette). Wired in
 * main.ts from the already-constructed services.
 */
export interface SettingsTabServices {
  validation: Pick<EnvironmentValidationService, "validateEnvironment" | "validateCiReadiness">;
  maintenance: Pick<MaintenanceService, "repair">;
  pipeline: PipelineGenerationService;
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

/** How long a "Remove — click again to confirm" stays armed before reverting. */
const CONFIRM_DISARM_MS = 4000;

/** Message for both the disabled-button tooltip and the late-click guard. */
const ACTIVE_ENV_REMOVE_BLOCKED =
  "The active environment can't be removed. Switch the active environment first.";

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Edit paths, manage SUT environments (ADR-0013/0014), run maintenance and CI
 * actions with inline results, validate, reset (US-003, BBV §4 `SettingsTab`).
 */
export class TestHubSettingTab extends PluginSettingTab {
  /** Pending per-field persist debouncers, cancelled on re-render / close. */
  private readonly pendingFlushes: { cancel(): void }[] = [];

  /**
   * Pending `window.setTimeout` handles (e.g. the remove-environment two-click
   * disarm), cleared on re-render / close so an orphaned timeout can't fire into
   * a button that a later display() already rebuilt.
   */
  private readonly pendingTimeouts: number[] = [];

  /** Inline save-blocking error surface for the "System under test" section. */
  private sutErrorsEl: HTMLElement | null = null;

  constructor(
    plugin: Plugin,
    private readonly host: SettingsHost,
    private readonly services: SettingsTabServices,
  ) {
    super(plugin.app, plugin);
  }

  /** Cancels any debounced saves + pending timeouts queued from a prior render (PRES-L2). */
  private cancelPendingFlushes(): void {
    for (const flush of this.pendingFlushes) flush.cancel();
    this.pendingFlushes.length = 0;
    for (const handle of this.pendingTimeouts) window.clearTimeout(handle);
    this.pendingTimeouts.length = 0;
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

    this.renderSutSection(containerEl, settings);
    this.renderMaintenanceSection(containerEl);
    this.renderCiSection(containerEl);
  }

  // ── System under test (ADR-0013 environments, ADR-0014 auth) ─────────────

  private renderSutSection(containerEl: HTMLElement, settings: TestHubSettings): void {
    new Setting(containerEl).setName("System under test").setHeading();

    // Save-blocking validation errors (SETTINGS_INVALID) for any field in this
    // section land here, near the inputs they describe — each message already
    // names its environment/key, so the user can fix it without data.json.
    this.sutErrorsEl = containerEl.createDiv({
      cls: "e2e-test-hub-settings-errors",
      attr: { "aria-live": "polite" },
    });

    const environmentNames = Object.keys(settings.sut.environments);
    new Setting(containerEl)
      .setName("Active environment")
      .setDesc(
        "Test runs execute against this environment. Switching is a single action — never edit a URL inline.",
      )
      .addDropdown((dropdown) => {
        for (const name of environmentNames) dropdown.addOption(name, name);
        // A hand-edited data.json can leave `active` dangling; surface it as a
        // selectable-but-marked option so the dropdown reflects real state and
        // switching to a defined environment repairs it.
        if (!environmentNames.includes(settings.sut.active)) {
          dropdown.addOption(settings.sut.active, `${settings.sut.active} (missing)`);
        }
        dropdown.setValue(settings.sut.active);
        dropdown.onChange((value) => void this.persistActiveEnvironment(value, dropdown));
      });

    for (const name of environmentNames) this.renderEnvironmentBlock(containerEl, name, settings);

    new Setting(containerEl)
      .setName("Add environment")
      .setDesc('Create a new named environment (e.g. "staging") with an empty base URL.')
      .addButton((button) =>
        button.setButtonText("Add environment").onClick(() => this.openAddEnvironment()),
      );
  }

  private renderEnvironmentBlock(
    containerEl: HTMLElement,
    name: string,
    settings: TestHubSettings,
  ): void {
    const env = settings.sut.environments[name];
    const isActive = settings.sut.active === name;
    const block = containerEl.createDiv({ cls: "e2e-test-hub-env-block" });

    const header = new Setting(block).setName(isActive ? `${name} (active)` : name);
    if (isActive) header.setDesc("Runs currently execute against this environment.");
    header.addButton((button) => this.wireRemoveEnvironmentButton(button, name, isActive));

    new Setting(block)
      .setName("Base URL")
      .setDesc("Injected into test runs as BASE_URL (http, https, or file).")
      .addText((text) => {
        text.setPlaceholder("https://staging.example.com").setValue(env.baseUrl);
        const flush = debounce(
          (value: string) => void this.persistBaseUrl(name, value.trim(), text),
          PERSIST_DEBOUNCE_MS,
          true,
        );
        this.pendingFlushes.push(flush);
        text.onChange((value) => flush(value));
        text.inputEl.addEventListener("blur", () => {
          flush.cancel();
          void this.persistBaseUrl(name, text.getValue().trim(), text);
        });
      });

    // The rows array is the single source the persist rebuilds `auth.env`
    // from; each rendered row mutates its own pair in place.
    const rows: AuthVarPair[] = Object.entries(env.auth?.env ?? {}).map(([key, value]) => ({
      key,
      value,
    }));
    new Setting(block)
      .setName("Authentication variables")
      .setDesc(
        'Credential env vars injected verbatim into the runner (and referenced as CI secrets). Keys: letters, digits and "_" only.',
      )
      .addButton((button) =>
        button.setButtonText("Add variable").onClick(() => {
          // A new row is UI staging until a key is typed (buildAuthEnv drops
          // empty keys), so nothing persists yet — no full re-render needed.
          const pair: AuthVarPair = { key: "", value: "" };
          rows.push(pair);
          this.renderAuthVarRow(varsEl, name, rows, pair, true);
        }),
      );
    const varsEl = block.createDiv({ cls: "e2e-test-hub-env-vars" });
    for (const pair of rows) this.renderAuthVarRow(varsEl, name, rows, pair, false);
  }

  private renderAuthVarRow(
    varsEl: HTMLElement,
    envName: string,
    rows: AuthVarPair[],
    pair: AuthVarPair,
    focusKey: boolean,
  ): void {
    const row = new Setting(varsEl);
    row.settingEl.addClass("e2e-test-hub-env-var-row");
    const flush = debounce(
      () => void this.persistAuthVars(envName, rows),
      PERSIST_DEBOUNCE_MS,
      true,
    );
    this.pendingFlushes.push(flush);
    const persistNow = (): void => {
      flush.cancel();
      void this.persistAuthVars(envName, rows);
    };

    row.addText((text) => {
      text.setPlaceholder("API_TOKEN").setValue(pair.key);
      text.inputEl.setAttribute("aria-label", "Variable name");
      text.onChange((value) => {
        pair.key = value;
        flush();
      });
      text.inputEl.addEventListener("blur", persistNow);
      if (focusKey) text.inputEl.focus();
    });
    row.addText((text) => {
      // Credentials must not be shoulder-surfable in an open settings tab.
      text.inputEl.type = "password";
      text.setPlaceholder("Value").setValue(pair.value);
      text.inputEl.setAttribute("aria-label", "Variable value");
      text.onChange((value) => {
        pair.value = value;
        flush();
      });
      text.inputEl.addEventListener("blur", persistNow);
    });
    row.addExtraButton((button) => {
      // Icon-only button: the tooltip is visual-only, so assistive tech needs
      // an explicit accessible name on the underlying element.
      button.extraSettingsEl.setAttribute("aria-label", "Remove variable");
      return button
        .setIcon("x")
        .setTooltip("Remove variable")
        .onClick(() => {
          flush.cancel();
          const index = rows.indexOf(pair);
          if (index >= 0) rows.splice(index, 1);
          row.settingEl.remove();
          void this.persistAuthVars(envName, rows);
        });
    });
  }

  private wireRemoveEnvironmentButton(
    button: ButtonComponent,
    name: string,
    isActive: boolean,
  ): void {
    button.setButtonText("Remove environment");
    if (isActive) {
      // validate() errors on a dangling `sut.active`, so removing the active
      // environment can never persist — disable with the reason instead of
      // letting the user discover it via a rejected save.
      button.setDisabled(true);
      button.setTooltip(ACTIVE_ENV_REMOVE_BLOCKED);
      button.buttonEl.setAttribute("aria-label", ACTIVE_ENV_REMOVE_BLOCKED);
      return;
    }
    // Two-click confirm: the first click arms the button (warning style + new
    // label), the second within CONFIRM_DISARM_MS removes; the armed state
    // auto-disarms so a stray click can't linger as a hidden footgun.
    let armed = false;
    let disarmTimer = 0;
    button.onClick(() => {
      if (!armed) {
        armed = true;
        button.setWarning().setButtonText("Remove — click again to confirm");
        window.clearTimeout(disarmTimer);
        disarmTimer = window.setTimeout(() => {
          armed = false;
          button.setButtonText("Remove environment");
          button.buttonEl.removeClass("mod-warning");
        }, CONFIRM_DISARM_MS);
        // Track it so a re-render / tab close clears it (no orphaned fire).
        this.pendingTimeouts.push(disarmTimer);
        return;
      }
      window.clearTimeout(disarmTimer);
      void this.removeEnvironment(name);
    });
  }

  private async removeEnvironment(name: string): Promise<void> {
    const current = this.host.getSettings();
    if (current.sut.active === name) {
      // Re-check against fresh state: the disabled state was computed at render
      // time and the active environment may have changed since.
      new Notice(ACTIVE_ENV_REMOVE_BLOCKED);
      this.display();
      return;
    }
    const environments = { ...current.sut.environments };
    delete environments[name];
    const saved = await this.persistSut({ ...current.sut, environments });
    if (saved) this.display();
  }

  private openAddEnvironment(): void {
    new AddEnvironmentModal(this.app, {
      existingNames: Object.keys(this.host.getSettings().sut.environments),
      onCreate: (name) => void this.addEnvironment(name),
    }).open();
  }

  private async addEnvironment(name: string): Promise<void> {
    const current = this.host.getSettings();
    // An empty baseUrl saves (it is a warning, not an error) so a freshly
    // created environment can be filled in field by field.
    const saved = await this.persistSut({
      ...current.sut,
      environments: { ...current.sut.environments, [name]: { baseUrl: "" } },
    });
    if (saved) this.display();
  }

  private async persistActiveEnvironment(name: string, dropdown: DropdownComponent): Promise<void> {
    const current = this.host.getSettings();
    if (current.sut.active === name) return;
    const saved = await this.persistSut({ ...current.sut, active: name });
    // Re-render on success so the per-environment "(active)" marker and the
    // disabled remove button follow the switch.
    if (saved) this.display();
    else dropdown.setValue(this.host.getSettings().sut.active);
  }

  private async persistBaseUrl(
    envName: string,
    value: string,
    field: TextComponent,
  ): Promise<void> {
    const current = this.host.getSettings();
    const env = current.sut.environments[envName];
    // No-op when the environment was removed meanwhile or nothing changed.
    if (!env || env.baseUrl === value) return;
    const saved = await this.persistSut({
      ...current.sut,
      environments: { ...current.sut.environments, [envName]: { ...env, baseUrl: value } },
    });
    // Mirror the path-field contract: a rejected save re-syncs the input to the
    // persisted value so UI and state don't diverge (PRES-M1); the inline error
    // explains what was wrong with the rejected value.
    if (!saved) field.setValue(this.host.getSettings().sut.environments[envName]?.baseUrl ?? "");
  }

  private async persistAuthVars(envName: string, rows: AuthVarPair[]): Promise<void> {
    const current = this.host.getSettings();
    const env = current.sut.environments[envName];
    if (!env) return; // environment removed while a flush was pending
    const nextAuthEnv = buildAuthEnv(rows);
    // No-op when nothing material changed (e.g. a blur right after the
    // debounce already saved, or a still-unnamed staged row).
    if (JSON.stringify(nextAuthEnv ?? {}) === JSON.stringify(env.auth?.env ?? {})) return;
    const nextEnv: SutEnvironment = nextAuthEnv
      ? { baseUrl: env.baseUrl, auth: { env: nextAuthEnv } }
      : { baseUrl: env.baseUrl };
    await this.persistSut({
      ...current.sut,
      environments: { ...current.sut.environments, [envName]: nextEnv },
    });
    // On a rejected save the typed key/value deliberately stays in the row
    // (unlike single-value fields): persisted state is unchanged, and keeping
    // the text lets the user fix the invalid key in place guided by the
    // inline error — re-syncing would erase the half-finished entry.
  }

  /**
   * Persists a new `sut` section through the host (SettingsService.save() is
   * the authoritative validator). On rejection the field-level messages are
   * rendered INLINE in the section's error area — invalid auth keys / base
   * URLs are save-blocking, so this inline list is what makes them fixable
   * from the UI. Returns whether the save succeeded.
   */
  private async persistSut(nextSut: TestHubSettings["sut"]): Promise<boolean> {
    const current = this.host.getSettings();
    const result = await this.host.updateSettings({ ...current, sut: nextSut });
    if (result.ok) {
      this.renderSutErrors([]);
      return true;
    }
    this.renderSutErrors(settingsErrorMessages(result.error));
    return false;
  }

  private renderSutErrors(messages: string[]): void {
    const target = this.sutErrorsEl;
    if (!target || !target.isConnected) return;
    target.empty();
    for (const message of messages) {
      target.createDiv({ cls: "e2e-test-hub-settings-error-row", text: `✗ ${message}` });
    }
  }

  // ── Maintenance ───────────────────────────────────────────────────────────

  private renderMaintenanceSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Maintenance").setHeading();

    new Setting(containerEl)
      .setName("Validate environment")
      .setDesc("Check Node.js, npm, the runner files, dependencies, and the Chromium browser.")
      .addButton((button) =>
        button
          .setButtonText("Validate")
          .onClick(() => void this.runValidateEnvironment(button, validateResultEl)),
      );
    const validateResultEl = containerEl.createDiv({
      cls: "e2e-test-hub-settings-result",
      attr: { "aria-live": "polite" },
    });

    new Setting(containerEl)
      .setName("Repair installation")
      .setDesc(
        "Re-sync the managed runner files and reinstall anything missing. User-authored steps and pages are preserved.",
      )
      .addButton((button) =>
        button.setButtonText("Repair").onClick(() => void this.runRepair(button, repairResultEl)),
      );
    const repairResultEl = containerEl.createDiv({
      cls: "e2e-test-hub-settings-result",
      attr: { "aria-live": "polite" },
    });

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

  private async runValidateEnvironment(
    button: ButtonComponent,
    resultEl: HTMLElement,
  ): Promise<void> {
    button.setDisabled(true);
    this.renderChecklist(resultEl, [checklistRow("pending", "Validating…")]);
    try {
      const result = await this.services.validation.validateEnvironment();
      this.renderChecklist(resultEl, runnerValidationRows(result));
    } catch (error) {
      this.renderChecklist(resultEl, [
        checklistRow("error", `Validation failed: ${errorText(error)}`),
      ]);
    } finally {
      button.setDisabled(false);
    }
  }

  private async runRepair(button: ButtonComponent, resultEl: HTMLElement): Promise<void> {
    button.setDisabled(true);
    this.renderChecklist(resultEl, [
      checklistRow("pending", "Repairing… this can take a while when dependencies reinstall."),
    ]);
    try {
      const result = await this.services.maintenance.repair();
      this.renderChecklist(
        resultEl,
        result.ok ? repairRows(result.value) : [repairFailureRow(result.error)],
      );
    } catch (error) {
      this.renderChecklist(resultEl, [checklistRow("error", `Repair failed: ${errorText(error)}`)]);
    } finally {
      button.setDisabled(false);
    }
  }

  // ── Continuous integration (UC-019/UC-020) ───────────────────────────────

  private renderCiSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Continuous integration").setHeading();

    new Setting(containerEl)
      .setName("Generate workflow")
      .setDesc(
        "Write the CI workflow for the configured provider. An existing workflow is never overwritten without explicit confirmation.",
      )
      .addButton((button) =>
        button
          .setButtonText("Generate")
          .onClick(() => void this.runGenerateWorkflow(button, generateResultEl, false)),
      );
    const generateResultEl = containerEl.createDiv({
      cls: "e2e-test-hub-settings-result",
      attr: { "aria-live": "polite" },
    });

    new Setting(containerEl)
      .setName("Check CI readiness")
      .setDesc(
        "Verify the repository holds everything a CI checkout needs to install and run the tests.",
      )
      .addButton((button) =>
        button
          .setButtonText("Check")
          .onClick(() => void this.runCiReadiness(button, readinessResultEl)),
      );
    const readinessResultEl = containerEl.createDiv({
      cls: "e2e-test-hub-settings-result",
      attr: { "aria-live": "polite" },
    });
  }

  private async runGenerateWorkflow(
    button: ButtonComponent,
    resultEl: HTMLElement,
    overwriteExisting: boolean,
  ): Promise<void> {
    button.setDisabled(true);
    this.renderChecklist(resultEl, [checklistRow("pending", "Generating…")]);
    try {
      const settings = this.host.getSettings();
      const result = await this.services.pipeline.generate({
        provider: settings.ci.provider,
        settings,
        overwriteExisting,
      });
      if (result.ok) {
        this.renderChecklist(resultEl, [
          checklistRow("ok", `Workflow written to ${result.value.path}.`),
        ]);
      } else if (!overwriteExisting && isWorkflowAlreadyExistsError(result.error)) {
        // OQ-005: never clobber silently — surface the conflict and require an
        // explicit second action to overwrite.
        this.renderChecklist(resultEl, [checklistRow("warning", "A workflow already exists.")]);
        const overwrite = resultEl.createEl("button", {
          text: "Overwrite workflow",
          cls: ["mod-warning", "e2e-test-hub-settings-inline-button"],
        });
        overwrite.addEventListener(
          "click",
          () => void this.runGenerateWorkflow(button, resultEl, true),
        );
      } else {
        this.renderChecklist(resultEl, [checklistRow("error", result.error.message)]);
      }
    } catch (error) {
      this.renderChecklist(resultEl, [
        checklistRow("error", `Generation failed: ${errorText(error)}`),
      ]);
    } finally {
      button.setDisabled(false);
    }
  }

  private async runCiReadiness(button: ButtonComponent, resultEl: HTMLElement): Promise<void> {
    button.setDisabled(true);
    this.renderChecklist(resultEl, [checklistRow("pending", "Checking…")]);
    try {
      const result = await this.services.validation.validateCiReadiness(this.host.getSettings());
      this.renderChecklist(resultEl, ciReadinessRows(result));
    } catch (error) {
      this.renderChecklist(resultEl, [checklistRow("error", `Check failed: ${errorText(error)}`)]);
    } finally {
      button.setDisabled(false);
    }
  }

  /** Replaces a result container's content with the given checklist rows. */
  private renderChecklist(container: HTMLElement, rows: ChecklistRow[]): void {
    container.empty();
    for (const row of rows) {
      const el = container.createDiv({
        cls: "e2e-test-hub-settings-check-row",
        text: `${row.icon} ${row.text}`,
      });
      el.dataset.status = row.status;
    }
  }

  // ── Paths (existing behaviour, unchanged) ─────────────────────────────────

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
