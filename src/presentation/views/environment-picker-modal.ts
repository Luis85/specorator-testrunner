import { type App, FuzzySuggestModal } from "obsidian";

/**
 * Fuzzy picker for switching the active environment (Wave C §2). Mirrors
 * {@link RunPickerModal} — a thin {@link FuzzySuggestModal} over the environment
 * names; the chosen name is handed back to the caller, which persists it through
 * the main.ts-owned settings save path.
 */
export class EnvironmentPickerModal extends FuzzySuggestModal<string> {
  constructor(
    app: App,
    private readonly names: string[],
    private readonly active: string,
    private readonly onChoose: (name: string) => void,
  ) {
    super(app);
    this.setPlaceholder("Switch active environment");
  }

  getItems(): string[] {
    return this.names;
  }

  getItemText(name: string): string {
    return name === this.active ? `${name} (active)` : name;
  }

  onChooseItem(name: string): void {
    this.onChoose(name);
  }
}
