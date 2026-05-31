import type { Plugin } from "obsidian";
import type { DataStore } from "../../application/ports/data-store";

/** Wraps Obsidian's per-plugin `loadData`/`saveData` (TIS data persistence). */
export class ObsidianDataStore implements DataStore {
  constructor(private readonly plugin: Plugin) {}

  async load(): Promise<unknown> {
    return this.plugin.loadData();
  }

  async save(data: unknown): Promise<void> {
    await this.plugin.saveData(data);
  }
}
