import { ItemView, type WorkspaceLeaf } from "obsidian";
import { mountVueView, type MountedVueView } from "../vue/mount-vue-view";
import StoryMapExplorerBody from "../vue/story-maps/StoryMapExplorerBody.vue";
import type { StoryMapBodyDeps } from "../vue/story-maps/story-map-body-deps";

export const STORY_MAP_VIEW_TYPE = "e2e-test-hub-story-maps";

/** The deps the standalone Story Maps leaf constructs and passes to the body. */
export type StoryMapExplorerDeps = StoryMapBodyDeps;

/**
 * Live "Story Maps" panel: the flat list of Story Maps (PRD-sibling overlays),
 * each showing its product anchor and backbone/slice/card counts, with open,
 * refresh-tables, and delete actions.
 *
 * Vue-migrated (ADR-0033 Phase 3): a thin {@link ItemView} shell that mounts the
 * {@link StoryMapExplorerBody} component, which self-loads and subscribes to the
 * bus via `useEventBus`. The hub's Plan section mounts the same component, so the
 * standalone leaf and the in-hub body render identically.
 */
export class StoryMapExplorerView extends ItemView {
  private mounted: MountedVueView | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: StoryMapExplorerDeps,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return STORY_MAP_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Story Maps";
  }

  getIcon(): string {
    return "map";
  }

  async onOpen(): Promise<void> {
    this.mounted = mountVueView(this.contentEl, StoryMapExplorerBody, undefined, {
      deps: this.deps,
    });
  }

  async onClose(): Promise<void> {
    this.mounted?.unmount();
    this.mounted = null;
  }
}
