import type { WorkspacePort } from "../../../application/ports/workspace-port";
import type { StoryMapService } from "../../../application/services/story-map-service";
import type { StoryMap } from "../../../domain/entities/story-map";
import type { EventBus } from "../../../shared/event-bus/event-bus";

/**
 * Everything {@link StoryMapExplorerBody} needs to load, render, and stay live —
 * the service it reads, the workspace port for note access, the open/settings
 * callbacks, and the bus it subscribes its own refresh to (ADR-0033). The
 * standalone Story Maps leaf and the hub's Plan section both construct this and
 * pass it as a prop; the body's `refresh` is internal (a useEventBus binding).
 */
export interface StoryMapBodyDeps {
  storyMapService: StoryMapService;
  workspace: WorkspacePort;
  /** Opens the Story Map Builder. */
  openStoryMapBuilder: () => void;
  /** Opens the map-settings modal (edit title/status/product). */
  openMapSettings: (map: StoryMap) => void;
  /** Opens the read-only board for a given map in the main workspace view. */
  openStoryMapBoard: (storyMapId: string) => void;
  eventBus: EventBus;
}
