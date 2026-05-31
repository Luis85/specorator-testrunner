import { type App, normalizePath, TFile } from "obsidian";
import type { WorkspacePort } from "../../application/ports/workspace-port";
import type { VaultPath } from "../../domain/value-objects/identifiers";
import { appError } from "../../shared/errors/errors";
import { err, ok, type Result } from "../../shared/result/result";

/**
 * Implements {@link WorkspacePort} against the Obsidian `Workspace`
 * (BBV §7 `ObsidianWorkspaceAdapter`).
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

  async openView(viewType: string): Promise<Result<void>> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(viewType)[0];
    if (!leaf) {
      const right = workspace.getRightLeaf(false);
      if (!right) return err(appError("INIT_FAILED", "No workspace leaf is available."));
      leaf = right;
      await leaf.setViewState({ type: viewType, active: true });
    }
    // revealLeaf may return a promise in some Obsidian versions; we do not
    // need to await it (the view is already attached), so discard it.
    void workspace.revealLeaf(leaf);
    return ok(undefined);
  }

  async revealInExplorer(path: VaultPath): Promise<Result<void>> {
    return this.openFile(path);
  }
}
