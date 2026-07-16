import { ItemView, type WorkspaceLeaf } from "obsidian";
import { ref, type Ref } from "vue";
import StoryMapBoardApp from "../vue/story-map-board/StoryMapBoardApp.vue";
import type { StoryMapBoardController } from "../vue/story-map-board/story-map-board-controller";
import {
  STORY_MAP_BOARD_APP,
  STORY_MAP_BOARD_CONTROLLER,
  STORY_MAP_BOARD_DEPS,
  STORY_MAP_BOARD_ID,
  type StoryMapBoardDeps,
} from "../vue/story-map-board/story-map-board-deps";
import { mountVueView, type MountedVueView } from "../vue/mount-vue-view";

export const STORY_MAP_BOARD_VIEW_TYPE = "e2e-test-hub-story-map-board";

export type { StoryMapBoardDeps } from "../vue/story-map-board/story-map-board-deps";

/** Persisted view state: which Story Map this board leaf is showing. */
interface BoardState {
  storyMapId?: string;
}

/**
 * Interactive Story Map board (P2): drag a card to another cell and the move is
 * persisted via debounced saveMap.
 *
 * Vue-migrated (ADR-0033 Phase 4): a thin Obsidian shell that mounts
 * {@link StoryMapBoardApp} and holds the persisted target id as a Vue `ref`
 * (`getState` reads it, `setState` writes it; the app watches it to retarget). The
 * board's imperative engine — interact.js drag, SVG paint, inline editors, and the
 * debounced/serialized save with origin-filtered subscriptions — lives verbatim in
 * `StoryMapBoardController`, preserved per the ADR's interactive-view gate. The
 * controller is surfaced back through {@link STORY_MAP_BOARD_CONTROLLER} so this
 * `onClose` can await its close-time save flush before unmounting.
 */
export class StoryMapBoardView extends ItemView {
  private readonly storyMapId: Ref<string | null> = ref(null);
  private readonly controllerRef: Ref<StoryMapBoardController | null> = ref(null);
  private mounted: MountedVueView | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: StoryMapBoardDeps,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return STORY_MAP_BOARD_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Story Map board";
  }

  getIcon(): string {
    return "layout-grid";
  }

  /** Persist the target map id so the leaf survives a workspace reload. */
  getState(): Record<string, unknown> {
    return { storyMapId: this.storyMapId.value ?? undefined };
  }

  async setState(state: unknown, result: { history: boolean }): Promise<void> {
    const next = (state as BoardState | null)?.storyMapId;
    // Writing the ref covers both paths: on a workspace restore (setState before
    // onOpen) the app reads it at mount; on a leaf reuse (already mounted) the
    // app's watch drives the controller's retarget (which flushes the old map's
    // pending save under its OWN id before switching).
    if (typeof next === "string") this.storyMapId.value = next;
    await super.setState(state, result);
  }

  async onOpen(): Promise<void> {
    this.mounted = mountVueView(this.contentEl, StoryMapBoardApp, (app) => {
      app.provide(STORY_MAP_BOARD_DEPS, this.deps);
      app.provide(STORY_MAP_BOARD_APP, this.app);
      app.provide(STORY_MAP_BOARD_ID, this.storyMapId);
      app.provide(STORY_MAP_BOARD_CONTROLLER, this.controllerRef);
    });
  }

  async onClose(): Promise<void> {
    // Await the board's close-time flush BEFORE unmounting so a leaf closed right
    // after an edit durably persists it (Obsidian awaits this promise). close() is
    // idempotent, so the app's onUnmounted calling it again is a no-op.
    await this.controllerRef.value?.close();
    this.mounted?.unmount();
    this.mounted = null;
  }
}
