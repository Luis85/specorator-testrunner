import { type App, Modal, Notice } from "obsidian";
import type { StoryMapService } from "../../application/services/story-map-service";
import {
  STORY_MAP_STATUSES,
  type StoryMap,
  type StoryMapStatus,
} from "../../domain/entities/story-map";

export interface StoryMapSettingsDeps {
  storyMapService: Pick<StoryMapService, "updateMapMeta">;
}

/**
 * Edits a Story Map's metadata — title, lifecycle status, and product anchor —
 * from a small modal reached from the explorer row, closing the gap where these
 * were only editable via raw YAML. The map's structure is out of scope (managed
 * by the board/card surfaces). A thin DOM-only view: all validation and the write
 * live in {@link StoryMapService.updateMapMeta}.
 */
export class StoryMapSettingsModal extends Modal {
  private titleInput!: HTMLInputElement;
  private statusSelect!: HTMLSelectElement;
  private productInput!: HTMLInputElement;

  constructor(
    app: App,
    private map: StoryMap,
    private readonly deps: StoryMapSettingsDeps,
    private readonly onSaved?: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  // fallow-ignore-next-line complexity
  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: `Settings · ${this.map.id}` });

    contentEl.createEl("label", { text: "Title" });
    this.titleInput = contentEl.createEl("input", {
      type: "text",
      value: this.map.title,
      attr: { "aria-label": "Map title", "data-testid": "map-settings-title" },
    });

    contentEl.createEl("label", { text: "Status" });
    this.statusSelect = contentEl.createEl("select", {
      attr: { "aria-label": "Map status", "data-testid": "map-settings-status" },
    });
    for (const status of STORY_MAP_STATUSES) {
      const option = this.statusSelect.createEl("option", {
        text: status,
        attr: { value: status },
      });
      option.selected = this.map.status === status;
    }

    contentEl.createEl("label", { text: "Product" });
    this.productInput = contentEl.createEl("input", {
      type: "text",
      value: this.map.product,
      attr: { "aria-label": "Product anchor", "data-testid": "map-settings-product" },
    });
    contentEl.createEl("p", {
      // `PRD-NNN` is the canonical product id format, kept verbatim.
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      text: "PRD id this map anchors to (e.g. PRD-000)",
      cls: "e2e-test-hub-story-map-settings-desc",
    });

    contentEl
      .createEl("button", {
        text: "Save",
        cls: "mod-cta",
        attr: { "data-testid": "map-settings-save" },
      })
      .addEventListener("click", () => void this.save());
  }

  private async save(): Promise<void> {
    const title = this.titleInput.value;
    const status = this.statusSelect.value as StoryMapStatus;
    const product = this.productInput.value;
    const result = await this.deps.storyMapService.updateMapMeta(this.map.id, {
      title,
      status,
      product,
    });
    if (!result.ok) {
      new Notice(`Could not update ${this.map.id}: ${result.error.message}`);
      return;
    }
    new Notice(`Updated ${this.map.id}.`);
    this.onSaved?.();
    this.close();
  }
}
