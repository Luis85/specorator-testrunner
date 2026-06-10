import { type App, Modal, Notice, Setting } from "obsidian";
import type { WorkspacePort } from "../../application/ports/workspace-port";
import type { UseCaseService } from "../../application/services/use-case-service";

export interface CreateUseCaseDeps {
  useCaseService: UseCaseService;
  workspace: WorkspacePort;
}

/** Prompts for a Use Case title/description and creates it (US-015, UC-004). */
export class CreateUseCaseModal extends Modal {
  private useCaseTitle = "";
  private description = "";
  private submitting = false;

  constructor(
    app: App,
    private readonly deps: CreateUseCaseDeps,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Create Use Case" });

    new Setting(contentEl).setName("Title").addText((text) => {
      text
        .setPlaceholder("e.g. Checkout with a saved card")
        .onChange((value) => (this.useCaseTitle = value));
      // Enter submits (mirrors AddEnvironmentModal) so the keyboard flow
      // doesn't force a mouse trip; the description textarea keeps Enter for
      // newlines and is deliberately NOT wired this way.
      text.inputEl.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void this.submit();
        }
      });
      // Autofocus the first input so the user can start typing immediately
      // instead of tabbing/clicking into the field first.
      text.inputEl.focus();
    });
    new Setting(contentEl)
      .setName("Description")
      .addTextArea((area) =>
        area.setPlaceholder("Optional summary").onChange((value) => (this.description = value)),
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

    // Client-side guard so an empty/whitespace title doesn't round-trip to the
    // service (which stays the authoritative validator). Mirrors SlugPromptModal.
    const title = this.useCaseTitle.trim();
    if (title === "") {
      new Notice("Please enter a title for the Use Case.");
      return;
    }

    this.submitting = true;
    const result = await this.deps.useCaseService.create({
      title,
      description: this.description.trim(),
    });
    this.submitting = false;

    if (!result.ok) {
      new Notice(`Could not create Use Case: ${result.error.message}`);
      return;
    }
    new Notice(`Created ${result.value.id}.`);
    this.close();
    await this.deps.workspace.openFile(result.value.path);
  }
}
