import { type App, Modal, Notice, Setting } from "obsidian";
import type { Prd } from "../../domain/entities/prd";
import type { UseCase } from "../../domain/entities/use-case";
import type { CreatePrdRequest, PrdService } from "../../application/services/prd-service";
import type { UseCaseService } from "../../application/services/use-case-service";
import type { PrdBuilderState } from "../../application/services/prd-builder";
import { prdBuilderStepTitle } from "../../application/services/prd-builder";

/**
 * Resolve the parent for a new PRD. An explicit parent (Explorer "＋ sub-PRD")
 * always wins. Otherwise, when PRDs already exist the new PRD defaults to a child
 * of the root (PRD-000 if present, else the first parentless PRD) so it is never
 * accidentally created as a second root; with no PRDs yet it stays parentless
 * (it becomes the root product vision).
 */
export const resolveParentPrdId = (
  explicit: string | undefined,
  prds: Prd[],
): string | undefined => {
  if (explicit !== undefined) return explicit;
  if (prds.length === 0) return undefined;
  return (
    prds.find((p) => p.id === "PRD-000")?.id ??
    prds.find((p) => p.parentPrdId === undefined)?.id ??
    prds[0]?.id
  );
};

/**
 * Dependencies for {@link PrdBuilderModal}. Mirrors the narrow-contract pattern
 * used by the other creation modals (e.g. CreateUseCaseModal): the modal depends
 * only on the application services it actually drives, not the composition root.
 */
export interface PrdBuilderDeps {
  prdService: PrdService;
  useCaseService: UseCaseService;
  /**
   * Parent for the new PRD. Passed by the Explorer's "＋ sub-PRD" action. When
   * omitted, the builder defaults to the root PRD as parent (or, if no PRDs
   * exist yet, creates the root itself).
   */
  parentPrdId?: string;
}

/**
 * 7-step wizard modal for creating PRDs.
 * Steps: 1=title+domains, 2=research, 3=vision, 4=scope, 5=success, 6=assign-UCs, 7=review
 *
 * The wizard collects everything {@link PrdService.create} needs (title, domains,
 * vision, scope) and, on success, links the chosen Use Cases to the new PRD via
 * {@link PrdService.assignUseCaseToPrd}. Research/success-criteria are surfaced as
 * editable sections in the generated note rather than service inputs.
 */
export class PrdBuilderModal extends Modal {
  private state: PrdBuilderState;
  private submitting = false;
  private catalogLoaded = false;
  private domains: string[] = [];
  private useCases: UseCase[] = [];
  private prds: Prd[] = [];

