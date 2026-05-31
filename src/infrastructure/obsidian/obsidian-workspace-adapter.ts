import { type App, normalizePath, TFile } from "obsidian";
import type { WorkspacePort } from "../../application/ports/workspace-port";
import type { VaultPath } from "../../domain/value-objects/identifiers";
import { appError } from "../../shared/errors/errors";
import { err, ok, type Result } from "../../shared/result/result";

/**
 * Implements {@link WorkspacePort} against the Obsidian `Workspace`
 * (BBV §7 `ObsidianWorkspaceAdapter`). Custom views (`openView`) land with the
 * Dashboard epic; in V1 this opens generated notes.
 */
export class ObsidianWorkspaceAdapter implements WorkspacePort {
  constructor(private readonly app: App) {}

  async openFile(path: VaultPath): Promise<Result<void>> {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(file instanceof TFile)) {
      return err(appError("RUNNER_MISSING_FILE", `Cannot open missing file "${path}".`));
    }
    await this.app.workspace.getLeaf(true).openFile(file);
    return ok(undefined);
  }

  async openView(_viewType: string): Promise<Result<void>> {
    // Registered workspace views arrive with EPIC-009 (Dashboard).
    return err(appError("INIT_FAILED", "No views are registered yet."));
  }

  async revealInExplorer(path: VaultPath): Promise<Result<void>> {
    return this.openFile(path);
  }
}
