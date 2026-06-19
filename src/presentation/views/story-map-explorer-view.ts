import { Notice, type WorkspaceLeaf } from "obsidian";
import type { WorkspacePort } from "../../application/ports/workspace-port";
import type { StoryMapService } from "../../application/services/story-map-service";
import type { StoryMap } from "../../domain/entities/story-map";
import type { DomainEventType } from "../../domain/events/domain-event";
import type { EventBus } from "../../shared/event-bus/event-bus";
import { openOrNotice, renderLoadError } from "./modal-helpers";
import { LiveDashboardView } from "./live-dashboard-view";

export const STORY_MAP_VIEW_TYPE = "e2e-test-hub-story-maps";

/** Refresh the list when a Story Map is created or deleted. */
const REFRESH_ON: DomainEventType[] = ["storymap.created", "storymap.deleted"];

export interface StoryMapExplorerDeps {
  storyMapService: StoryMapService;
  workspace: WorkspacePort;
  eventBus: EventBus;
  /** Opens the Story Map Builder. */
  openStoryMapBuilder: () => void;
  /** Opens the card manager for a given map (add/edit/remove cards). */
  openCardManager: (map: StoryMap) => void;
}

/**
 * Live "Story Maps" panel: the flat list of Story Maps (PRD-sibling overlays),
 * each showing its product anchor and backbone/slice/card counts, with open,
 * rebuild-grid, and delete actions. Mirrors the PRDs explorer (LiveDashboardView).
 */
export class StoryMapExplorerView extends LiveDashboardView {
  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: StoryMapExplorerDeps,
  ) {
    super(leaf, deps.eventBus, REFRESH_ON);
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

  protected async render(): Promise<void> {
    const container = this.renderListHeader({
      headerCls: "e2e-test-hub-story-map-header",
      title: "Story Maps",
      actionLabel: "New Story Map",
      onAction: () => this.deps.openStoryMapBuilder(),
    });

    const maps = await this.deps.storyMapService.findAll();
    if (!maps.ok) {
      renderLoadError(
        container,
        `Could not load Story Maps: ${maps.error.message}`,
        "Retry loading the Story Maps",
        () => void this.live.schedule(),
      );
      return;
    }

    if (maps.value.length === 0) {
      container.createEl("p", {
        text: "No Story Maps yet. Create one to shape the product journey across PRDs.",
      });
      return;
    }

    const list = container.createEl("ul", { cls: "e2e-test-hub-story-map-list" });
    for (const map of maps.value) this.renderRow(list, map);
  }

  private renderRow(parent: HTMLElement, map: StoryMap): void {
    const li = parent.createEl("li", { cls: "e2e-test-hub-story-map-node" });
    const row = li.createDiv({ cls: "e2e-test-hub-story-map-row" });

    const cardCount = `${map.cards.length} card${map.cards.length === 1 ? "" : "s"}`;
    const meta = `${map.users.length} users · ${map.activities.length} activities · ${map.steps.length} steps · ${map.slices.length} slices · ${cardCount}`;
    const open = row.createEl("button", {
      text: `${map.id}: ${map.title} (${meta})`,
      cls: "e2e-test-hub-link-button",
      attr: { "aria-label": `Open Story Map ${map.id} ${map.title}` },
    });
    open.addEventListener("click", () => void openOrNotice(this.deps.workspace, map.path));

    row.createEl("span", {
      text: map.status,
      cls: "e2e-test-hub-story-map-status",
      attr: { "data-status": map.status },
    });

    row
      .createEl("button", {
        text: "Cards",
        cls: "e2e-test-hub-link-button",
        attr: { "aria-label": `Manage cards for ${map.id}` },
      })
      .addEventListener("click", () => this.deps.openCardManager(map));

    row
      .createEl("button", {
        text: "Rebuild grid",
        cls: "e2e-test-hub-link-button",
        attr: { "aria-label": `Rebuild the grid for ${map.id}` },
      })
      .addEventListener("click", () => void this.rebuildGrid(map));

    row
      .createEl("button", {
        text: "Delete",
        cls: "e2e-test-hub-link-button",
        attr: { "aria-label": `Delete Story Map ${map.id}` },
      })
      .addEventListener("click", () => void this.deleteStoryMap(map));
  }

  private async rebuildGrid(map: StoryMap): Promise<void> {
    const result = await this.deps.storyMapService.rebuildGrid(map.id);
    new Notice(
      result.ok
        ? `Rebuilt the grid for ${map.id}.`
        : `Could not rebuild ${map.id}: ${result.error.message}`,
    );
  }

  private async deleteStoryMap(map: StoryMap): Promise<void> {
    const result = await this.deps.storyMapService.deleteStoryMap(map.id);
    if (!result.ok) {
      new Notice(`Could not delete ${map.id}: ${result.error.message}`);
      return;
    }
    const preserved = result.value.preservedFiles;
    const suffix =
      preserved > 0 ? ` (kept ${preserved} other file${preserved === 1 ? "" : "s"})` : "";
    new Notice(`Deleted ${map.id}${suffix}.`);
    void this.live.schedule();
  }
}
