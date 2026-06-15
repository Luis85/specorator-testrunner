import {
  type ButtonComponent,
  type DropdownComponent,
  Notice,
  Setting,
  type SettingDefinitionItem,
  type SettingGroupItem,
  type TextComponent,
  debounce,
} from "obsidian";

import type { SutEnvironment, TestHubSettings } from "../../domain/settings/settings";
import { AddEnvironmentModal } from "./add-environment-modal";
import { type AuthVarPair, buildAuthEnv, settingsErrorMessages } from "./settings-rows";
import {
  CONFIRM_DISARM_MS,
  markDestructive,
  PERSIST_DEBOUNCE_MS,
  type SettingsSectionContext,
} from "./settings-shared";

/** Message for both the disabled-button tooltip and the late-click guard. */
const ACTIVE_ENV_REMOVE_BLOCKED =
  "The active environment can't be removed. Switch the active environment first.";

/**
 * The "System under test" settings section (ADR-0013 environments, ADR-0014
 * auth): the active-environment dropdown, one editable block per environment
 * (base URL + authentication variables + remove), and the add-environment row.
 * Extracted from the settings tab (size budget); it owns the section's inline
 * error surface and drives every save/refresh through the {@link
 * SettingsSectionContext}.
 */
export class SutEnvironmentSection {
  /** Inline save-blocking error surface for this section. */
  private sutErrorsEl: HTMLElement | null = null;

  constructor(private readonly ctx: SettingsSectionContext) {}

  /** The section's definitions, spread into the tab's settings list. */
  definitions(): SettingDefinitionItem[] {
    const settings = this.ctx.getSettings();
    const environmentNames = Object.keys(settings.sut.environments);
    return [
      { type: "group", heading: "System under test", items: [this.activeEnvironmentRow()] },
      ...environmentNames.map((name) => this.environmentGroup(name, settings.sut.active === name)),
      this.addEnvironmentRow(),
    ];
  }

  private activeEnvironmentRow(): SettingGroupItem {
    return {
      name: "Active environment",
      desc: "Test Runs execute against this environment. Switching is a single action — never edit a URL inline.",
      render: (setting, group) => {
        // Save-blocking validation errors (SETTINGS_INVALID) for any field in
        // this section land directly above this row — each message already
        // names its environment/key, so the user can fix it without data.json.
        const errorsEl = group.listEl.createDiv({
          cls: "e2e-test-hub-settings-errors",
          attr: { "aria-live": "polite" },
        });
        setting.settingEl.insertAdjacentElement("beforebegin", errorsEl);
        this.sutErrorsEl = errorsEl;

        const settings = this.ctx.getSettings();
        const environmentNames = Object.keys(settings.sut.environments);
        setting.addDropdown((dropdown) => {
          for (const name of environmentNames) dropdown.addOption(name, name);
          // A hand-edited data.json can leave `active` dangling; surface it as
          // a selectable-but-marked option so the dropdown reflects real state
          // and switching to a defined environment repairs it.
          if (!environmentNames.includes(settings.sut.active)) {
            dropdown.addOption(settings.sut.active, `${settings.sut.active} (missing)`);
          }
          dropdown.setValue(settings.sut.active);
          dropdown.onChange((value) => void this.persistActiveEnvironment(value, dropdown));
        });

        return () => {
          errorsEl.remove();
          if (this.sutErrorsEl === errorsEl) this.sutErrorsEl = null;
        };
      },
    };
  }

  private environmentGroup(name: string, isActive: boolean): SettingDefinitionItem {
    return {
      type: "group",
      heading: isActive ? `${name} (active)` : name,
      cls: "e2e-test-hub-env-block",
      items: [
        {
          name: "Base URL",
          desc: "Injected into Test Runs as BASE_URL (http, https, or file).",
          render: (setting) => {
            setting.addText((text) => {
              text
                .setPlaceholder("https://staging.example.com")
                .setValue(this.ctx.getSettings().sut.environments[name]?.baseUrl ?? "");
              const flush = debounce(
                (value: string) => void this.persistBaseUrl(name, value.trim(), text),
                PERSIST_DEBOUNCE_MS,
                true,
              );
              this.ctx.registerFlush(flush);
              text.onChange((value) => flush(value));
              text.inputEl.addEventListener("blur", () => {
                flush.cancel();
                void this.persistBaseUrl(name, text.getValue().trim(), text);
              });
            });
          },
        },
        {
          name: "Authentication variables",
          desc: 'Credential env vars injected verbatim into the runner (and referenced as CI secrets). Keys: letters, digits and "_" only.',
          render: (setting, group) => {
            const env = this.ctx.getSettings().sut.environments[name];
            // The rows array is the single source the persist rebuilds
            // `auth.env` from; each rendered row mutates its own pair in place.
            const rows: AuthVarPair[] = Object.entries(env?.auth?.env ?? {}).map(
              ([key, value]) => ({ key, value }),
            );
            const varsEl = group.listEl.createDiv({ cls: "e2e-test-hub-env-vars" });
            setting.settingEl.insertAdjacentElement("afterend", varsEl);
            setting.addButton((button) =>
              button.setButtonText("Add variable").onClick(() => {
                // A new row is UI staging until a key is typed (buildAuthEnv
                // drops empty keys), so nothing persists yet — no re-render
                // needed.
                const pair: AuthVarPair = { key: "", value: "" };
                rows.push(pair);
                this.renderAuthVarRow(varsEl, name, rows, pair, true);
              }),
            );
            for (const pair of rows) this.renderAuthVarRow(varsEl, name, rows, pair, false);
            return () => varsEl.remove();
          },
        },
        {
          name: "Remove environment",
          desc: isActive
            ? ACTIVE_ENV_REMOVE_BLOCKED
            : "Forget this environment and its credentials.",
          render: (setting) => {
            setting.addButton((button) => this.wireRemoveEnvironmentButton(button, name, isActive));
          },
        },
      ],
    };
  }

