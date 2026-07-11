import { ItemView, type WorkspaceLeaf } from "obsidian";
import { mountVueView, type MountedVueView } from "../vue/mount-vue-view";
import UseCaseDashboardBody from "../vue/use-cases/UseCaseDashboardBody.vue";
import type { UseCaseBodyDeps } from "../vue/use-cases/use-case-body-deps";

export const USE_CASE_VIEW_TYPE = "e2e-test-hub-use-cases";

/** The deps the standalone Use Cases leaf constructs and passes to the body. */
export type UseCaseDashboardDeps = UseCaseBodyDeps;

/**
 * Live "Use Cases" panel (US-017): lists each Use Case with ID, Title, Status,
 * Automation Status, and Feature count, refreshing on use-case/feature/history
 * events.
 *
 * Vue-migrated (ADR-0033 Phase 3): a thin {@link ItemView} shell that mounts the
 * {@link UseCaseDashboardBody} component, which self-loads and subscribes to the
 * bus via `useEventBus`. The hub's Build section mounts the same component (with
 * the KPI funnel filter prop); the standalone leaf has no funnel, so it leaves
 * the filter at its `"all"` default (no chip renders).
 */
export class UseCaseDashboardView extends ItemView {
  private mounted: MountedVueView | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: UseCaseDashboardDeps,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return USE_CASE_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Use Cases";
  }

  getIcon(): string {
    return "list-checks";
  }

  async onOpen(): Promise<void> {
    this.mounted = mountVueView(this.contentEl, UseCaseDashboardBody, undefined, {
      deps: this.deps,
    });
  }

  async onClose(): Promise<void> {
    this.mounted?.unmount();
    this.mounted = null;
  }
}
