import { ItemView, type WorkspaceLeaf } from "obsidian";
import type { GuidedTourService } from "../../application/services/guided-tour-service";
import type { EventBus } from "../../shared/event-bus/event-bus";
import GuidedTourApp from "../vue/guided-tour/GuidedTourApp.vue";
import { GUIDED_TOUR_DEPS } from "../vue/guided-tour/guided-tour-deps";
import { mountVueView, type MountedVueView } from "../vue/mount-vue-view";
import type { TourActionFlows } from "./tour-actions";

export const GUIDED_TOUR_VIEW_TYPE = "e2e-test-hub-guided-tour";

/**
 * Everything the Guided Tour leaf needs: the tour service + bus, plus the
 * action-button {@link TourActionFlows} (each wired in main.ts to an EXISTING
 * flow — modal, launcher, workspace, command body; the tour guides, it never
 * re-implements an action, spec 2026-06-11). The flows are shared with the hub's
 * onboarding rail through {@link dispatchTourAction}.
 */
export interface GuidedTourViewDeps extends TourActionFlows {
  tour: GuidedTourService;
  eventBus: EventBus;
}

/**
 * The Guided Tour: a right-sidebar checklist over the full V1 loop that
 * auto-advances as the GuidedTourService observes the user's real actions.
 *
 * First Vue-migrated leaf (ADR-0033 Phase 0): the view is now a thin Obsidian
 * shell that mounts a per-leaf Vue app into `contentEl` on open and unmounts it
 * on close. The checklist's rendering + live refresh moved into
 * {@link GuidedTourApp} (its `useEventBus` composable replaces the old
 * `LiveDashboardView`/`LiveRefresh` subscription loop); the pure `projectTour`
 * projection — and its tests — are unchanged.
 */
export class GuidedTourView extends ItemView {
  private mounted: MountedVueView | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: GuidedTourViewDeps,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return GUIDED_TOUR_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Guided tour";
  }

  getIcon(): string {
    return "graduation-cap";
  }

  async onOpen(): Promise<void> {
    this.mounted = mountVueView(this.contentEl, GuidedTourApp, (app) =>
      app.provide(GUIDED_TOUR_DEPS, this.deps),
    );
  }

  async onClose(): Promise<void> {
    // Unmounting runs GuidedTourApp's onUnmounted, which drops the useEventBus
    // subscriptions — the same teardown the old LiveRefresh.close() did.
    this.mounted?.unmount();
    this.mounted = null;
  }
}
