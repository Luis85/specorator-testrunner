import { type App, normalizePath, TFile } from "obsidian";
import type { VaultFileSystem } from "../../application/ports/vault-file-system";
import type { VaultPath } from "../../domain/value-objects/identifiers";
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
        await this.app.vault.modify(existing, content);
        return ok(undefined);
      }
      return this.createFile(normalized, content);
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

  async listFiles(path: VaultPath): Promise<Result<VaultPath[]>> {
    const normalized = normalizePath(path);
    try {
      if (!(await this.app.vault.adapter.exists(normalized))) return ok([]);
      const listing = await this.app.vault.adapter.list(normalized);
      return ok(listing.files);
    } catch (cause) {
      return err(appError("INIT_FAILED", `Could not list "${path}".`, { cause }));
    }
  }

  async listFilesRecursive(path: VaultPath): Promise<Result<VaultPath[]>> {
    const normalized = normalizePath(path);
    try {
      if (!(await this.app.vault.adapter.exists(normalized))) return ok([]);
      const files: VaultPath[] = [];
      const queue = [normalized];
      while (queue.length > 0) {
        const dir = queue.shift() as string;
        const listing = await this.app.vault.adapter.list(dir);
        files.push(...listing.files);
        queue.push(...listing.folders);
      }
      return ok(files);
    } catch (cause) {
      return err(appError("INIT_FAILED", `Could not list "${path}" recursively.`, { cause }));
    }
  }

  /** Ensures the parent folder tree exists before a file write. */
  private async ensureParentFolder(normalizedPath: string): Promise<Result<void>> {
    const lastSlash = normalizedPath.lastIndexOf("/");
    if (lastSlash <= 0) return ok(undefined);
    return this.createFolder(normalizedPath.slice(0, lastSlash));
  }
}
