import { type App, FuzzySuggestModal } from "obsidian";

/** A selectable run target: a stable `id` plus a human-readable `label`. */
export interface RunPickerItem {
  id: string;
  label: string;
}

/**
 * Generic fuzzy picker for choosing a run target — a Test Suite, Use Case, or
 * Feature file (US-027/028, UC-011/012/013). Mirrors {@link GenerateFeatureModal}
 * but is target-agnostic so each Run command supplies its own items.
 */
export class RunPickerModal extends FuzzySuggestModal<RunPickerItem> {
  constructor(
    app: App,
    placeholder: string,
    private readonly items: RunPickerItem[],
    private readonly onChoose: (id: string) => void,
  ) {
    super(app);
    this.setPlaceholder(placeholder);
  }

  getItems(): RunPickerItem[] {
    return this.items;
  }

  getItemText(item: RunPickerItem): string {
    return item.label;
  }

  onChooseItem(item: RunPickerItem): void {
    this.onChoose(item.id);
  }
}
