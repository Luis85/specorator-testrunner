import type { VaultPath } from "../../domain/value-objects/identifiers";
import type { Result } from "../../shared/result/result";

/**
 * Folder/file IO inside the Obsidian vault index (TIS §9.1).
 * Implemented by `ObsidianVaultAdapter` in infrastructure.
 */
export interface VaultFileSystem {
  exists(path: VaultPath): Promise<boolean>;
  createFolder(path: VaultPath): Promise<Result<void>>;
  createFile(path: VaultPath, content: string): Promise<Result<void>>;
  readFile(path: VaultPath): Promise<Result<string>>;
  writeFile(path: VaultPath, content: string): Promise<Result<void>>;
  /** Immediate file children of a folder (non-recursive). */
  listFiles(path: VaultPath): Promise<Result<VaultPath[]>>;
  /** All file descendants of a folder, at any depth. */
  listFilesRecursive(path: VaultPath): Promise<Result<VaultPath[]>>;
}
