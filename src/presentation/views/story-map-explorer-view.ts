import { type WorkspaceLeaf } from "obsidian";
import type { WorkspacePort } from "../../application/ports/workspace-port";
import type { StoryMapService } from "../../application/services/story-map-service";
import type { StoryMap } from "../../domain/entities/story-map";
import type { DomainEventType } from "../../domain/events/domain-event";
import type { EventBus } from "../../shared/event-bus/event-bus";
import { renderStoryMapExplorerBody } from "./story-map-explorer-body";
import { LiveDashboardView } from "./live-dashboard-view";

export const STORY_MAP_VIEW_TYPE = "e2e-test-hub-story-maps";

/** Refresh when a Story Map is created, has its cards changed, or is deleted. */
const REFRESH_ON: DomainEventType[] = ["storymap.created", "storymap.updated", "storymap.deleted"];

export interface StoryMapExplorerDeps {
  storyMapService: StoryMapService;
  workspace: WorkspacePort;
  eventBus: EventBus;
  /** Opens the Story Map Builder. */
  openStoryMapBuilder: () => void;
  /** Opens the map-settings modal (edit title/status/product). */
  openMapSettings: (map: StoryMap) => void;
  /** Opens the read-only board for a given map in the main workspace view. */
  openStoryMapBoard: (storyMapId: string) => void;
}

/**
 * Live "Story Maps" panel: the flat list of Story Maps (PRD-sibling overlays),
 * each showing its product anchor and backbone/slice/card counts, with open,
 * refresh-tables, and delete actions. Mirrors the PRDs explorer (LiveDashboardView).
 */
export class StoryMapExplorerView extends LiveDashboardView {
  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: StoryMapExplorerDeps,
  ) {
    super(leaf, deps.eventBus, REFRESH_ON);
  }

  // fallow-ignore-next-line unused-class-member
  getViewType(): string {
    return STORY_MAP_VIEW_TYPE;
  }

  // fallow-ignore-next-line unused-class-member
  getDisplayText(): string {
    return "Story Maps";
  }

  // fallow-ignore-next-line unused-class-member
  getIcon(): string {
    return "map";
  }

  protected async render(): Promise<void> {
    // Thin caller: the body builds entirely into this leaf's `contentEl` via the
    // host-agnostic renderer, so the standalone leaf and the (later) Test Hub
    // body render identically (ADR-0031).
    await renderStoryMapExplorerBody(this.contentEl, {
      storyMapService: this.deps.storyMapService,
      workspace: this.deps.workspace,
      openStoryMapBuilder: this.deps.openStoryMapBuilder,
      openMapSettings: this.deps.openMapSettings,
      openStoryMapBoard: this.deps.openStoryMapBoard,
      refresh: () => void this.live.schedule(),
    });
  }
}
