import { TextFileView, type WorkspaceLeaf } from "obsidian";

import { parseFeature } from "../../application/content/gherkin";
import { unsafeVaultPath } from "../../domain/value-objects/vault-path";
import FeatureEditorApp from "../vue/feature-editor/FeatureEditorApp.vue";
import {
  createFeatureEditorController,
  FEATURE_EDITOR,
  type FeatureEditorController,
  type FeatureEditorDeps,
} from "../vue/feature-editor/feature-editor-controller";
import { mountVueView, type MountedVueView } from "../vue/mount-vue-view";

export const FEATURE_EDITOR_VIEW_TYPE = "e2e-test-hub-feature-editor";

export type { FeatureEditorDeps } from "../vue/feature-editor/feature-editor-controller";

/**
 * Structured editor for `.feature` files — the registered file handler for the
 * extension. The RAW TEXT is the single source of truth (`this.data`,
 * TextFileView's load/save lifecycle); structured mode is a projection the Vue
 * editor mutates in memory and re-serialises on every committed edit.
 *
 * Vue-migrated (ADR-0033 Phase 4): this class is now a thin Obsidian shell that
 * mounts {@link FeatureEditorApp} into `contentEl`. It owns the
 * {@link FeatureEditorController} — the reactive core — and wires the two
 * directions of the TextFileView lifecycle to it: `setViewData`/`clear` push the
 * loaded text into the controller, while the controller's hooks call back into
 * `requestSave`/`save`/`file.path`. Because the controller binds the structured
 * UI to the reactive spec, a committed edit updates `data` for saving WITHOUT
 * rebuilding the inputs — Vue preserves the DOM and caret, so the whole
 * focus-capture/restore machinery is gone.
 */
export class FeatureEditorView extends TextFileView {
  private readonly controller: FeatureEditorController;
  private mounted: MountedVueView | null = null;

  constructor(leaf: WorkspaceLeaf, deps: FeatureEditorDeps) {
    super(leaf);
    this.controller = createFeatureEditorController(deps, {
      requestSave: () => this.requestSave(),
      save: () => this.save(),
      filePath: () => this.file?.path ?? null,
    });
  }

  getViewType(): string {
    return FEATURE_EDITOR_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.file?.basename ?? "Feature";
  }

  getIcon(): string {
    return "file-code";
  }

  canAcceptExtension(extension: string): boolean {
    return extension === "feature";
  }

  getViewData(): string {
    return this.controller.data.value;
  }

  setViewData(data: string, _clear: boolean): void {
    // Re-project on every load — an external change (sync, git) rebuilds the
    // structured UI rather than leaving a stale in-memory spec.
    this.controller.setData(data);
  }

  clear(): void {
    this.controller.setData("");
  }

  async onOpen(): Promise<void> {
    await super.onOpen();
    this.mounted = mountVueView(this.contentEl, FeatureEditorApp, (app) => {
      app.provide(FEATURE_EDITOR, this.controller);
    });
    // Authoring aids load once per view; they degrade silently on failure
    // (no suggestions, no flags) and never block editing.
    void this.controller.loadAids();
  }

  // Obsidian lifecycle hook (called by the workspace when the leaf detaches);
  // fallow can't see the framework invoking it, so it reads as unused here.
  // fallow-ignore-next-line unused-class-member
  async onClose(): Promise<void> {
    this.mounted?.unmount();
    this.mounted = null;
  }

  /** Announce the save so dashboards/explorers refresh (spec Part 4). */
  async save(clear = false): Promise<void> {
    await super.save(clear);
    if (!this.file) return;
    const parsed = parseFeature(this.controller.data.value, unsafeVaultPath(this.file.path));
    if (parsed !== null) await this.controller.deps.specifications.announceUpdated(parsed);
  }
}
