import { type App, Modal, Notice, Setting } from "obsidian";
import type {
  InitializationProgress,
  InitializationService,
  InitializationStep,
  InitializeTestHubResult,
} from "../../application/services/initialization-service";
import type { WorkspacePort } from "../../application/ports/workspace-port";
import type { TestHubSettings } from "../../domain/settings/settings";
import { joinVaultPath } from "../../shared/utils/vault-path";

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

  constructor(app: App, private readonly deps: InitializationWizardDeps) {
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
        "and adds the Smoke and Regression suites. Nothing runs automatically.",
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
        installDependencies: false, // runner install: EPIC-003
        installBrowsers: false,
        generateDemoContent: settings.automation.autoCreateDemoContent,
        generateDocumentation: settings.automation.autoCreateDocumentation,
      },
      (progress) => this.renderProgress(progressArea, progress),
    );

    this.running = false;
    if (result.ok) this.renderSuccess(settings, result.value);
    else this.renderFailure(result.error.message);
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
    contentEl.createEl("p", {
      text: `Test Hub ready: ${result.createdFolders.length} folders and ${result.createdFiles.length} files created.`,
    });
    new Notice("E2E Test Hub initialized.");

    const actions = new Setting(contentEl);
    if (result.documentationGenerated) {
      const gettingStarted = joinVaultPath(
        settings.paths.documentationPath,
        "Getting Started.md",
      );
      actions.addButton((button) =>
        button
          .setButtonText("Open Getting Started")
          .setCta()
          .onClick(async () => {
            await this.deps.workspace.openFile(gettingStarted);
            this.close();
          }),
      );
    }
    actions.addButton((button) => button.setButtonText("Close").onClick(() => this.close()));
  }

  private renderFailure(message: string): void {
    const { contentEl } = this;
    const error = contentEl.createDiv({ cls: "e2e-test-hub-error" });
    error.createEl("p", { text: `Initialization failed: ${message}` });
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
