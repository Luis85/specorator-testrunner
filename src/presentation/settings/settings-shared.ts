import type { App, ButtonComponent, Setting, SettingGroupItem } from "obsidian";

import type { EnvironmentValidationService } from "../../application/services/environment-validation-service";
import type { MaintenanceService } from "../../application/services/maintenance-service";
import type { PipelineGenerationService } from "../../application/services/pipeline-generation-service";
import type { RunnerInstallationService } from "../../application/services/runner-installation-service";
import type { TestHubSettings } from "../../domain/settings/settings";
import type { Result } from "../../shared/result/result";
import { type ChecklistRow, checklistRow } from "./settings-rows";

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
  installation: Pick<RunnerInstallationService, "installBrowsers">;
}

/**
 * The seam each extracted settings section ({@link
 * import("./settings-environments").SutEnvironmentSection},
 * {@link import("./settings-maintenance").MaintenanceSection}) uses to reach the
 * owning tab: read/persist settings through the host, register the debounced
 * saves / disarm timeouts the tab flushes on close, and re-render. Keeping the
 * sections behind this narrow contract is what let them move out of the
 * size-budgeted tab without each re-deriving the persist/refresh plumbing.
 */
export interface SettingsSectionContext {
  app: App;
  services: SettingsTabServices;
  getSettings(): TestHubSettings;
  updateSettings(next: TestHubSettings): Promise<Result<void>>;
  resetSettings(): Promise<void>;
  /** Track a debounced save so the tab can flush it on close / cancel on re-render. */
  registerFlush(flush: { cancel(): void; run(): void }): void;
  /** Track a `window.setTimeout` handle so the tab can clear it on re-render / close. */
  registerTimeout(handle: number): void;
  /** Re-render the open tab from persisted state. */
  refreshTab(): void;
}

/** How long to wait after the last keystroke before persisting (PRES-M1). */
export const PERSIST_DEBOUNCE_MS = 600;

/** How long a "… — click again to confirm" stays armed before reverting. */
export const CONFIRM_DISARM_MS = 4000;

export const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Styles a button as destructive across Obsidian versions. `setDestructive()`
 * is the 1.13 API; pre-1.13 builds only have the (now-deprecated)
 * `setWarning()`. Both are reached through a narrowed cast — so neither the
 * missing-method crash on pre-1.13 nor the no-deprecated lint on `setWarning()`
 * can bite — and both add the `mod-warning` class the disarm paths remove.
 */
export const markDestructive = (button: ButtonComponent): void => {
  const styler = button as unknown as {
    setDestructive?: () => void;
    setWarning?: () => void;
  };
  if (typeof styler.setDestructive === "function") styler.setDestructive();
  else if (typeof styler.setWarning === "function") styler.setWarning();
};

/**
 * Builds a button row whose async action reports into a checklist container
 * rendered directly below the row (shared shape of the install / validate /
 * repair / CI rows). Free of `this` so every section can reuse it.
 */
export const actionWithResultRow = (
  name: string,
  desc: string,
  buttonText: string,
  run: (button: ButtonComponent, resultEl: HTMLElement) => Promise<void>,
): SettingGroupItem => ({
  name,
  desc,
  render: (setting: Setting, group: { listEl: HTMLElement }) => {
    const resultEl = group.listEl.createDiv({
      cls: "e2e-test-hub-settings-result",
      attr: { "aria-live": "polite" },
    });
    setting.settingEl.insertAdjacentElement("afterend", resultEl);
    setting.addButton((button) =>
      button.setButtonText(buttonText).onClick(() => void run(button, resultEl)),
    );
    return () => resultEl.remove();
  },
});

/**
 * Shared wrapper for the button-action pattern used by install, validate,
 * repair, generate, and CI-readiness rows: disable the button, show a pending
 * checklist, run `fn` (which renders its own result rows into `resultEl`), and
 * re-enable the button in a `finally` block. Uncaught exceptions in `fn` are
 * caught here and rendered as an error row prefixed with `catchPrefix`.
 */
export const runButtonAction = async (
  button: ButtonComponent,
  resultEl: HTMLElement,
  pendingMessage: string,
  catchPrefix: string,
  fn: () => Promise<void>,
): Promise<void> => {
  button.setDisabled(true);
  renderChecklist(resultEl, [checklistRow("pending", pendingMessage)]);
  try {
    await fn();
  } catch (error) {
    renderChecklist(resultEl, [checklistRow("error", `${catchPrefix}${errorText(error)}`)]);
  } finally {
    button.setDisabled(false);
  }
};

/** Replaces a result container's content with the given checklist rows. */
export const renderChecklist = (container: HTMLElement, rows: ChecklistRow[]): void => {
  container.empty();
  for (const row of rows) {
    const el = container.createDiv({
      cls: "e2e-test-hub-settings-check-row",
      text: `${row.icon} ${row.text}`,
    });
    el.dataset.status = row.status;
  }
};
