import type { VaultPath } from "../../domain/value-objects/identifiers";
import type { Result } from "../../shared/result/result";

/** Opening views/files in the Obsidian workspace (TIS §9.2). */
export interface WorkspacePort {
  openFile(path: VaultPath): Promise<Result<void>>;
  openView(viewType: string): Promise<Result<void>>;
  revealInExplorer(path: VaultPath): Promise<Result<void>>;
}
