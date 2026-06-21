import { type App, Modal, Notice, Setting } from "obsidian";
import type { UseCaseService } from "../../application/services/use-case-service";
import { descriptionField, submitOnEnter } from "./modal-helpers";

export interface CreateUseCaseDeps {
  useCaseService: UseCaseService;
  // WS-C1 (03-§3.1): a new Use Case opens the detail COCKPIT — where the next
  // step (Generate feature) lives — not the raw note, which dead-ends the loop.
  // The raw note stays one click away ("Open note" in the detail header).
  openUseCaseDetail: (useCaseId: string) => void;
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
    // "New …" is the creation verb everywhere (dashboard quick actions,
    // explorer headers, command palette); only the CTA button says "Create".
    contentEl.createEl("h2", { text: "New Use Case" });

    new Setting(contentEl).setName("Title").addText((text) => {
      text
        .setPlaceholder("E.g. Checkout with a saved card")
        .onChange((value) => (this.useCaseTitle = value));
      // Enter submits (shared helper); the description textarea keeps Enter
      // for newlines and is deliberately NOT wired this way.
      submitOnEnter(text.inputEl, () => void this.submit());
      // Autofocus the first input so the user can start typing immediately
      // instead of tabbing/clicking into the field first.
      text.inputEl.focus();
    });
    descriptionField(contentEl, (value) => (this.description = value));

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
    // Forward momentum (C1): land in the detail cockpit so the loop rail's next
    // step (Generate feature) is right there, instead of dead-ending on the raw
    // note. The raw note stays reachable via the detail header's "Open note".
    this.deps.openUseCaseDetail(result.value.id);
  }
}
