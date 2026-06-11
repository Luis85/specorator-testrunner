import type { VaultPath } from "../../domain/value-objects/identifiers";
import type { Result } from "../../shared/result/result";

/** Opening views/files in the Obsidian workspace (TIS §9.2). */
export interface WorkspacePort {
  openFile(path: VaultPath): Promise<Result<void>>;
  /**
   * Opens (or reveals) a plugin view. `location` controls where a NEW leaf is
   * created: the explorers/dashboard/detail are full work surfaces and open as
   * a `"main"` tab (the default); the Test Console is a monitoring companion
   * the user watches NEXT TO their work, so it opens in the `"sidebar"`.
   * An already-open leaf is revealed wherever the user moved it.
   */
  openView(viewType: string, location?: "main" | "sidebar"): Promise<Result<void>>;
}
