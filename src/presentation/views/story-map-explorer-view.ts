import { Notice, type WorkspaceLeaf } from "obsidian";
import type { WorkspacePort } from "../../application/ports/workspace-port";
import type { StoryMapService } from "../../application/services/story-map-service";
import type { StoryMap } from "../../domain/entities/story-map";
import type { DomainEventType } from "../../domain/events/domain-event";
import type { EventBus } from "../../shared/event-bus/event-bus";
import { openOrNotice, renderLoadError } from "./modal-helpers";
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

    const count = (n: number, singular: string, plural = `${singular}s`): string =>
      `${n} ${n === 1 ? singular : plural}`;
    const meta = [
      count(map.users.length, "user"),
      count(map.activities.length, "activity", "activities"),
      count(map.steps.length, "step"),
      count(map.slices.length, "slice"),
      count(map.cards.length, "card"),
    ].join(" · ");
    const open = row.createEl("button", {
      text: `${map.id}: ${map.title} (${meta})`,
      cls: "e2e-test-hub-link-button",
      attr: { "aria-label": `Open the board for ${map.id} ${map.title}` },
    });
    // The board is the primary working surface — the row's main click opens it.
    open.addEventListener("click", () => this.deps.openStoryMapBoard(map.id));

    row.createEl("span", {
      text: map.status,
      cls: "e2e-test-hub-story-map-status",
      attr: { "data-status": map.status, title: `Map status: ${map.status}` },
    });

    row
      .createEl("button", {
        text: "Settings",
        cls: "e2e-test-hub-link-button",
        attr: { "aria-label": `Edit settings for ${map.id}` },
      })
      .addEventListener("click", () => this.deps.openMapSettings(map));

    row
      .createEl("button", {
        text: "Open note",
        cls: "e2e-test-hub-link-button",
        attr: { "aria-label": `Open the ${map.id} note` },
      })
      .addEventListener("click", () => void openOrNotice(this.deps.workspace, map.path));

    row
      .createEl("button", {
        text: "Refresh tables",
        cls: "e2e-test-hub-link-button",
        attr: {
          "aria-label": `Refresh the Markdown tables for ${map.id}`,
          title: "Regenerate the managed Markdown tables from this note's frontmatter",
        },
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
        ? `Refreshed the tables for ${map.id}.`
        : `Could not refresh ${map.id}: ${result.error.message}`,
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
