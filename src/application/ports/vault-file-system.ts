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
  /** All file descendants of a folder, at any depth. */
  listFilesRecursive(path: VaultPath): Promise<Result<VaultPath[]>>;
  /**
   * Every folder path in the vault (vault-relative, `/`-separated, any depth;
   * excludes the vault root). Used by the ADR-0015 one-project-per-vault check
   * to detect sibling/duplicate `Test Hub` folders. Order is not significant.
   */
  listFolders(): Promise<Result<VaultPath[]>>;
  /**
   * Recursively deletes a folder and everything under it. Used by
   * {@link MaintenanceService.reset} (UC-024) to remove the regenerable
   * `.testrunner` runtime before re-initialization. A missing folder is NOT an
   * error (the delete is idempotent); a real I/O failure returns `err`.
   */
  deleteFolder(path: VaultPath): Promise<Result<void>>;
  /**
   * Deletes a single file. Used by {@link PrdService.deletePrd} to remove a PRD
   * note while preserving any sibling attachments in its folder. A missing file
   * is NOT an error (idempotent); a real I/O failure returns `err`.
   */
  deleteFile(path: VaultPath): Promise<Result<void>>;
}
