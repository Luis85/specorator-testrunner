import type { App } from "obsidian";
import type { InjectionKey, Ref } from "vue";
import type { StoryMapService } from "../../../application/services/story-map-service";
import type { UseCaseService } from "../../../application/services/use-case-service";
import type { EventBus } from "../../../shared/event-bus/event-bus";
import type { NavigationTarget } from "../../navigation/navigation-target";
import type { StoryMapBoardController } from "./story-map-board-controller";

export interface StoryMapBoardDeps {
  storyMapService: Pick<StoryMapService, "findById" | "saveMap" | "addCard" | "updateCard">;
  /** Passed to the Card modal for the reference picker + Promote-to-Use-Case. */
  useCaseService: Pick<UseCaseService, "create" | "assignToPrd" | "findAll">;
  eventBus: EventBus;
  // WS-A4/B4 deep-link port: clicking a card's `UC-NNN` ref opens that Use Case's
  // detail (01-§3.2). The board already resolves refs; this navigates to them.
  navigate: (target: NavigationTarget) => void;
}

/** Per-leaf DI key: the composition-root slice the board app injects (ADR-0033). */
export const STORY_MAP_BOARD_DEPS = Symbol(
  "story-map-board-deps",
) as InjectionKey<StoryMapBoardDeps>;
/** The Obsidian App the board's Card modal opens against. */
export const STORY_MAP_BOARD_APP = Symbol("story-map-board-app") as InjectionKey<App>;
/**
 * The persisted target map id, held by the thin view (getState/setState) as a ref
 * so the mounted app can (re)target: the controller reads it, and a watch drives
 * `setStoryMapId` on change (ADR-0033).
 */
export const STORY_MAP_BOARD_ID = Symbol("story-map-board-id") as InjectionKey<Ref<string | null>>;
/**
 * A slot the mounted app writes its controller into, so the thin view's onClose
 * can await the board's close-time save flush BEFORE unmounting — Vue's
 * onUnmounted can't be awaited, and a leaf closed right after an edit must persist
 * it (ADR-0033).
 */
export const STORY_MAP_BOARD_CONTROLLER = Symbol("story-map-board-controller") as InjectionKey<
  Ref<StoryMapBoardController | null>
>;
