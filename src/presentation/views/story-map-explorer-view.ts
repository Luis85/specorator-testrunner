import { Notice, setIcon, type WorkspaceLeaf } from "obsidian";
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
    const card = li.createDiv({ cls: "e2e-test-hub-story-map-card" });

    // Title row: prominent title (opens the board) + status pill.
    const titleRow = card.createDiv({ cls: "e2e-test-hub-story-map-card-title-row" });
    const open = titleRow.createEl("button", {
      text: map.title,
      cls: "e2e-test-hub-story-map-card-title",
      attr: { "aria-label": `Open the board for ${map.id} ${map.title}` },
    });
    // The board is the primary working surface — the card's title opens it.
    open.addEventListener("click", () => this.deps.openStoryMapBoard(map.id));

    titleRow.createEl("span", {
      text: map.status,
      cls: "e2e-test-hub-story-map-status",
      attr: { "data-status": map.status, title: `Map status: ${map.status}` },
    });

    // Meta row: id + product anchor + count chips.
    const metaRow = card.createDiv({ cls: "e2e-test-hub-story-map-card-meta" });
    metaRow.createEl("span", {
      text: map.id,
      cls: "e2e-test-hub-story-map-card-id",
    });
    metaRow.createEl("span", {
      text: map.product,
      cls: "e2e-test-hub-story-map-card-product",
      attr: { title: `Anchored to ${map.product}` },
    });
    const chips = metaRow.createDiv({ cls: "e2e-test-hub-story-map-card-chips" });
    const count = (n: number, singular: string, plural = `${singular}s`): string =>
      `${n} ${n === 1 ? singular : plural}`;
    const chip = (text: string): void => {
      chips.createEl("span", { text, cls: "e2e-test-hub-story-map-chip" });
    };
    chip(count(map.users.length, "user"));
    chip(count(map.activities.length, "activity", "activities"));
    chip(count(map.steps.length, "step"));
    chip(count(map.slices.length, "slice"));
    chip(count(map.cards.length, "card"));

    // Action bar: compact icon buttons.
    const actions = card.createDiv({ cls: "e2e-test-hub-story-map-card-actions" });
    this.addIconAction(actions, "settings", "Settings", `Edit settings for ${map.id}`, () =>
      this.deps.openMapSettings(map),
    );
    this.addIconAction(actions, "file-text", "Open note", `Open the ${map.id} note`, () => {
      void openOrNotice(this.deps.workspace, map.path);
    });
    this.addIconAction(
      actions,
      "refresh-cw",
      "Refresh tables",
      `Refresh the Markdown tables for ${map.id}`,
      () => {
        void this.rebuildGrid(map);
      },
    );
    this.addIconAction(
      actions,
      "trash-2",
      "Delete",
      `Delete Story Map ${map.id}`,
      () => {
        void this.deleteStoryMap(map);
      },
      "e2e-test-hub-story-map-action-danger",
    );
  }

  private addIconAction(
    parent: HTMLElement,
    icon: string,
    label: string,
    ariaLabel: string,
    onClick: () => void,
    extraCls?: string,
  ): void {
    const cls = extraCls
      ? `e2e-test-hub-story-map-action ${extraCls}`
      : "e2e-test-hub-story-map-action";
    const button = parent.createEl("button", {
      cls,
      attr: { "aria-label": ariaLabel, title: label },
    });
    setIcon(button, icon);
    button.addEventListener("click", onClick);
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
