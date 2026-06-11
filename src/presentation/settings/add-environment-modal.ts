import { type App, Modal, Setting } from "obsidian";
import { submitOnEnter } from "../views/modal-helpers";
import { environmentNameProblem } from "./settings-rows";

export interface AddEnvironmentDeps {
  /** Existing environment keys, used to reject duplicate names. */
  existingNames: readonly string[];
  /** Called with the validated (trimmed) name after the modal closes. */
  onCreate: (name: string) => void;
}

/**
 * Prompts for a new SUT environment name (ADR-0013) from the settings tab's
 * "Add environment" button. A single autofocused text input + Create button;
 * the name must be non-empty and not collide with an existing environment.
 * The caller creates the environment as `{ baseUrl: "" }` — the base URL is
 * filled in afterwards in the environment block.
 */
export class AddEnvironmentModal extends Modal {
  private name = "";
  private errorEl: HTMLElement | null = null;

  constructor(
    app: App,
    private readonly deps: AddEnvironmentDeps,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Add environment" });
    contentEl.createEl("p", {
      text:
        'Name the new environment (e.g. "staging" or "production"). ' +
        "It starts with an empty base URL you can fill in afterwards.",
    });

    new Setting(contentEl).setName("Name").addText((text) => {
      // The placeholder shows an example VALUE, and Environment names are
      // lowercase identifiers (CONTEXT.md: `staging`, `production`).
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      text.setPlaceholder("staging").onChange((value) => (this.name = value));
      // Enter submits so the single-field modal doesn't force a mouse trip.
      submitOnEnter(text.inputEl, () => this.submit());
      // Autofocus the only input so the user can start typing immediately.
      text.inputEl.focus();
    });

    this.errorEl = contentEl.createDiv({ cls: "e2e-test-hub-settings-errors" });

    new Setting(contentEl).addButton((button) =>
      button
        .setButtonText("Create")
        .setCta()
        .onClick(() => this.submit()),
    );
  }

  onClose(): void {
    this.contentEl.empty();
    this.errorEl = null;
  }

  private submit(): void {
    const problem = environmentNameProblem(this.name, this.deps.existingNames);
    if (problem) {
      // Inline (not a Notice): the message belongs next to the field it's about.
      this.errorEl?.empty();
      this.errorEl?.createDiv({ cls: "e2e-test-hub-settings-error-row", text: `✗ ${problem}` });
      return;
    }
    this.close();
    this.deps.onCreate(this.name.trim());
  }
}
