import { ItemView, type WorkspaceLeaf } from "obsidian";
import { mountVueView, type MountedVueView } from "../vue/mount-vue-view";
import EvidenceExplorerBody from "../vue/evidence/EvidenceExplorerBody.vue";
import type { EvidenceBodyDeps } from "../vue/evidence/evidence-body-deps";

export const EVIDENCE_EXPLORER_VIEW_TYPE = "e2e-test-hub-evidence";

/** The deps the standalone Evidence Explorer leaf constructs and passes to the body. */
export type EvidenceExplorerViewDeps = EvidenceBodyDeps;

/**
 * Main-area Evidence Explorer (EPIC-008): browses the FULL partitioned run
 * history (`Test Evidence/YYYY/MM/<runId>/summary.md`), month-grouped,
 * status-filterable, paged via "Load older"; every row opens its evidence note.
 *
 * Vue-migrated (ADR-0033 Phase 3): a thin {@link ItemView} shell that mounts the
 * {@link EvidenceExplorerBody} component, which self-loads and subscribes to the
 * bus via `useEventBus`. The hub's Review section mounts the same component (with
 * store-backed filter/limit props); the standalone leaf omits them, so the
 * component keeps its own filter/limit for the leaf's lifetime.
 */
export class EvidenceExplorerView extends ItemView {
  private mounted: MountedVueView | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: EvidenceExplorerViewDeps,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return EVIDENCE_EXPLORER_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Evidence Explorer";
  }

  getIcon(): string {
    return "history";
  }

  async onOpen(): Promise<void> {
    this.mounted = mountVueView(this.contentEl, EvidenceExplorerBody, undefined, {
      deps: this.deps,
    });
  }

  async onClose(): Promise<void> {
    this.mounted?.unmount();
    this.mounted = null;
  }
}
