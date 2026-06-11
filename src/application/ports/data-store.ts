import type { Result } from "../../shared/result/result";

/**
 * Opaque key-value persistence for plugin settings. Wraps Obsidian's
 * `Plugin.loadData`/`saveData` in infrastructure so the `SettingsService`
 * stays unit-testable without the Obsidian runtime.
 *
 * Contract: `load()` never rejects — a corrupt/unreadable `data.json` degrades
 * to `undefined` (callers treat that as "use defaults"); `save()` reports disk
 * failures as a typed `err`, never as a thrown exception (F1/F2).
 */
export interface DataStore {
  load(): Promise<unknown>;
  save(data: unknown): Promise<Result<void>>;
}
