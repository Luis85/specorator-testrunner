import { type App, Modal, Notice, Setting } from "obsidian";
import type { StoryMapService } from "../../application/services/story-map-service";
import { encodeCard, type StoryMap, type StoryMapCard } from "../../domain/entities/story-map";
import {
  buildCardFromForm,
  cardToForm,
  type CardFormValues,
  initialCardForm,
  NO_STATUS_OPTION,
  NO_STEP_OPTION,
  statusOptions,
  stepOptionsFor,
} from "../../application/services/story-map-card-form";

export interface StoryMapCardDeps {
  storyMapService: Pick<StoryMapService, "addCard" | "updateCard">;
  map: StoryMap;
  /** The index to edit, or undefined to add a new card. */
  editIndex?: number;
  /** Card to seed the edit form; undefined when adding. */
  card?: StoryMapCard;
  /** Run after a successful add/update so the opener can refresh. */
  onSaved?: () => void;
}

/**
 * Add/edit ONE rich card on a Story Map without hand-editing frontmatter
 * (ADR-0028). Fields mirror the map's axes (activity/step/slice dropdowns) plus
 * the map-owned planning attributes. Every method stays ≤4 cyclomatic by pushing
 * the form-to-card projection into the tested {@link buildCardFromForm} helper
 * and the validation into the service.
 */
export class StoryMapCardModal extends Modal {
  private values: CardFormValues;
  private submitting = false;

  constructor(
    app: App,
    private readonly deps: StoryMapCardDeps,
  ) {
    super(app);
    this.values = deps.card ? cardToForm(deps.card) : initialCardForm(deps.map);
  }

  onOpen(): void {
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", {
      text: this.deps.editIndex === undefined ? "Add card" : "Edit card",
    });
    this.renderActivity(contentEl);
    this.renderStep(contentEl);
    this.renderSlice(contentEl);
    this.renderReference(contentEl);
    this.renderTitle(contentEl);
    this.renderStatus(contentEl);
    this.renderPoints(contentEl);
    this.renderTags(contentEl);
    this.renderColor(contentEl);
    this.renderSubmit(contentEl);
  }

  private renderActivity(contentEl: HTMLElement): void {
    new Setting(contentEl).setName("Activity").addDropdown((dropdown) => {
      for (const activity of this.deps.map.activities) dropdown.addOption(activity, activity);
      dropdown.setValue(this.values.activity);
      dropdown.onChange((value) => this.onActivityChange(value));
    });
  }

  /** Changing the activity resets the step (steps belong to one activity). */
  private onActivityChange(activity: string): void {
    this.values = { ...this.values, activity, step: NO_STEP_OPTION };
    this.render();
  }

  private renderStep(contentEl: HTMLElement): void {
    const steps = stepOptionsFor(this.deps.map, this.values.activity);
    new Setting(contentEl)
      .setName("Step")
      .setDesc("Optional task level under the activity.")
      .addDropdown((dropdown) => {
        dropdown.addOption(NO_STEP_OPTION, "(No step)");
        for (const step of steps) dropdown.addOption(step, step);
        dropdown.setValue(this.values.step);
        dropdown.onChange((value) => (this.values = { ...this.values, step: value }));
      });
  }

  private renderSlice(contentEl: HTMLElement): void {
    new Setting(contentEl).setName("Slice").addDropdown((dropdown) => {
      for (const slice of this.deps.map.slices) dropdown.addOption(slice, slice);
      dropdown.setValue(this.values.slice);
      dropdown.onChange((value) => (this.values = { ...this.values, slice: value }));
    });
  }

  private renderReference(contentEl: HTMLElement): void {
    new Setting(contentEl)
      .setName("Reference")
      .setDesc("Optional Use Case ID.")
      .addText((text) => {
        text.setPlaceholder("E.g. An existing Use Case ID").setValue(this.values.ref);
        text.onChange((value) => (this.values = { ...this.values, ref: value }));
      });
  }

  private renderTitle(contentEl: HTMLElement): void {
    new Setting(contentEl)
      .setName("Title")
      .setDesc("Required for a card with no reference.")
      .addText((text) => {
        text.setPlaceholder("E.g. Choose a parser").setValue(this.values.title);
        text.onChange((value) => (this.values = { ...this.values, title: value }));
      });
  }

  private renderStatus(contentEl: HTMLElement): void {
    new Setting(contentEl).setName("Planning status").addDropdown((dropdown) => {
      dropdown.addOption(NO_STATUS_OPTION, "(None)");
      for (const status of statusOptions()) dropdown.addOption(status, status);
      dropdown.setValue(this.values.status);
      dropdown.onChange((value) => (this.values = { ...this.values, status: value }));
    });
  }

  private renderPoints(contentEl: HTMLElement): void {
    new Setting(contentEl).setName("Points").addText((text) => {
      text.inputEl.type = "number";
      text.setPlaceholder("Optional").setValue(this.values.points);
      text.onChange((value) => (this.values = { ...this.values, points: value }));
    });
  }

  private renderTags(contentEl: HTMLElement): void {
    new Setting(contentEl)
      .setName("Tags")
      .setDesc("Comma-separated.")
      .addText((text) => {
        text.setPlaceholder("E.g. Auth, infra").setValue(this.values.tags);
        text.onChange((value) => (this.values = { ...this.values, tags: value }));
      });
  }

  private renderColor(contentEl: HTMLElement): void {
    new Setting(contentEl).setName("Color").addText((text) => {
      text.setPlaceholder("Optional token or hex").setValue(this.values.color);
      text.onChange((value) => (this.values = { ...this.values, color: value }));
    });
  }

  private renderSubmit(contentEl: HTMLElement): void {
    new Setting(contentEl).addButton((button) =>
      button
        .setButtonText("Save")
        .setCta()
        .onClick(() => void this.submit()),
    );
  }

  private async submit(): Promise<void> {
    if (this.submitting) return;
    this.submitting = true;
    const result = await this.persist(buildCardFromForm(this.values));
    this.submitting = false;
    if (!result.ok) {
      new Notice(`Could not save card: ${result.error.message}`);
      return;
    }
    new Notice("Saved card.");
    this.close();
    this.deps.onSaved?.();
  }

  /** Routes to add or update based on whether an edit index was supplied. */
  private persist(card: StoryMapCard) {
    const { storyMapService, map, editIndex, card: original } = this.deps;
    if (editIndex === undefined) return storyMapService.addCard(map.id, card);
    // Guard the edit against a stale index: pass the card we opened on, so the
    // service rejects if a concurrent change moved a different card to this index.
    const expected = original ? encodeCard(original) : undefined;
    return storyMapService.updateCard(map.id, editIndex, card, expected);
  }
}
