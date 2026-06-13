import { access, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { type App, FileSystemAdapter } from "obsidian";
import type { AbsoluteFileSystem } from "../../application/ports/absolute-file-system";
import { appError } from "../../shared/errors/errors";
import { err, ok, type Result } from "../../shared/result/result";

/**
 * Node `fs`-backed {@link AbsoluteFileSystem} for `.testrunner` internals that
 * live outside the Obsidian index (BBV §7 `FileSystemAdapter`). Desktop-only,
 * matching `manifest.json` (`isDesktopOnly`).
 */
export class NodeAbsoluteFileSystem implements AbsoluteFileSystem {
  constructor(private readonly app: App) {}

  async getVaultBasePath(): Promise<Result<string>> {
    const adapter = this.app.vault.adapter;
    // Normalize the trailing separator ONCE at the source (review §4) so every
    // consumer can join `${base}/${vaultRelative}` without double separators.
    if (adapter instanceof FileSystemAdapter) {
      return ok(adapter.getBasePath().replace(/[\\/]+$/, ""));
    }
    return err(appError("INIT_FAILED", "Vault base path is only available on desktop."));
  }

  async existsAbsolute(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  async readAbsolute(path: string): Promise<Result<string>> {
    try {
      return ok(await readFile(path, "utf8"));
    } catch (cause) {
      return err(appError("REPORT_NOT_FOUND", `Could not read "${path}".`, { cause }));
    }
  }

  async writeAbsolute(path: string, content: string): Promise<Result<void>> {
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, "utf8");
      return ok(undefined);
    } catch (cause) {
      return err(appError("INIT_FAILED", `Could not write "${path}".`, { cause }));
    }
  }

  async deleteAbsolute(path: string): Promise<Result<void>> {
    try {
      await rm(path, { force: true }); // force: a missing file is not an error
      return ok(undefined);
    } catch (cause) {
      return err(appError("INIT_FAILED", `Could not delete "${path}".`, { cause }));
    }
  }

  async listAbsolute(path: string): Promise<string[]> {
    try {
      return await readdir(path);
    } catch {
      return [];
    }
  }
}
