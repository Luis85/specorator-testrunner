/**
 * Opaque key-value persistence for plugin settings. Wraps Obsidian's
 * `Plugin.loadData`/`saveData` in infrastructure so the `SettingsService`
 * stays unit-testable without the Obsidian runtime.
 */
export interface DataStore {
  load(): Promise<unknown>;
  save(data: unknown): Promise<void>;
}
