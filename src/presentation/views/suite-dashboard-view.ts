import { ItemView, type WorkspaceLeaf } from "obsidian";
import { mountVueView, type MountedVueView } from "../vue/mount-vue-view";
import SuiteDashboardBody from "../vue/suites/SuiteDashboardBody.vue";
import type { SuiteBodyDeps } from "../vue/suites/suite-body-deps";

export const SUITE_VIEW_TYPE = "e2e-test-hub-suites";

/** The deps the standalone Test Suites leaf constructs and passes to the body. */
export type SuiteDashboardDeps = SuiteBodyDeps;

/**
 * Live "Test Suites" panel (US-024/US-025, UC-008). Lists each suite's Name,
 * ID, and Tag Expression (membership is by tag per AD-4), refreshing on suite
 * events. The default Smoke/Regression suites seeded by `createDefaults` surface
 * here via `findAll`.
 *
 * Vue-migrated (ADR-0033 Phase 3): a thin {@link ItemView} shell that mounts the
 * {@link SuiteDashboardBody} component, which self-loads and subscribes to the
 * bus via `useEventBus`. The hub's Run section mounts the same component, so the
 * standalone leaf and the in-hub body render identically.
 */
export class SuiteDashboardView extends ItemView {
  private mounted: MountedVueView | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: SuiteDashboardDeps,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return SUITE_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Test Suites";
  }

  getIcon(): string {
    return "layers";
  }

  async onOpen(): Promise<void> {
    this.mounted = mountVueView(this.contentEl, SuiteDashboardBody, undefined, {
      deps: this.deps,
    });
  }

  async onClose(): Promise<void> {
    this.mounted?.unmount();
    this.mounted = null;
  }
}