  constructor(
    app: App,
    private readonly deps: PrdBuilderDeps,
  ) {
    super(app);
    this.state = {
      currentStep: 1,
      title: "",
      parentPrdId: deps.parentPrdId,
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
    // Load the domain/UC catalog once per modal lifetime; the first paint runs
    // synchronously (possibly with an empty catalog), then re-renders when the
    // async load resolves so the Domains step is never stuck empty.
    void this.ensureCatalogLoaded();
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async ensureCatalogLoaded(): Promise<void> {
    if (this.catalogLoaded) return;
    const [ucs, prds] = await Promise.all([
      this.deps.useCaseService.findAll(),
      this.deps.prdService.findAll(),
    ]);
    if (ucs.ok) {
      this.useCases = ucs.value;
      this.domains = Array.from(
        new Set(ucs.value.map((uc) => uc.domain).filter((d): d is string => Boolean(d))),
      ).sort();
    }
    if (prds.ok) {
      this.prds = prds.value;
      this.state = {
        ...this.state,
        parentPrdId: resolveParentPrdId(this.deps.parentPrdId, this.prds),
      };
    }
    this.catalogLoaded = true;
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: prdBuilderStepTitle(this.state.currentStep) });

    switch (this.state.currentStep) {
      case 1:
        this.renderStep1TitleAndDomains(contentEl);
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

  /** Renders a list of toggleable checkboxes (shared by domains and Use Cases). */
  private renderCheckboxList(
    parent: HTMLElement,
    rows: { id: string; label: string }[],
    isChecked: (id: string) => boolean,
    onToggle: (id: string, checked: boolean) => void,
  ): void {
    for (const row of rows) {
      const container = parent.createEl("div");
      const checkbox = container.createEl("input", { attr: { type: "checkbox" } });
      checkbox.id = `prd-opt-${row.id}`;
      checkbox.checked = isChecked(row.id);
      checkbox.addEventListener("change", () => onToggle(row.id, checkbox.checked));
      const label = container.createEl("label", { text: row.label });
      label.htmlFor = checkbox.id;
    }
  }

  private renderError(contentEl: HTMLElement, field: string): void {
    const errorMsg = this.state.errorMessages[field];
    if (errorMsg) {
      contentEl.createEl("p", { text: errorMsg, cls: "error-text" });
    }
  }

  private renderStep1TitleAndDomains(contentEl: HTMLElement): void {
    this.renderError(contentEl, "title");

    new Setting(contentEl).setName("Title").addText((text) => {
      text
        .setPlaceholder("E.g. Reporting & dashboards")
        .setValue(this.state.title)
        .onChange((value) => {
          this.state = { ...this.state, title: value };
        });
      text.inputEl.focus();
    });

    this.renderParentSelector(contentEl);

    this.renderError(contentEl, "selectedDomains");
    contentEl.createEl("p", { text: "Select the domain(s) this prd covers:" });

    this.renderCheckboxList(
      contentEl,
      this.domains.map((d) => ({ id: d, label: d })),
      (id) => this.state.selectedDomains.includes(id),
      (id, checked) => {
        this.state = {
          ...this.state,
          selectedDomains: checked
            ? [...this.state.selectedDomains, id]
            : this.state.selectedDomains.filter((d) => d !== id),
        };
      },
    );
  }

  /**
   * Lets the user choose this PRD's parent. With no existing PRDs the new PRD is
   * the root (no control). Otherwise a dropdown lists existing PRDs, defaulting
   * to the root, so a sub-PRD is never accidentally created as a second root.
   */
  private renderParentSelector(contentEl: HTMLElement): void {
    if (this.prds.length === 0) {
      contentEl.createEl("p", {
        text: "This is the first prd — it will become the root product vision (prd-000).",
      });
      return;
    }

    new Setting(contentEl)
      .setName("Parent prd")
      .setDesc("Sub-PRDs hang under a parent (defaults to the product vision).")
      .addDropdown((dropdown) => {
        for (const prd of this.prds) {
          dropdown.addOption(prd.id, `${prd.id}: ${prd.title}`);
        }
        if (this.state.parentPrdId) dropdown.setValue(this.state.parentPrdId);
        dropdown.onChange((value) => {
          this.state = { ...this.state, parentPrdId: value };
        });
      });
  }

  private renderStep2Research(contentEl: HTMLElement): void {
    this.renderError(contentEl, "research");

    new Setting(contentEl)
      .setName("Research findings")
      .setDesc("Optional summary of market research, competitive analysis, etc.")
      .addTextArea((area) => {
        area.setValue(this.state.research);
        area.onChange((value) => {
          this.state = { ...this.state, research: value };
        });
      });
  }

  private renderStep3Vision(contentEl: HTMLElement): void {
    this.renderError(contentEl, "vision");

    new Setting(contentEl)
      .setName("Vision statement")
      .setDesc("Required: describe the desired future state (1-2 sentences)")
      .addTextArea((area) => {
        area.setValue(this.state.vision);
        area.onChange((value) => {
          this.state = { ...this.state, vision: value };
        });
      });
  }

  private renderStep4Scope(contentEl: HTMLElement): void {
    this.renderError(contentEl, "scopeIn");

    contentEl.createEl("h3", { text: "In scope" });
    this.renderScopeItems(contentEl, "scopeIn");

    contentEl.createEl("h3", { text: "Out of scope" });
    this.renderScopeItems(contentEl, "scopeOut");
  }

  private renderScopeItems(contentEl: HTMLElement, field: "scopeIn" | "scopeOut"): void {
    const items = this.state[field];
    const container = contentEl.createEl("div", { cls: "scope-items" });

    for (let i = 0; i < items.length; i++) {
      const itemContainer = container.createEl("div", { cls: "scope-item" });
      itemContainer.createEl("span", { text: items[i] });
      itemContainer.createEl("button", { text: "Remove" }).addEventListener("click", () => {
        this.state = { ...this.state, [field]: items.filter((_, idx) => idx !== i) };
        this.render();
      });
    }

    new Setting(container).addText((text) => {
      text.setPlaceholder(`Add ${field === "scopeIn" ? "in scope" : "out of scope"} item...`);
      const input = text.inputEl;

      container.createEl("button", { text: "Add" }).addEventListener("click", () => {
        const value = input.value.trim();
        if (value.length > 0) {
          this.state = { ...this.state, [field]: [...items, value] };
          input.value = "";
          this.render();
        }
      });
    });
  }

  private renderStep5Success(contentEl: HTMLElement): void {
    // Success criteria are not a PrdService.create() input; they live as an
    // editable section in the generated note. Surface that instead of an inert
    // control so the wizard never collects input it silently drops.
    contentEl.createEl("p", {
      text:
        "Success criteria are captured in the generated PRD note under its " +
        '"Success Criteria" section — open the note after creation to fill them in.',
    });
  }

  private renderStep6AssignUseCases(contentEl: HTMLElement): void {
    this.renderError(contentEl, "selectedUcs");
    contentEl.createEl("p", { text: "Select Use Cases to assign to this prd:" });

    // Scope the list to the chosen domains (all UCs when no domain is selected).
    const filtered = this.useCases.filter((uc) => {
      if (this.state.selectedDomains.length === 0) return true;
      return this.state.selectedDomains.includes(uc.domain ?? "");
    });

    this.renderCheckboxList(
      contentEl,
      filtered.map((uc) => ({ id: uc.id, label: `${uc.id} — ${uc.title}` })),
      (id) => this.state.selectedUcs.includes(id),
      (id, checked) => {
        this.state = {
          ...this.state,
          selectedUcs: checked
            ? [...this.state.selectedUcs, id]
            : this.state.selectedUcs.filter((ucId) => ucId !== id),
        };
      },
    );
  }

  private renderStep7Review(contentEl: HTMLElement): void {
    contentEl.createEl("h3", { text: "Review prd details" });

    const summary = contentEl.createEl("div", { cls: "prd-summary" });
    summary.createEl("p", { text: `Title: ${this.state.title || "(none)"}` });
    summary.createEl("p", {
      text: `Parent: ${this.state.parentPrdId ?? "None (root product vision)"}`,
    });
    summary.createEl("p", { text: `Domains: ${this.state.selectedDomains.join(", ") || "None"}` });
    summary.createEl("p", { text: `Vision: ${this.state.vision || "(none)"}` });
    summary.createEl("p", { text: `Scope In: ${this.state.scopeIn.join(", ") || "None"}` });
    summary.createEl("p", { text: `Scope Out: ${this.state.scopeOut.join(", ") || "None"}` });
    summary.createEl("p", { text: `Use Cases: ${this.state.selectedUcs.join(", ") || "None"}` });
  }

  private renderButtons(contentEl: HTMLElement): void {
    const buttonContainer = contentEl.createEl("div", { cls: "button-container" });

    const prevBtn = buttonContainer.createEl("button", { text: "Previous" });
    prevBtn.setAttribute("data-testid", "prev-button");
    prevBtn.disabled = this.state.currentStep === 1;
    prevBtn.addEventListener("click", () => {
      if (this.state.currentStep > 1) {
        this.state = { ...this.state, currentStep: this.state.currentStep - 1 };
        this.render();
      }
    });

    const nextBtn = buttonContainer.createEl("button", { text: "Next" });
    nextBtn.setAttribute("data-testid", "next-button");
    nextBtn.disabled = this.state.currentStep === 7;
    nextBtn.addEventListener("click", () => {
      if (this.state.currentStep < 7) {
        this.state = { ...this.state, currentStep: this.state.currentStep + 1 };
        this.render();
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
      const request: CreatePrdRequest = {
        title: this.state.title,
        parentPrdId: this.state.parentPrdId,
        domains: this.state.selectedDomains,
        vision: this.state.vision,
        scopeIn: this.state.scopeIn,
        scopeOut: this.state.scopeOut,
        research: this.state.research,
      };
      const result = await this.deps.prdService.create(request);

      if (!result.ok) {
        new Notice(`Could not create PRD: ${result.error.message}`);
        this.submitting = false;
        return;
      }

      await this.assignSelectedUseCases(result.value.id);

      new Notice(`Created PRD: ${result.value.id}`);
      this.close();
    } catch (err) {
      new Notice(`Error creating PRD: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      this.submitting = false;
    }
  }

  /** Links each chosen Use Case to the new PRD, reporting any per-UC failure. */
  private async assignSelectedUseCases(prdId: string): Promise<void> {
    for (const ucId of this.state.selectedUcs) {
      const uc = this.useCases.find((u) => u.id === ucId);
      if (!uc) continue;
      const assigned = await this.deps.prdService.assignUseCaseToPrd(uc.path, prdId);
      if (!assigned.ok) {
        new Notice(`Created ${prdId} but could not assign ${ucId}: ${assigned.error.message}`);
      }
    }
  }
}
