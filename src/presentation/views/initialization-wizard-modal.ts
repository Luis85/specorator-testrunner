import { type App, Modal, Notice, Setting, type ToggleComponent } from "obsidian";
import type {
  InitializationProgress,
  InitializationService,
  InitializationStep,
  InitializeTestHubResult,
} from "../../application/services/initialization-service";
import type { WorkspacePort } from "../../application/ports/workspace-port";
import type { TestHubSettings } from "../../domain/settings/settings";
import type { AppError } from "../../shared/errors/errors";
import { joinVaultPath } from "../../shared/utils/vault-path";
import { failureOutputTail } from "./initialization-wizard-format";
import { openOrNotice } from "./modal-helpers";

export interface InitializationWizardDeps {
  initialization: InitializationService;
  workspace: WorkspacePort;
  getSettings: () => TestHubSettings;
}

/**
 * Guided first-run setup (US-004, BBV §4 `InitializationWizardView`). Shows
 * per-step progress and, on failure, an actionable retry — without
 * auto-running the demo test (AD-1).
 */
export class InitializationWizardModal extends Modal {
  private readonly rows = new Map<InitializationStep, HTMLElement>();
  private running = false;
  private installDependencies = true;
  private installBrowsers = true;

  constructor(
    app: App,
    private readonly deps: InitializationWizardDeps,
  ) {
    super(app);
  }

  onOpen(): void {
    this.renderIntro();
  }

  onClose(): void {
    this.contentEl.empty();
    this.rows.clear();
  }

  private renderIntro(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.rows.clear();
    contentEl.createEl("h2", { text: "Initialize Test Hub" });
    contentEl.createEl("p", {
      text:
        "This creates the vault folder structure, generates documentation and demo content, " +
        "adds the Smoke and Regression suites, and installs the .testrunner. No test runs " +
        "automatically.",
    });

    // Captured so the dependencies toggle below can drive it: the browser
    // download REQUIRES dependencies, and a toggle that silently does nothing
    // (checked but ignored) would misstate what the wizard is about to do.
    let browserToggle: ToggleComponent | null = null;

    new Setting(contentEl)
      .setName("Install dependencies")
      .setDesc("Run npm install in the .testrunner project.")
      .addToggle((toggle) =>
        toggle.setValue(this.installDependencies).onChange((value) => {
          this.installDependencies = value;
          if (!value) {
            this.installBrowsers = false;
            // Reflect the dependency in the UI: cleared + disabled while off.
            browserToggle?.setValue(false).setDisabled(true);
          } else {
            this.installBrowsers = true;
            // Re-enable and restore the default (on) when dependencies return.
            browserToggle?.setDisabled(false).setValue(true);
          }
        }),
      );

    new Setting(contentEl)
      .setName("Install browser")
      .setDesc(
        // Be honest about the total download: the browser itself plus the npm
        // packages npm install pulls alongside it.
        "Download Chromium for Playwright (~150 MB browser + npm packages). Requires dependencies.",
      )
      .addToggle((toggle) => {
        browserToggle = toggle;
        toggle
          .setValue(this.installBrowsers)
          .setDisabled(!this.installDependencies)
          .onChange((value) => {
            this.installBrowsers = value;
          });
      });

    new Setting(contentEl).addButton((button) =>
      button
        .setButtonText("Initialize")
        .setCta()
        .onClick(() => void this.run()),
    );
  }

  private renderProgressArea(): HTMLElement {
    const { contentEl } = this;
    contentEl.empty();
    this.rows.clear();
    contentEl.createEl("h2", { text: "Initializing Test Hub" });
    return contentEl.createDiv({ cls: "e2e-test-hub-progress" });
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const progressArea = this.renderProgressArea();
    const settings = this.deps.getSettings();

    const result = await this.deps.initialization.initialize(
      {
        settings,
        installDependencies: this.installDependencies,
        installBrowsers: this.installDependencies && this.installBrowsers,
        generateDemoContent: settings.automation.autoCreateDemoContent,
        generateDocumentation: settings.automation.autoCreateDocumentation,
      },
      (progress) => this.renderProgress(progressArea, progress),
    );

    this.running = false;
    if (result.ok) this.renderSuccess(settings, result.value);
    else this.renderFailure(result.error);
  }

  private renderProgress(area: HTMLElement, progress: InitializationProgress): void {
    const icon =
      progress.status === "done"
        ? "✓"
        : progress.status === "failed"
          ? "✗"
          : progress.status === "skipped"
            ? "–"
            : "…";
    const text = `${icon} ${progress.label}${progress.detail ? ` — ${progress.detail}` : ""}`;
    const existing = this.rows.get(progress.step);
    if (existing) {
      existing.setText(text);
      existing.dataset.status = progress.status;
    } else {
      const row = area.createDiv({ cls: "e2e-test-hub-progress-row", text });
      row.dataset.status = progress.status;
      this.rows.set(progress.step, row);
    }
  }

  private renderSuccess(settings: TestHubSettings, result: InitializeTestHubResult): void {
    const { contentEl } = this;
    // Point at the next step. The walkthrough hint references the "Open Getting
    // Started" button rendered just below, so only show it when documentation
    // was actually generated (otherwise the button — and the guide — don't exist).
    const summary = `Test Hub ready: ${result.createdFolders.length} folders and ${result.createdFiles.length} files created.`;
    contentEl.createEl("p", {
      text: result.documentationGenerated
        ? `${summary} Open Getting Started for a walkthrough.`
        : summary,
    });
    new Notice("E2E Test Hub initialized.");

    const actions = new Setting(contentEl);
    if (result.documentationGenerated) {
      const gettingStarted = joinVaultPath(settings.paths.documentationPath, "Getting Started.md");
      actions.addButton((button) =>
        button
          .setButtonText("Open Getting Started")
          .setCta()
          .onClick(async () => {
            await openOrNotice(this.deps.workspace, gettingStarted);
            this.close();
          }),
      );
    }
    actions.addButton((button) => button.setButtonText("Close").onClick(() => this.close()));
  }

  private renderFailure(failure: AppError): void {
    const { contentEl } = this;
    // Mirror the success-path Notice: the user may have closed the modal while
    // the install ran, and a closed modal must not mean a silent failure.
    new Notice(`Initialization failed: ${failure.message}`, 10000);
    const error = contentEl.createDiv({ cls: "e2e-test-hub-error" });
    error.createEl("p", { text: `Initialization failed: ${failure.message}` });
    // A failed install/validation step carries the child's stderr in
    // details.stderr — show its TAIL right here so the user sees the actual
    // npm/network/loader error without opening the developer console
    // (testvault bug report: the modal gave no readable reason).
    const stderrTail = failureOutputTail(failure);
    if (stderrTail !== null) {
      error.createEl("pre", { cls: "e2e-test-hub-error-output", text: stderrTail });
    }
    // Actionable next steps, not just the raw error: the console has the full
    // stack/output, and the validate command diagnoses environment problems.
    error.createEl("p", {
      text:
        "Check the developer console for details, or run the 'Validate environment' " +
        "command to diagnose.",
    });
    new Setting(contentEl)
      .addButton((button) =>
        button
          .setButtonText("Retry")
          .setCta()
          .onClick(() => void this.run()),
      )
      .addButton((button) => button.setButtonText("Close").onClick(() => this.close()));
  }
}
