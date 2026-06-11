import type { Plugin } from "obsidian";
import type { DataStore } from "../../application/ports/data-store";
import { appError } from "../../shared/errors/errors";
import type { Logger } from "../../shared/logging/logger";
import { err, ok, type Result } from "../../shared/result/result";

/** Wraps Obsidian's per-plugin `loadData`/`saveData` (TIS data persistence). */
export class ObsidianDataStore implements DataStore {
  constructor(
    private readonly plugin: Plugin,
    private readonly logger?: Logger,
  ) {}

  async load(): Promise<unknown> {
    try {
      return await this.plugin.loadData();
    } catch (error) {
      // A sync-corrupted/truncated data.json rejects inside loadData's
      // JSON.parse. Rejecting here would propagate through onload and brick
      // the whole plugin; degrading to undefined hands the caller its
      // documented "use defaults" path instead (F1).
      this.logger?.error(
        "Could not read plugin data; falling back to default settings.",
        error instanceof Error ? error : undefined,
      );
      return undefined;
    }
  }

  async save(data: unknown): Promise<Result<void>> {
    try {
      await this.plugin.saveData(data);
      return ok(undefined);
    } catch (error) {
      return err(
        appError("SETTINGS_SAVE_FAILED", "Could not write plugin data.", {
          cause: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
}
