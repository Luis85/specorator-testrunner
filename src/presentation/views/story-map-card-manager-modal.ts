import { type App, Modal, Notice } from "obsidian";
import type { StoryMapService } from "../../application/services/story-map-service";
import type { StoryMap } from "../../domain/entities/story-map";
import { type CardManagerRow, projectCardManagerRows } from "./story-map-card-rows";
import { StoryMapCardModal } from "./story-map-card-modal";

export interface StoryMapCardManagerDeps {
  storyMapService: Pick<StoryMapService, "addCard" | "updateCard" | "removeCard" | "findById">;
}

/**
 * Lists a Story Map's cards (title + coordinate + attributes) with per-card Edit
 * and Remove, plus an Add-card button (ADR-0028 authoring UI). Opening the
 * editor or removing a card refreshes the list from the service so the manager
 * always reflects the persisted state. View methods stay thin — row shaping is
 * the tested {@link projectCardManagerRows}.
 */
export class StoryMapCardManagerModal extends Modal {
  constructor(
    app: App,
    private map: StoryMap,
    private readonly deps: StoryMapCardManagerDeps,
  ) {
    super(app);
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
    contentEl.createEl("h2", { text: `Cards · ${this.map.id}` });

    const rows = projectCardManagerRows(this.map.cards);
    if (rows.length === 0) {
      contentEl.createEl("p", { text: "No cards yet. Add the first one below." });
    } else {
      const list = contentEl.createEl("ul", { cls: "e2e-test-hub-story-map-card-list" });
      for (const row of rows) this.renderRow(list, row);
    }

    contentEl
      .createEl("button", { text: "Add card", cls: "mod-cta" })
      .addEventListener("click", () => this.openEditor());
  }

  private renderRow(parent: HTMLElement, row: CardManagerRow): void {
    const li = parent.createEl("li", { cls: "e2e-test-hub-story-map-card-node" });
    li.createEl("span", { text: row.title, cls: "e2e-test-hub-story-map-card-title" });
    li.createEl("span", { text: ` — ${row.coordinate}`, cls: "e2e-test-hub-story-map-card-coord" });
    if (row.attributes !== "") {
      li.createEl("span", {
        text: ` · ${row.attributes}`,
        cls: "e2e-test-hub-story-map-card-attrs",
      });
    }
    li.createEl("button", { text: "Edit", cls: "e2e-test-hub-link-button" }).addEventListener(
      "click",
      () => this.openEditor(row.index),
    );
    li.createEl("button", { text: "Remove", cls: "e2e-test-hub-link-button" }).addEventListener(
      "click",
      () => void this.remove(row.index),
    );
  }

  /** Opens the card editor for an existing index, or to add when undefined. */
  private openEditor(index?: number): void {
    new StoryMapCardModal(this.app, {
      storyMapService: this.deps.storyMapService,
      map: this.map,
      editIndex: index,
      card: index === undefined ? undefined : this.map.cards[index],
      onSaved: () => void this.refresh(),
    }).open();
  }

  private async remove(index: number): Promise<void> {
    const result = await this.deps.storyMapService.removeCard(this.map.id, index);
    if (!result.ok) {
      new Notice(`Could not remove card: ${result.error.message}`);
      return;
    }
    new Notice("Removed card.");
    this.map = result.value;
    this.render();
  }

  /** Re-reads the map after an add/edit so the list mirrors persisted state. */
  private async refresh(): Promise<void> {
    const found = await this.deps.storyMapService.findById(this.map.id);
    if (found.ok && found.value) {
      this.map = found.value;
      this.render();
    }
  }
}
