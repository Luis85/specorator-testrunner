import { type App, Modal, Notice, Setting } from "obsidian";
import type { Prd } from "../../domain/entities/prd";
import type { PrdService } from "../../application/services/prd-service";
import type { StoryMapService } from "../../application/services/story-map-service";
import type { StoryMapBuilderState } from "../../application/services/story-map-builder";
import {
  addLabel,
  initialStoryMapBuilderState,
  pickProductAnchor,
  removeLabelAt,
  STORY_MAP_STEP_COUNT,
  storyMapBuilderStepTitle,
  storyMapReviewLines,
  toCreateStoryMapRequest,
} from "../../application/services/story-map-builder";
import { errorText } from "./modal-helpers";

/**
 * Dependencies for {@link StoryMapBuilderModal}. Mirrors the narrow-contract
 * pattern the other creation modals use: only the services the modal drives.
 */
export interface StoryMapBuilderDeps {
  storyMapService: StoryMapService;
  /** Used to populate the product (PRD) anchor dropdown. */
  prdService: PrdService;
}

/**
 * 4-step wizard for creating a Story Map: title + product anchor, the backbone
 * (activities), the release slices, then review. Use Case cards are added later
 * by editing the note's `cards` frontmatter and rebuilding the grid — the wizard
 * deliberately collects only the two new facts (sequence + slices).
 */
export class StoryMapBuilderModal extends Modal {
  private state: StoryMapBuilderState = initialStoryMapBuilderState();
  private submitting = false;
  private prdsLoaded = false;
  private prds: Prd[] = [];

  constructor(
    app: App,
    private readonly deps: StoryMapBuilderDeps,
  ) {
    super(app);
  }

  onOpen(): void {
    void this.ensurePrdsLoaded();
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async ensurePrdsLoaded(): Promise<void> {
    if (this.prdsLoaded) return;
    const prds = await this.deps.prdService.findAll();
    if (prds.ok) {
      this.prds = prds.value;
      this.state = { ...this.state, product: pickProductAnchor(prds.value) };
    }
    this.prdsLoaded = true;
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: storyMapBuilderStepTitle(this.state.currentStep) });

    // Step → body renderer lookup keeps this method a single dispatch (rather
    // than a branching switch); each renderer is a thin view over builder state.
    const renderers: Record<number, () => void> = {
      1: () => this.renderStep1TitleAndProduct(contentEl),
      2: () =>
        this.renderLabelStep(contentEl, "activities", "Add an activity (e.g. Configure SUT)"),
      3: () =>
        this.renderLabelStep(contentEl, "slices", "Add a release slice (e.g. Walking skeleton)"),
      4: () => this.renderStep4Review(contentEl),
    };
    renderers[this.state.currentStep]?.();

    this.renderButtons(contentEl);
  }

  private renderError(contentEl: HTMLElement, field: string): void {
    const errorMsg = this.state.errorMessages[field];
    if (errorMsg) contentEl.createEl("p", { text: errorMsg, cls: "error-text" });
  }

  private renderStep1TitleAndProduct(contentEl: HTMLElement): void {
    this.renderError(contentEl, "title");
    new Setting(contentEl).setName("Title").addText((text) => {
      text
        .setPlaceholder("E.g. End-to-end authoring journey")
        .setValue(this.state.title)
        .onChange((value) => {
          this.state = { ...this.state, title: value };
        });
      text.inputEl.focus();
    });

    if (this.prds.length === 0) {
      contentEl.createEl("p", {
        text: "No PRDs found — this map will anchor to the product root (PRD-000).",
        cls: "setting-item-description",
      });
      return;
    }
    new Setting(contentEl)
      .setName("Product")
      .setDesc("The PRD whose product this map shapes (defaults to the root).")
      .addDropdown((dropdown) => {
        for (const prd of this.prds) dropdown.addOption(prd.id, `${prd.id}: ${prd.title}`);
        dropdown.setValue(this.state.product);
        dropdown.onChange((value) => {
          this.state = { ...this.state, product: value };
        });
      });
  }

  private renderLabelStep(
    contentEl: HTMLElement,
    field: "activities" | "slices",
    placeholder: string,
  ): void {
    this.renderError(contentEl, field);
    const items = this.state[field];
    const container = contentEl.createEl("div", { cls: "story-map-items" });

    for (let i = 0; i < items.length; i++) {
      const itemContainer = container.createEl("div", { cls: "story-map-item" });
      itemContainer.createEl("span", { text: `${i + 1}. ${items[i]}` });
      itemContainer.createEl("button", { text: "Remove" }).addEventListener("click", () => {
        this.state = { ...this.state, [field]: removeLabelAt(items, i) };
        this.render();
      });
    }

    new Setting(container).addText((text) => {
      text.setPlaceholder(placeholder);
      const input = text.inputEl;
      const commit = (): void => {
        const next = addLabel(items, input.value);
        if (next.length === items.length) return;
        this.state = { ...this.state, [field]: next };
        this.render();
      };
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
      });
      container.createEl("button", { text: "Add" }).addEventListener("click", () => commit());
    });
  }

  private renderStep4Review(contentEl: HTMLElement): void {
    contentEl.createEl("h3", { text: "Review Story Map" });
    const summary = contentEl.createEl("div", { cls: "story-map-summary" });
    for (const line of storyMapReviewLines(this.state)) {
      summary.createEl("p", { text: line });
    }
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
    nextBtn.disabled = this.state.currentStep === STORY_MAP_STEP_COUNT;
    nextBtn.addEventListener("click", () => {
      if (this.state.currentStep < STORY_MAP_STEP_COUNT) {
        this.state = { ...this.state, currentStep: this.state.currentStep + 1 };
        this.render();
      }
    });

    if (this.state.currentStep === STORY_MAP_STEP_COUNT) {
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
      const result = await this.deps.storyMapService.create(toCreateStoryMapRequest(this.state));
      if (!result.ok) {
        new Notice(`Could not create Story Map: ${result.error.message}`);
        this.submitting = false;
        return;
      }
      new Notice(`Created Story Map: ${result.value.id}`);
      this.close();
    } catch (err) {
      new Notice(errorText("Error creating Story Map", err));
    } finally {
      this.submitting = false;
    }
  }
}