  private addEnvironmentRow(): SettingDefinitionItem {
    return {
      name: "Add environment",
      desc: 'Create a new named environment (e.g. "staging") with an empty base URL.',
      render: (setting) => {
        setting.addButton((button) =>
          button.setButtonText("Add environment").onClick(() => this.openAddEnvironment()),
        );
      },
    };
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
    this.ctx.registerFlush(flush);
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
        markDestructive(button);
        button.setButtonText("Remove — click again to confirm");
        window.clearTimeout(disarmTimer);
        disarmTimer = window.setTimeout(() => {
          armed = false;
          button.setButtonText("Remove environment");
          button.buttonEl.removeClass("mod-warning");
        }, CONFIRM_DISARM_MS);
        // Track it so a re-render / tab close clears it (no orphaned fire).
        this.ctx.registerTimeout(disarmTimer);
        return;
      }
      window.clearTimeout(disarmTimer);
      void this.removeEnvironment(name);
    });
  }

  private async removeEnvironment(name: string): Promise<void> {
    const current = this.ctx.getSettings();
    if (current.sut.active === name) {
      // Re-check against fresh state: the disabled state was computed at render
      // time and the active environment may have changed since.
      new Notice(ACTIVE_ENV_REMOVE_BLOCKED);
      this.ctx.refreshTab();
      return;
    }
    const { [name]: _removed, ...environments } = current.sut.environments;
    const saved = await this.persistSut({ ...current.sut, environments });
    if (saved) this.ctx.refreshTab();
  }

  private openAddEnvironment(): void {
    new AddEnvironmentModal(this.ctx.app, {
      existingNames: Object.keys(this.ctx.getSettings().sut.environments),
      onCreate: (name) => void this.addEnvironment(name),
    }).open();
  }

  private async addEnvironment(name: string): Promise<void> {
    const current = this.ctx.getSettings();
    // An empty baseUrl saves (it is a warning, not an error) so a freshly
    // created environment can be filled in field by field.
    const saved = await this.persistSut({
      ...current.sut,
      environments: { ...current.sut.environments, [name]: { baseUrl: "" } },
    });
    if (saved) this.ctx.refreshTab();
  }

  private async persistActiveEnvironment(name: string, dropdown: DropdownComponent): Promise<void> {
    const current = this.ctx.getSettings();
    if (current.sut.active === name) return;
    const saved = await this.persistSut({ ...current.sut, active: name });
    // Re-render on success so the per-environment "(active)" marker and the
    // disabled remove button follow the switch.
    if (saved) this.ctx.refreshTab();
    else dropdown.setValue(this.ctx.getSettings().sut.active);
  }

  private async persistBaseUrl(
    envName: string,
    value: string,
    field: TextComponent,
  ): Promise<void> {
    const current = this.ctx.getSettings();
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
    if (!saved) field.setValue(this.ctx.getSettings().sut.environments[envName]?.baseUrl ?? "");
  }

  private async persistAuthVars(envName: string, rows: AuthVarPair[]): Promise<void> {
    const current = this.ctx.getSettings();
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
    const current = this.ctx.getSettings();
    const result = await this.ctx.updateSettings({ ...current, sut: nextSut });
    if (result.ok) {
      this.renderSutErrors([]);
      return true;
    }
    this.renderSutErrors(settingsErrorMessages(result.error));
    return false;
  }

  private renderSutErrors(messages: string[]): void {
    const target = this.sutErrorsEl;
    if (!target?.isConnected) return;
    target.empty();
    for (const message of messages) {
      target.createDiv({ cls: "e2e-test-hub-settings-error-row", text: `✗ ${message}` });
    }
  }
}
