import { ItemView, type WorkspaceLeaf } from "obsidian";
import { mountVueView, type MountedVueView } from "../vue/mount-vue-view";
import PrdExplorerBody from "../vue/prds/PrdExplorerBody.vue";
import type { PrdBodyDeps } from "../vue/prds/prd-body-deps";

// `buildPrdTree` is re-exported because tests/prd-tree.test.ts imports it from
// this module (its historical home); the tree types + projection live with the
// body now.
export { buildPrdTree } from "./prd-explorer-body";

export const PRD_VIEW_TYPE = "e2e-test-hub-prds";

/** The deps the standalone PRDs leaf constructs and passes to the body. */
export type PrdExplorerDeps = PrdBodyDeps;

/**
 * Live "PRDs" panel: the hierarchical PRD tree (root product vision → sub-PRDs)
 * with per-PRD Use Case counts. Ids are immutable; the tree orders by
 * `displayOrder`.
 *
 * Vue-migrated (ADR-0033 Phase 3): a thin {@link ItemView} shell that mounts the
 * {@link PrdExplorerBody} component, which self-loads and subscribes to the bus
 * via `useEventBus`. The hub's Plan section mounts the same component, so the
 * standalone leaf and the in-hub body render identically.
 */
export class PrdExplorerView extends ItemView {
  private mounted: MountedVueView | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: PrdExplorerDeps,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return PRD_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "PRDs";
  }

  getIcon(): string {
    return "git-fork";
  }

  async onOpen(): Promise<void> {
    this.mounted = mountVueView(this.contentEl, PrdExplorerBody, undefined, {
      deps: this.deps,
    });
  }

  async onClose(): Promise<void> {
    this.mounted?.unmount();
    this.mounted = null;
  }
}
