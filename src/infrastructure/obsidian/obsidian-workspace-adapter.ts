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
    try {
      await this.app.workspace.getLeaf(true).openFile(file);
      return ok(undefined);
    } catch (cause) {
      return err(appError("INIT_FAILED", `Could not open file "${path}".`, { cause }));
    }
  }

  async openView(viewType: string, location: "main" | "sidebar" = "main"): Promise<Result<void>> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(viewType)[0];
    if (!leaf) {
      // Work surfaces (dashboard, explorers, detail) open as a MAIN tab; only
      // the Test Console — a monitoring companion — defaults to the sidebar.
      // If the user has since dragged a leaf elsewhere, the reuse branch above
      // respects their placement.
      const target =
        location === "sidebar" ? workspace.getRightLeaf(false) : workspace.getLeaf("tab");
      if (!target) return err(appError("INIT_FAILED", "No workspace leaf is available."));
      leaf = target;
      try {
        await leaf.setViewState({ type: viewType, active: true });
      } catch (cause) {
        return err(appError("INIT_FAILED", `Could not open view "${viewType}".`, { cause }));
      }
    }
    // revealLeaf may return a promise in some Obsidian versions; we do not
    // need to await it (the view is already attached), so discard it.
    void workspace.revealLeaf(leaf);
    return ok(undefined);
  }

  async openInSystemEditor(path: VaultPath): Promise<Result<void>> {
    // `openWithDefaultApp` ships on desktop `App` builds but is not declared
    // in the installed obsidian typings — probe it via the same narrow-record
    // idiom as `readPersistedActiveSection` (hub-sections.ts) instead of an
    // unsafe blanket `as any`/`as App` cast.
    const app: unknown = this.app;
    const candidate: unknown = (app as Record<string, unknown>).openWithDefaultApp;
    if (typeof candidate !== "function") {
      return err(
        appError("VALIDATION_FAILED", "Opening files in the system editor is not supported here."),
      );
    }
    try {
      await candidate.call(this.app, normalizePath(path));
      return ok(undefined);
    } catch (cause) {
      return err(
        appError("INIT_FAILED", `Could not open "${path}" in the system editor.`, { cause }),
      );
    }
  }
}
