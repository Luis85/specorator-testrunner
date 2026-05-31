import { type App, Modal, Notice, Setting } from "obsidian";
import type { WorkspacePort } from "../../application/ports/workspace-port";
import type { SuiteService } from "../../application/services/suite-service";

export interface CreateSuiteDeps {
  suiteService: SuiteService;
  workspace: WorkspacePort;
}

/**
 * Prompts for a suite name/description and tag expression, then creates it
 * (US-022/US-023, UC-008). Membership is the Cucumber tag expression (AD-4):
 * the suite includes exactly the scenarios that expression matches — never an
 * explicit scenario list. `create` slugifies the name into the suite id.
 */
export class CreateSuiteModal extends Modal {
  private suiteName = "";
  private description = "";
  private tagExpression = "";
  private submitting = false;

  constructor(
    app: App,
    private readonly deps: CreateSuiteDeps,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Create Test Suite" });

    new Setting(contentEl).setName("Name").addText((text) =>
      text.setPlaceholder("e.g. Checkout Smoke").onChange((value) => (this.suiteName = value)),
    );
    new Setting(contentEl).setName("Description").addTextArea((area) =>
      area.setPlaceholder("Optional summary").onChange((value) => (this.description = value)),
    );
    new Setting(contentEl)
      .setName("Tag expression")
      .setDesc("Cucumber tag expression deciding membership (AD-4).")
      .addText((text) =>
        text
          .setPlaceholder("@smoke and not @wip")
          .onChange((value) => (this.tagExpression = value)),
      );

    new Setting(contentEl).addButton((button) =>
      button
        .setButtonText("Create")
        .setCta()
        .onClick(() => void this.submit()),
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async submit(): Promise<void> {
    if (this.submitting) return;
    this.submitting = true;
    const result = await this.deps.suiteService.create({
      name: this.suiteName,
      description: this.description,
      tagExpression: this.tagExpression,
    });
    this.submitting = false;

    if (!result.ok) {
      new Notice(`Could not create Test Suite: ${result.error.message}`);
      return;
    }
    new Notice(`Created ${result.value.name}.`);
    this.close();
    await this.deps.workspace.openFile(result.value.path);
  }
}
