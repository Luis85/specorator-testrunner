import { type App, normalizePath, TFile } from "obsidian";
import type { VaultFileSystem } from "../../application/ports/vault-file-system";
import type { VaultPath } from "../../domain/value-objects/identifiers";
import { unsafeVaultPath } from "../../domain/value-objects/vault-path";
import { appError } from "../../shared/errors/errors";
import { err, ok, type Result } from "../../shared/result/result";

/**
 * Implements {@link VaultFileSystem} against the Obsidian `Vault` so generated
 * artifacts are indexed (links, frontmatter, search) like any other note
 * (BBV §7 `ObsidianVaultAdapter`).
 */
export class ObsidianVaultAdapter implements VaultFileSystem {
  constructor(private readonly app: App) {}

  async exists(path: VaultPath): Promise<boolean> {
    return this.app.vault.adapter.exists(normalizePath(path));
  }

  async createFolder(path: VaultPath): Promise<Result<void>> {
    const normalized = normalizePath(path);
    try {
      // Obsidian's `vault.createFolder` is not recursive, so create each
      // missing ancestor before the leaf (e.g. configuring "QA/Use Cases"
      // when "QA" does not yet exist).
      let current = "";
      for (const segment of normalized.split("/")) {
        current = current ? `${current}/${segment}` : segment;
        if (await this.app.vault.adapter.exists(current)) continue;
        await this.app.vault.createFolder(current);
      }
      return ok(undefined);
    } catch (cause) {
      return err(appError("INIT_FAILED", `Could not create folder "${path}".`, { cause }));
    }
  }

  async createFile(path: VaultPath, content: string): Promise<Result<void>> {
    const normalized = normalizePath(path);
    try {
      const ensured = await this.ensureParentFolder(normalized);
      if (!ensured.ok) return ensured;
      await this.app.vault.create(normalized, content);
      return ok(undefined);
    } catch (cause) {
      return err(appError("INIT_FAILED", `Could not create file "${path}".`, { cause }));
    }
  }

  async writeFile(path: VaultPath, content: string): Promise<Result<void>> {
    const normalized = normalizePath(path);
    try {
      const existing = this.app.vault.getAbstractFileByPath(normalized);
      if (existing instanceof TFile) {
        // Vault.process, not Vault.modify: background edits go through the
        // atomic read-modify-write path (plugin guidelines §"Use
        // Vault.process"); the content is a wholesale replacement.
        await this.app.vault.process(existing, () => content);
        return ok(undefined);
      }
      return await this.createFile(unsafeVaultPath(normalized), content);
    } catch (cause) {
      return err(appError("INIT_FAILED", `Could not write file "${path}".`, { cause }));
    }
  }

  async readFile(path: VaultPath): Promise<Result<string>> {
    const normalized = normalizePath(path);
    try {
      const file = this.app.vault.getAbstractFileByPath(normalized);
      if (file instanceof TFile) return ok(await this.app.vault.read(file));
      if (await this.app.vault.adapter.exists(normalized)) {
        return ok(await this.app.vault.adapter.read(normalized));
      }
      return err(appError("RUNNER_MISSING_FILE", `File not found: "${path}".`));
    } catch (cause) {
      return err(appError("RUNNER_MISSING_FILE", `Could not read file "${path}".`, { cause }));
    }
  }

  async listFilesRecursive(path: VaultPath): Promise<Result<VaultPath[]>> {
    const normalized = normalizePath(path);
    try {
      if (!(await this.app.vault.adapter.exists(normalized))) return ok([]);
      const files: VaultPath[] = [];
      const queue = [normalized];
      let dir: string | undefined;
      while ((dir = queue.shift()) !== undefined) {
        const listing = await this.app.vault.adapter.list(dir);
        files.push(...listing.files.map(unsafeVaultPath));
        queue.push(...listing.folders);
      }
      return ok(files);
    } catch (cause) {
      return err(appError("INIT_FAILED", `Could not list "${path}" recursively.`, { cause }));
    }
  }

  async listFolders(): Promise<Result<VaultPath[]>> {
    // BFS from the vault root via the raw adapter (same listing API as
    // listFilesRecursive), collecting every folder path. Used by the ADR-0015
    // sibling-Test-Hub check. Errors return [] so validation stays advisory.
    try {
      const folders: VaultPath[] = [];
      // The normalized vault root is the EMPTY path, not "/" — `DataAdapter.list`
      // takes a normalized vault-relative path (review P2). Pass `dir` ("" at the
      // root) directly, exactly as listFilesRecursive above does; "/" can throw in
      // a real vault and fall through to ok([]), silently disabling the check.
      const queue = [""];
      let dir: string | undefined;
      while ((dir = queue.shift()) !== undefined) {
        const listing = await this.app.vault.adapter.list(dir);
        for (const folder of listing.folders) {
          folders.push(unsafeVaultPath(folder));
          queue.push(folder);
        }
      }
      return ok(folders);
    } catch {
      return ok([]);
    }
  }

  async deleteFolder(path: VaultPath): Promise<Result<void>> {
    const normalized = normalizePath(path);
    try {
      // Idempotent: a missing folder is not an error (UC-024 reset may run when
      // the runtime was never created or a previous reset already removed it).
      if (!(await this.app.vault.adapter.exists(normalized))) return ok(undefined);
      // Prefer the TFolder-aware path so Obsidian's index is updated; fall back
      // to the raw adapter (recursive) when the folder is outside the index
      // (e.g. dot-folders like `.testrunner` that Obsidian does not track).
      const folder = this.app.vault.getAbstractFileByPath(normalized);
      if (folder) {
        // Deliberately NOT FileManager.trashFile(): this only ever removes
        // plugin-generated runtime folders (UC-024 reset, `.testrunner` with
        // its node_modules + Chromium) — moving those to the user's trash
        // would be hostile, and they are regenerable by the wizard.
        // eslint-disable-next-line obsidianmd/prefer-file-manager-trash-file
        await this.app.vault.delete(folder, true);
      } else {
        await this.app.vault.adapter.rmdir(normalized, true);
      }
      return ok(undefined);
    } catch (cause) {
      return err(appError("INIT_FAILED", `Could not delete folder "${path}".`, { cause }));
    }
  }

  /** Ensures the parent folder tree exists before a file write. */
  private async ensureParentFolder(normalizedPath: string): Promise<Result<void>> {
    const lastSlash = normalizedPath.lastIndexOf("/");
    if (lastSlash <= 0) return ok(undefined);
    return this.createFolder(unsafeVaultPath(normalizedPath.slice(0, lastSlash)));
  }
}
