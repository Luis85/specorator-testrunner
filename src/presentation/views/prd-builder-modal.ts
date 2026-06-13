import { type App, Modal, Notice, Setting } from "obsidian";
import type { EventBus } from "../../shared/event-bus/event-bus";
import type { UseCaseService } from "../../application/services/use-case-service";
import type { PrdBuilderState } from "../../application/services/prd-builder";
import { prdBuilderStepTitle } from "../../application/services/prd-builder";

/** Placeholder PRD service interface for Task 10 - to be fully implemented in Task 12. */
export interface PrdService {
  create(request: CreatePrdRequest): Promise<Result<{ id: string; title: string; path: string }>>;
}

export interface CreatePrdRequest {
  title: string;
  parentPrdId?: string;
  selectedDomains: string[];
  research: string;
  vision: string;
  scopeIn: string[];
  scopeOut: string[];
  selectedUcs: string[];
}

export interface Result<T> {
  ok: boolean;
  error?: { message: string };
  value?: T;
}

/** Settings service interface for getting PRD paths. */
export interface SettingsService {
  load(): Promise<{ paths: Record<string, string> }>;
}

/**
 * Dependencies for PrdBuilderModal.
 */
export interface PrdBuilderDeps {
  prdService: PrdService;
  useCaseService: UseCaseService;
  settingsService: SettingsService;
  eventBus: EventBus;
  openPrdBuilder(callback: () => void): void;
}

/**
 * 7-step wizard modal for creating PRDs.
 * Steps: 1=domains, 2=research, 3=vision, 4=scope, 5=success, 6=assign-UCs, 7=review
 */
export class PrdBuilderModal extends Modal {
  private state: PrdBuilderState;
  private submitting = false;
  private domains: string[] = [];
  private useCases: Array<{ id: string; title: string; domain?: string }> = [];

  constructor(
    app: App,
    private readonly deps: PrdBuilderDeps,
  ) {
    super(app);
    this.state = {
      currentStep: 1,
      title: "",
      parentPrdId: undefined,
      selectedDomains: [],
      research: "",
      vision: "",
      scopeIn: [],
      scopeOut: [],
      selectedUcs: [],
      errorMessages: {},
    };
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    // Load domains and use cases
    void this.loadDomains();

    const currentStepTitle = prdBuilderStepTitle(this.state.currentStep);
    contentEl.createEl("h2", { text: currentStepTitle });

    switch (this.state.currentStep) {
      case 1:
        this.renderStep1Domains(contentEl);
        break;
      case 2:
        this.renderStep2Research(contentEl);
        break;
      case 3:
        this.renderStep3Vision(contentEl);
        break;
      case 4:
        this.renderStep4Scope(contentEl);
        break;
      case 5:
        this.renderStep5Success(contentEl);
        break;
      case 6:
        this.renderStep6AssignUseCases(contentEl);
        break;
      case 7:
        this.renderStep7Review(contentEl);
        break;
    }

    this.renderButtons(contentEl);
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async loadDomains(): Promise<void> {
    const result = await this.deps.useCaseService.findAll();
    if (result.ok) {
      // Extract unique domains from use cases
      const domainSet = new Set<string>();
      for (const uc of result.value) {
        if ((uc as any).domain) {
          domainSet.add((uc as any).domain);
        }
      }
      this.domains = Array.from(domainSet).sort();
      this.useCases = result.value as any;
    }
  }

  private renderStep1Domains(contentEl: HTMLElement): void {
    const errorMsg = this.state.errorMessages.selectedDomains;
    if (errorMsg) {
      contentEl.createEl("p", { text: errorMsg, cls: "error-text" });
    }

    contentEl.createEl("p", { text: "Select the domain(s) this PRD covers:" });

    for (const domain of this.domains) {
      const container = contentEl.createEl("div");
      const checkbox = container.createEl("input", { attr: { type: "checkbox" } });
      checkbox.id = `domain-${domain}`;
      checkbox.checked = this.state.selectedDomains.includes(domain);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked && !this.state.selectedDomains.includes(domain)) {
          this.state = { ...this.state, selectedDomains: [...this.state.selectedDomains, domain] };
        } else if (!checkbox.checked) {
          this.state = {
            ...this.state,
            selectedDomains: this.state.selectedDomains.filter((d) => d !== domain),
          };
        }
      });

