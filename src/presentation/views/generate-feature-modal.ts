import { type App, FuzzySuggestModal, Modal, Notice, Setting } from "obsidian";
import type { WorkspacePort } from "../../application/ports/workspace-port";
import type { SpecificationService } from "../../application/services/specification-service";
import type { UseCaseService } from "../../application/services/use-case-service";
import type { UseCase } from "../../domain/entities/use-case";
import { openOrNotice, submitOnEnter } from "./modal-helpers";

export interface GenerateFeatureDeps {
  useCaseService: UseCaseService;
  specificationService: SpecificationService;
  workspace: WorkspacePort;
}

/**
 * Lets the user pick a Use Case and generates a Feature for it (US-018, UC-006).
 * The first Feature uses the `happy-path` slug; for a Use Case that already has
 * Features, UC-006 step 3 requires prompting for the slug, so a second modal
 * collects it before the service creates and links the file.
 */
export class GenerateFeatureModal extends FuzzySuggestModal<UseCase> {
  constructor(
    app: App,
    private readonly deps: GenerateFeatureDeps,
    private readonly useCases: UseCase[],
  ) {
    super(app);
    this.setPlaceholder("Select a Use Case to generate a feature for");
  }

  getItems(): UseCase[] {
    return this.useCases;
  }

  getItemText(useCase: UseCase): string {
    return `${useCase.id} — ${useCase.title}`;
  }

  onChooseItem(useCase: UseCase): void {
    generateFeatureForUseCase(this.app, this.deps, useCase);
  }
}

/**
 * Generates a Feature for one already-chosen Use Case, reusing the slug-prompt
 * flow (UC-006 step 3: prompt for a slug when the Use Case already has
 * Features, otherwise use `happy-path`). Shared between the command-palette
 * fuzzy picker (`GenerateFeatureModal`) and the Use Case detail view's
 * "Generate Feature" button so the generation behaviour lives in one place.
 *
 * `onGenerated` lets the detail view refresh its Feature list after the new
 * Feature lands; the command palette omits it and just opens the new file.
 */
export const generateFeatureForUseCase = (
  app: App,
  deps: GenerateFeatureDeps,
  useCase: UseCase,
  onGenerated?: (path: string) => void,
): void => {
  const create = async (slug?: string): Promise<void> => {
    const result = await deps.specificationService.createFromUseCase(useCase.id, slug);
    if (!result.ok) {
      new Notice(`Could not generate Feature: ${result.error.message}`, 10000);
      return;
    }
    new Notice(`Generated ${result.value.path}.`);
    await openOrNotice(deps.workspace, result.value.path);
    onGenerated?.(result.value.path);
  };

  if (useCase.featureFiles.length === 0) {
    void create(); // first Feature → happy-path (UC-006)
    return;
  }
  new SlugPromptModal(app, useCase, (slug) => void create(slug)).open();
};

/** Prompts for the slug of an additional Feature on an existing Use Case. */
class SlugPromptModal extends Modal {
  private slug = "";
  // Double-submit guard (entry-point review): a rapid double-click would call
  // onSubmit twice and create duplicate Feature files for the same slug.
  private submitting = false;

  constructor(
    app: App,
    private readonly useCase: UseCase,
    private readonly onSubmit: (slug: string) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Name the new feature" });
    contentEl.createEl("p", {
      text: `${this.useCase.id} already has ${this.useCase.featureFiles.length} Feature(s). Enter a slug for the new one (e.g. "edge-cases").`,
    });
    new Setting(contentEl).setName("Slug").addText((text) => {
      // The placeholder shows an example VALUE: slugs are lowercase by
      // definition (they become part of the `.feature` filename).
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      text.setPlaceholder("edge-cases").onChange((value) => (this.slug = value));
      // Enter submits (shared helper) so the keyboard flow doesn't force a
      // mouse trip — same wiring as the other prompt modals.
      submitOnEnter(text.inputEl, () => this.submit());
      // Autofocus the only input so the user can type the slug immediately
      // instead of tabbing/clicking into the field first.
      text.inputEl.focus();
    });
    new Setting(contentEl).addButton((button) =>
      button
        .setButtonText("Create feature")
        .setCta()
        .onClick(() => this.submit()),
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private submit(): void {
    if (this.submitting) return;
    const slug = this.slug.trim();
    if (slug === "") {
      new Notice("Please enter a slug for the new feature.");
      return;
    }
    this.submitting = true; // never reset: the modal closes here
    this.close();
    this.onSubmit(slug);
  }
}
