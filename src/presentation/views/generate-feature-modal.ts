import { type App, FuzzySuggestModal, Modal, Notice, Setting } from "obsidian";
import type { WorkspacePort } from "../../application/ports/workspace-port";
import type { SpecificationService } from "../../application/services/specification-service";
import type { UseCaseService } from "../../application/services/use-case-service";
import type { UseCase } from "../../domain/entities/use-case";

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
    this.setPlaceholder("Select a Use Case to generate a Feature for");
  }

  getItems(): UseCase[] {
    return this.useCases;
  }

  getItemText(useCase: UseCase): string {
    return `${useCase.id} — ${useCase.title}`;
  }

  onChooseItem(useCase: UseCase): void {
    if (useCase.featureFiles.length === 0) {
      void this.generate(useCase); // first Feature → happy-path (UC-006)
      return;
    }
    new SlugPromptModal(this.app, useCase, (slug) => void this.generate(useCase, slug)).open();
  }

  private async generate(useCase: UseCase, slug?: string): Promise<void> {
    const result = await this.deps.specificationService.createFromUseCase(useCase.id, slug);
    if (!result.ok) {
      new Notice(`Could not generate Feature: ${result.error.message}`, 10000);
      return;
    }
    new Notice(`Generated ${result.value.path}.`);
    await this.deps.workspace.openFile(result.value.path);
  }
}

/** Prompts for the slug of an additional Feature on an existing Use Case. */
class SlugPromptModal extends Modal {
  private slug = "";

  constructor(
    app: App,
    private readonly useCase: UseCase,
    private readonly onSubmit: (slug: string) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Name the new Feature" });
    contentEl.createEl("p", {
      text: `${this.useCase.id} already has ${this.useCase.featureFiles.length} Feature(s). Enter a slug for the new one (e.g. "edge-cases").`,
    });
    new Setting(contentEl).setName("Slug").addText((text) =>
      text.setPlaceholder("edge-cases").onChange((value) => (this.slug = value)),
    );
    new Setting(contentEl).addButton((button) =>
      button
        .setButtonText("Create Feature")
        .setCta()
        .onClick(() => {
          const slug = this.slug.trim();
          if (slug === "") {
            new Notice("Please enter a slug for the new Feature.");
            return;
          }
          this.close();
          this.onSubmit(slug);
        }),
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