      const label = container.createEl("label", { text: domain });
      label.htmlFor = checkbox.id;
    }
  }

  private renderStep2Research(contentEl: HTMLElement): void {
    const errorMsg = this.state.errorMessages.research;
    if (errorMsg) {
      contentEl.createEl("p", { text: errorMsg, cls: "error-text" });
    }

    new Setting(contentEl)
      .setName("Research Findings")
      .setDesc("Optional summary of market research, competitive analysis, etc.")
      .addTextArea((area) => {
        area.setValue(this.state.research);
        area.onChange((value) => {
          this.state = { ...this.state, research: value };
        });
      });
  }

  private renderStep3Vision(contentEl: HTMLElement): void {
    const errorMsg = this.state.errorMessages.vision;
    if (errorMsg) {
      contentEl.createEl("p", { text: errorMsg, cls: "error-text" });
    }

    new Setting(contentEl)
      .setName("Vision Statement")
      .setDesc("Required: describe the desired future state (1-2 sentences)")
      .addTextArea((area) => {
        area.setValue(this.state.vision);
        area.onChange((value) => {
          this.state = { ...this.state, vision: value };
        });
      });
  }

  private renderStep4Scope(contentEl: HTMLElement): void {
    const errorMsg = this.state.errorMessages.scopeIn;
    if (errorMsg) {
      contentEl.createEl("p", { text: errorMsg, cls: "error-text" });
    }

    contentEl.createEl("h3", { text: "In Scope" });
    this.renderScopeItems(contentEl, "scopeIn");

    contentEl.createEl("h3", { text: "Out of Scope" });
    this.renderScopeItems(contentEl, "scopeOut");
  }

  private renderScopeItems(
    contentEl: HTMLElement,
    field: "scopeIn" | "scopeOut",
  ): void {
    const items = this.state[field];
    const container = contentEl.createEl("div", { cls: "scope-items" });

    for (let i = 0; i < items.length; i++) {
      const itemContainer = container.createEl("div", { cls: "scope-item" });
      itemContainer.createEl("span", { text: items[i] });
      itemContainer.createEl("button", { text: "Remove" }).addEventListener("click", () => {
        this.state = {
          ...this.state,
          [field]: items.filter((_, idx) => idx !== i),
        };
        this.onOpen();
      });
    }

    new Setting(container).addText((text) => {
      text.setPlaceholder(`Add ${field === "scopeIn" ? "in scope" : "out of scope"} item...`);
      text.onChange((value) => {
        if (value.trim().length > 0) {
          // Don't actually add yet - wait for user to press button
        }
      });
      const input = text.inputEl;

      container.createEl("button", { text: "Add" }).addEventListener("click", () => {
        const value = input.value.trim();
        if (value.length > 0) {
          this.state = {
            ...this.state,
            [field]: [...items, value],
          };
          input.value = "";
          this.onOpen();
        }
      });
    });
  }

  private renderStep5Success(contentEl: HTMLElement): void {
    const errorMsg = this.state.errorMessages.successMetrics;
    if (errorMsg) {
      contentEl.createEl("p", { text: errorMsg, cls: "error-text" });
    }

    new Setting(contentEl)
      .setName("Success Metrics")
      .setDesc("Optional: define how to measure success")
      .addTextArea((area) => {
        // Reuse research field for now as temp storage
        area.setValue("");
        area.onChange((value) => {
          // Store in a temp field or extend state
        });
      });
  }

  private renderStep6AssignUseCases(contentEl: HTMLElement): void {
    const errorMsg = this.state.errorMessages.selectedUcs;
    if (errorMsg) {
      contentEl.createEl("p", { text: errorMsg, cls: "error-text" });
    }

    contentEl.createEl("p", { text: "Select Use Cases to assign to this PRD:" });

    // Filter use cases by selected domains
    const filtered = this.useCases.filter((uc) => {
      if (this.state.selectedDomains.length === 0) return true;
      return this.state.selectedDomains.includes((uc as any).domain || "");
    });

    for (const uc of filtered) {
      const container = contentEl.createEl("div");
      const checkbox = container.createEl("input", { attr: { type: "checkbox" } });
      checkbox.id = `uc-${uc.id}`;
      checkbox.checked = this.state.selectedUcs.includes(uc.id);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked && !this.state.selectedUcs.includes(uc.id)) {
          this.state = { ...this.state, selectedUcs: [...this.state.selectedUcs, uc.id] };
        } else if (!checkbox.checked) {
          this.state = {
            ...this.state,
            selectedUcs: this.state.selectedUcs.filter((id) => id !== uc.id),
          };
        }
      });

      const label = container.createEl("label", { text: `${uc.id} — ${uc.title}` });
      label.htmlFor = checkbox.id;
    }
  }

  private renderStep7Review(contentEl: HTMLElement): void {
    contentEl.createEl("h3", { text: "Review PRD Details" });

    const summary = contentEl.createEl("div", { cls: "prd-summary" });
    summary.createEl("p", { text: `Title: ${this.state.title}` });
    summary.createEl("p", { text: `Domains: ${this.state.selectedDomains.join(", ") || "None"}` });
    summary.createEl("p", { text: `Vision: ${this.state.vision}` });
    summary.createEl("p", {
      text: `Scope In: ${this.state.scopeIn.length > 0 ? this.state.scopeIn.join(", ") : "None"}`,
    });
    summary.createEl("p", {
      text: `Scope Out: ${this.state.scopeOut.length > 0 ? this.state.scopeOut.join(", ") : "None"}`,
    });
    summary.createEl("p", {
      text: `Use Cases: ${this.state.selectedUcs.length > 0 ? this.state.selectedUcs.join(", ") : "None"}`,
    });
  }

  private renderButtons(contentEl: HTMLElement): void {
    const buttonContainer = contentEl.createEl("div", { cls: "button-container" });

    const prevBtn = buttonContainer.createEl("button", { text: "Previous" });
    prevBtn.setAttribute("data-testid", "prev-button");
    prevBtn.disabled = this.state.currentStep === 1;
    prevBtn.addEventListener("click", () => {
      if (this.state.currentStep > 1) {
        this.state = { ...this.state, currentStep: this.state.currentStep - 1 };
        this.onOpen();
      }
    });

    const nextBtn = buttonContainer.createEl("button", { text: "Next" });
    nextBtn.setAttribute("data-testid", "next-button");
    nextBtn.disabled = this.state.currentStep === 7;
    nextBtn.addEventListener("click", () => {
      if (this.state.currentStep < 7) {
        this.state = { ...this.state, currentStep: this.state.currentStep + 1 };
        this.onOpen();
      }
    });

    if (this.state.currentStep === 7) {
      const createBtn = buttonContainer.createEl("button", { text: "Create", cls: "mod-cta" });
      createBtn.setAttribute("data-testid", "create-button");
      createBtn.addEventListener("click", () => void this.create());
    }

    const cancelBtn = buttonContainer.createEl("button", { text: "Cancel" });
    cancelBtn.setAttribute("data-testid", "cancel-button");
    cancelBtn.addEventListener("click", () => this.close());
  }

  private async create(): Promise<void> {
    if (this.submitting) return;
    this.submitting = true;

    try {
      const result = await this.deps.prdService.create({
        title: this.state.title,
        parentPrdId: this.state.parentPrdId,
        selectedDomains: this.state.selectedDomains,
        research: this.state.research,
        vision: this.state.vision,
        scopeIn: this.state.scopeIn,
        scopeOut: this.state.scopeOut,
        selectedUcs: this.state.selectedUcs,
      });

      if (!result.ok) {
        new Notice(`Could not create PRD: ${result.error?.message || "Unknown error"}`);
        this.submitting = false;
        return;
      }

      new Notice(`Created PRD: ${result.value!.title}`);
      this.close();
    } catch (err) {
      new Notice(`Error creating PRD: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      this.submitting = false;
    }
  }
}
