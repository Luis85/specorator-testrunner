import { type App, Modal, Notice, Setting } from "obsidian";
import type { Prd } from "../../domain/entities/prd";
import type { PrdService } from "../../application/services/prd-service";
import type { StoryMapService } from "../../application/services/story-map-service";
import type { StoryMapBuilderState } from "../../application/services/story-map-builder";
import {
  addLabel,
  addStep,
  canCreateStoryMap,
  formatStep,
  initialStoryMapBuilderState,
  pickProductAnchor,
  removeActivityAt,
  removeLabelAt,
  removeStepAt,
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
  /** Called with the new map's id after a successful create (e.g. to open its board). */
  onCreated?: (storyMapId: string) => void;
}

/**
 * 6-step wizard for creating a Story Map: title + product anchor, users, the
 * backbone (activities), steps, the release slices, then review. Rich cards are
 * added later by editing the note's `cards` frontmatter and rebuilding the grid —
 * the wizard collects the map skeleton (users, backbone, steps, slices).
 */
/** One-line explanations of each label step's jargon, shown under its title. */
const LABEL_STEP_DESC = {
  users: "The audience — the personas who take this journey. Optional.",
  activities: "The backbone: the high-level activities of the journey, left to right.",
  slices:
    "Release bands, top to bottom. The top slice is your thinnest shippable version (the walking skeleton).",
} as const;

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

  // fallow-ignore-next-line complexity
  private async ensurePrdsLoaded(): Promise<void> {
    if (this.prdsLoaded) return;
    let prds = await this.deps.prdService.findAll();
    // Auto-seed the reserved root PRD-000 on an empty vault so creating a Story Map
    // (which must anchor to a PRD) never dead-ends — no detour to build a PRD first.
    if (prds.ok && prds.value.length === 0) {
      const seeded = await this.deps.prdService.create({
        title: "Product",
        domains: [],
        // PrdService.create requires a non-blank vision + at least one in/out-of-scope
        // item; seed sensible, editable placeholders for the reserved root.
        vision: "The product this vault plans, specifies, and tests.",
        scopeIn: ["Define the product scope (edit me)"],
        scopeOut: ["Out of scope (edit me)"],
      });
      if (seeded.ok) prds = await this.deps.prdService.findAll();
    }
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
      2: () => this.renderLabelStep(contentEl, "users", "Add a user/persona (e.g. Test author)"),
      3: () =>
        this.renderLabelStep(contentEl, "activities", "Add an activity (e.g. Configure SUT)"),
      4: () => this.renderStepsStep(contentEl),
      5: () =>
        this.renderLabelStep(contentEl, "slices", "Add a release slice (e.g. Walking skeleton)"),
      6: () => this.renderReview(contentEl),
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
        text:
          "No product PRD exists yet. A Story Map must anchor to a PRD — create one " +
          "first, then start the Story Map.",
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
    field: "users" | "activities" | "slices",
    placeholder: string,
  ): void {
    this.renderError(contentEl, field);
    contentEl.createEl("p", { text: LABEL_STEP_DESC[field], cls: "setting-item-description" });
    const items = this.state[field];
    const container = contentEl.createEl("div", { cls: "story-map-items" });

    for (let i = 0; i < items.length; i++) {
      const itemContainer = container.createEl("div", { cls: "story-map-item" });
      itemContainer.createEl("span", { text: `${i + 1}. ${items[i]}` });
      itemContainer.createEl("button", { text: "Remove" }).addEventListener("click", () => {
        // Removing an activity must also drop its steps (they hang under it by
        // label); otherwise the review shows orphan steps that create() discards.
        this.state =
          field === "activities"
            ? { ...this.state, ...removeActivityAt(items, this.state.steps, i) }
            : { ...this.state, [field]: removeLabelAt(items, i) };
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

  private renderStepsStep(contentEl: HTMLElement): void {
    this.renderError(contentEl, "steps");
    contentEl.createEl("p", {
      text: "Tasks that hang under an activity. Optional — a card can sit directly under an activity.",
      cls: "setting-item-description",
    });
    if (this.state.activities.length === 0) {
      contentEl.createEl("p", {
        text: "Add at least one activity first — steps hang under an activity.",
        cls: "setting-item-description",
      });
      return;
    }
    const container = contentEl.createEl("div", { cls: "story-map-items" });
    this.renderStepList(container);
    this.renderStepAddForm(container);
  }

  private renderStepList(container: HTMLElement): void {
    const steps = this.state.steps;
    for (let i = 0; i < steps.length; i++) {
      const itemContainer = container.createEl("div", { cls: "story-map-item" });
      itemContainer.createEl("span", { text: `${i + 1}. ${formatStep(steps[i])}` });
      itemContainer.createEl("button", { text: "Remove" }).addEventListener("click", () => {
        this.state = { ...this.state, steps: removeStepAt(steps, i) };
        this.render();
      });
    }
  }

  private renderStepAddForm(container: HTMLElement): void {
    let activity = this.state.activities[0];
    let label = "";
    new Setting(container)
      .setName("Step")
      .addDropdown((dropdown) => {
        for (const a of this.state.activities) dropdown.addOption(a, a);
        dropdown.setValue(activity);
        dropdown.onChange((value) => (activity = value));
      })
      .addText((text) => {
        text.setPlaceholder("Step label (e.g. Pick a browser)");
        text.onChange((value) => (label = value));
      });
    container.createEl("button", { text: "Add" }).addEventListener("click", () => {
      const next = addStep(this.state.steps, this.state.activities, activity, label);
      if (next.length === this.state.steps.length) return;
      this.state = { ...this.state, steps: next };
      this.render();
    });
  }

  private renderReview(contentEl: HTMLElement): void {
    contentEl.createEl("h3", { text: "Review Story Map" });
    const summary = contentEl.createEl("div", { cls: "story-map-summary" });
    for (const line of storyMapReviewLines(this.state)) {
      summary.createEl("p", { text: line });
    }
  }

  // fallow-ignore-next-line complexity
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

    // A resolvable product anchor is required before Create. While the PRD list is
    // still loading/seeding (`!prdsLoaded`), treat creation as not-yet-available so a
    // submit can't race ahead of the auto-seed and dead-end with "Unknown product
    // PRD"; `noProduct` is the post-load case where even the seed produced none.
    const productReady = this.prdsLoaded && this.prds.length > 0;
    const noProduct = this.prdsLoaded && this.prds.length === 0;

    // Fast path: once the minimum is met (a title — activities/slices are pre-filled
    // and PRD-000 is auto-seeded), let the user Create from any step rather than
    // walking all six. Hidden until a product anchor has actually resolved.
    if (
      this.state.currentStep < STORY_MAP_STEP_COUNT &&
      canCreateStoryMap(this.state) &&
      productReady
    ) {
      const fastBtn = buttonContainer.createEl("button", { text: "Create now", cls: "mod-cta" });
      fastBtn.setAttribute("data-testid", "create-now-button");
      fastBtn.addEventListener("click", () => void this.create());
    }

    if (this.state.currentStep === STORY_MAP_STEP_COUNT) {
      const createBtn = buttonContainer.createEl("button", { text: "Create", cls: "mod-cta" });
      createBtn.setAttribute("data-testid", "create-button");
      createBtn.disabled = !productReady;
      if (productReady) {
        createBtn.addEventListener("click", () => void this.create());
      } else {
        buttonContainer.createEl("span", {
          text: noProduct
            ? "Could not create a product PRD — create one manually, then retry."
            : "Loading products…",
          cls: "setting-item-description",
        });
      }
    }

    const cancelBtn = buttonContainer.createEl("button", { text: "Cancel" });
    cancelBtn.setAttribute("data-testid", "cancel-button");
    cancelBtn.addEventListener("click", () => this.close());
  }

  // fallow-ignore-next-line complexity
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
      // Jump straight to the new map's board — the primary working surface.
      this.deps.onCreated?.(result.value.id);
    } catch (err) {
      new Notice(errorText("Error creating Story Map", err));
    } finally {
      this.submitting = false;
    }
  }
}
