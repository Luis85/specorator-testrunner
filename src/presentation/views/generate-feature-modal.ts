import { type App, FuzzySuggestModal, Notice } from "obsidian";
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
 * Thin shell: the slug choice + non-overwrite logic live in the
 * SpecificationService; this only collects the selection and opens the result.
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
    void this.generate(useCase);
  }

  private async generate(useCase: UseCase): Promise<void> {
    const result = await this.deps.specificationService.createFromUseCase(useCase.id);
    if (!result.ok) {
      new Notice(`Could not generate Feature: ${result.error.message}`, 10000);
      return;
    }
    new Notice(`Generated ${result.value.path}.`);
    await this.deps.workspace.openFile(result.value.path);
  }
}
