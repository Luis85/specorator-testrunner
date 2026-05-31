import type { Result } from "../../shared/result/result";

/**
 * Filesystem access for paths that live outside the Obsidian vault index —
 * `.testrunner` internals (node_modules, lockfile) and process working
 * directories (TIS §9.4). Vault-indexed Markdown still goes through
 * {@link VaultFileSystem}.
 */
export interface AbsoluteFileSystem {
  /** Absolute path to the vault root, used as the base for runner paths. */
  getVaultBasePath(): Promise<Result<string>>;
  existsAbsolute(path: string): Promise<boolean>;
  /** UTF-8 contents of a file outside the vault index (e.g. a runner report). */
  readAbsolute(path: string): Promise<Result<string>>;
  writeAbsolute(path: string, content: string): Promise<Result<void>>;
  /** Removes a file if it exists; a missing file is not an error. */
  deleteAbsolute(path: string): Promise<Result<void>>;
  /** Immediate child entry names of a directory; `[]` if it does not exist. */
  listAbsolute(path: string): Promise<string[]>;
}
