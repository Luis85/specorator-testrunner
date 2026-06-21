import {
  type ButtonComponent,
  Notice,
  type SettingDefinitionItem,
  type SettingGroupItem,
} from "obsidian";

import {
  checklistRow,
  ciReadinessRows,
  isWorkflowAlreadyExistsError,
  repairFailureRow,
  repairRows,
  runnerValidationRows,
} from "./settings-rows";
import {
  actionWithResultRow,
  errorText,
  renderChecklist,
  runButtonAction,
  type SettingsSectionContext,
} from "./settings-shared";
import { buttonComponentControl, wireConfirmAction } from "../views/confirm-action";

/**
 * The "Maintenance" (validate / repair / reset) and "Continuous integration"
 * (generate workflow / check readiness) settings sections. Each button drives
 * the injected service and reports into an inline checklist; reset is a
 * two-click destructive confirm. Extracted from the settings tab (size budget)
 * and wired through the {@link SettingsSectionContext}.
 */
export class MaintenanceSection {
  constructor(private readonly ctx: SettingsSectionContext) {}

  /** The maintenance + CI groups, spread into the tab's settings list. */
  definitions(): SettingDefinitionItem[] {
    return [
      {
        type: "group",
        heading: "Maintenance",
        items: [this.validateRow(), this.repairRow(), this.resetRow()],
      },
      {
        type: "group",
        heading: "Continuous integration",
        items: [this.generateWorkflowRow(), this.ciReadinessRow()],
      },
    ];
  }

  // ── Maintenance ────────────────────────────────────────────────────────────

  private validateRow(): SettingGroupItem {
    return actionWithResultRow(
      "Validate environment",
      "Check Node.js, npm, the .testrunner files, dependencies, and the selected browsers.",
      "Validate",
      (button, resultEl) => this.runValidateEnvironment(button, resultEl),
    );
  }

  private repairRow(): SettingGroupItem {
    return actionWithResultRow(
      "Repair installation",
      "Re-sync the managed .testrunner files and reinstall anything missing. User-authored steps and pages are preserved.",
      "Repair",
      (button, resultEl) => this.runRepair(button, resultEl),
    );
  }

  private resetRow(): SettingGroupItem {
    return {
      name: "Reset Test Hub",
      desc: "Restore a clean install: remove the regenerable .testrunner runtime, restore default settings, and re-initialize. Your Use Cases, Feature Specifications, Test Suites and Test Evidence are preserved.",
      render: (setting) => {
        setting.addButton((button) => this.wireResetButton(button));
      },
    };
  }

  /**
   * Two-click confirm for the destructive reset: the first click arms the
   * button (new label), the second within CONFIRM_DISARM_MS resets; the armed
   * state auto-disarms so a stray click can't linger as a hidden footgun. The
   * button is warning-styled from the start — reset is always destructive.
   */
  private wireResetButton(button: ButtonComponent): void {
    // Two-click confirm (shared primitive). `destructiveWhenIdle: true` — reset
    // is always dangerous, so the button is warning-styled from the start and
    // stays styled when it disarms back to "Reset".
    wireConfirmAction(buttonComponentControl(button), {
      config: {
        idleLabel: "Reset",
        armedLabel: "Reset — click again to confirm",
        destructiveWhenIdle: true,
      },
      onConfirm: () => void this.runReset(button),
      // Track the disarm timer so a re-render / tab close clears it.
      scheduleDisarm: (run, ms) => {
        const handle = window.setTimeout(run, ms);
        this.ctx.registerTimeout(handle);
        return () => window.clearTimeout(handle);
      },
    });
  }

  private async runReset(button: ButtonComponent): Promise<void> {
    button.setDisabled(true);
    try {
      // The Notice + re-init outcome is owned by resetSettings() (UC-024).
      await this.ctx.resetSettings();
      this.ctx.refreshTab();
    } catch (error) {
      new Notice(`Reset failed: ${errorText(error)}`);
    } finally {
      button.setDisabled(false);
    }
  }

  private async runValidateEnvironment(
    button: ButtonComponent,
    resultEl: HTMLElement,
  ): Promise<void> {
    await runButtonAction(button, resultEl, "Validating…", "Validation failed: ", async () => {
      const result = await this.ctx.services.validation.validateEnvironment();
      renderChecklist(resultEl, runnerValidationRows(result));
    });
  }

  private async runRepair(button: ButtonComponent, resultEl: HTMLElement): Promise<void> {
    await runButtonAction(
      button,
      resultEl,
      "Repairing… this can take a while when dependencies reinstall.",
      "Repair failed: ",
      async () => {
        const result = await this.ctx.services.maintenance.repair();
        renderChecklist(
          resultEl,
          result.ok ? repairRows(result.value) : [repairFailureRow(result.error)],
        );
      },
    );
  }

  // ── Continuous integration (UC-019/UC-020) ───────────────────────────────

  private generateWorkflowRow(): SettingGroupItem {
    return actionWithResultRow(
      "Generate workflow",
      "Write a GitHub Actions workflow to `.github/workflows/`. An existing workflow is never overwritten without explicit confirmation.",
      "Generate",
      (button, resultEl) => this.runGenerateWorkflow(button, resultEl, false),
    );
  }

  private ciReadinessRow(): SettingGroupItem {
    return actionWithResultRow(
      "Check CI readiness",
      "Verify the repository holds everything a CI checkout needs to install and run the tests.",
      "Check",
      (button, resultEl) => this.runCiReadiness(button, resultEl),
    );
  }

  private async runGenerateWorkflow(
    button: ButtonComponent,
    resultEl: HTMLElement,
    overwriteExisting: boolean,
  ): Promise<void> {
    await runButtonAction(button, resultEl, "Generating…", "Generation failed: ", async () => {
      const settings = this.ctx.getSettings();
      const result = await this.ctx.services.pipeline.generate({
        provider: settings.ci.provider,
        settings,
        overwriteExisting,
      });
      if (result.ok) {
        renderChecklist(resultEl, [
          checklistRow("ok", `Workflow written to ${result.value.path}.`),
        ]);
      } else if (!overwriteExisting && isWorkflowAlreadyExistsError(result.error)) {
        // OQ-005: never clobber silently — surface the conflict and require an
        // explicit second action to overwrite.
        renderChecklist(resultEl, [checklistRow("warning", "A workflow already exists.")]);
        const overwrite = resultEl.createEl("button", {
          text: "Overwrite workflow",
          cls: ["mod-warning", "e2e-test-hub-settings-inline-button"],
        });
        overwrite.addEventListener(
          "click",
          () => void this.runGenerateWorkflow(button, resultEl, true),
        );
      } else {
        renderChecklist(resultEl, [checklistRow("error", result.error.message)]);
      }
    });
  }

  private async runCiReadiness(button: ButtonComponent, resultEl: HTMLElement): Promise<void> {
    await runButtonAction(button, resultEl, "Checking…", "Check failed: ", async () => {
      const result = await this.ctx.services.validation.validateCiReadiness(this.ctx.getSettings());
      renderChecklist(resultEl, ciReadinessRows(result));
    });
  }
}
