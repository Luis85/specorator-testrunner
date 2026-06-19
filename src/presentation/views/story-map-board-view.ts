import { type WorkspaceLeaf } from "obsidian";
import type { StoryMapService } from "../../application/services/story-map-service";
import type { DomainEventType } from "../../domain/events/domain-event";
import type { EventBus } from "../../shared/event-bus/event-bus";
import { LiveDashboardView } from "./live-dashboard-view";
import { renderLoadError } from "./modal-helpers";
import { buildBoardScene } from "./story-map-board-scene";
import { type BoardLayout, computeBoardLayout } from "./story-map-board-layout";

export const STORY_MAP_BOARD_VIEW_TYPE = "e2e-test-hub-story-map-board";

/** Reload the board when its map's content changes or the map is deleted. */
const REFRESH_ON: DomainEventType[] = ["storymap.updated", "storymap.deleted"];

export interface StoryMapBoardDeps {
  storyMapService: Pick<StoryMapService, "findById">;
  eventBus: EventBus;
}

interface BoardState {
  storyMapId?: string;
}

/**
 * Read-only Story Map board in the main workspace view (P1). Renders the map as
 * SVG from the pure layout/scene modules and reloads on storymap.updated /
 * storymap.deleted. Thin: all geometry lives in the pure modules.
 */
export class StoryMapBoardView extends LiveDashboardView {
  private storyMapId: string | null = null;
  private isOpen = false;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: StoryMapBoardDeps,
  ) {
    super(leaf, deps.eventBus, REFRESH_ON);
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
    return { storyMapId: this.storyMapId ?? undefined };
  }

  // Untested Obsidian-lifecycle override; mirrors UseCaseDetailView's restore-gap
  // handling (render only when already open -- onOpen drives the first render).
  // fallow-ignore-next-line complexity
  async setState(state: unknown, result: { history: boolean }): Promise<void> {
    const next = (state as BoardState | null)?.storyMapId;
    if (typeof next === "string" && next !== this.storyMapId) {
      this.storyMapId = next;
      if (this.isOpen) await this.live.schedule();
    }
    await super.setState(state, result);
  }

  async onOpen(): Promise<void> {
    this.isOpen = true;
    await this.live.open(this.refreshOn);
  }

  async onClose(): Promise<void> {
    this.isOpen = false;
    this.live.close();
  }

  // Untested view render method (views are unit-test-exempt, AGENTS.md).
  // fallow-ignore-next-line complexity
  protected async render(): Promise<void> {
    const container = this.contentEl;
    container.empty();
    container.addClass("sm-board-container");
    if (this.storyMapId === null) {
      container.createEl("p", { text: "Open a Story Map from the explorer to see its board." });
      return;
    }
    const found = await this.deps.storyMapService.findById(this.storyMapId);
    if (!found.ok) {
      renderLoadError(
        container,
        `Could not load the board: ${found.error.message}`,
        `Retry loading the board for ${this.storyMapId}`,
        () => void this.live.schedule(),
      );
      return;
    }
    if (!found.value) {
      container.createEl("p", { text: `Story Map ${this.storyMapId} was not found.` });
      return;
    }
    this.renderScene(container, found.value.title, computeBoardLayout(found.value));
  }

  /** Builds the `<svg>` from the scene specs. Thin: no geometry here. */
  private renderScene(container: HTMLElement, title: string, layout: BoardLayout): void {
    container.createEl("h2", { text: title, cls: "sm-board-title" });
    const svg = container.createSvg("svg", {
      cls: "sm-board-svg",
      attr: {
        viewBox: `0 0 ${layout.width} ${layout.height}`,
        width: layout.width,
        height: layout.height,
      },
    });
    for (const spec of buildBoardScene(layout)) {
      const el = svg.createSvg(spec.tag, { cls: spec.class });
      for (const [k, v] of Object.entries(spec.attrs)) el.setAttribute(k, String(v));
      if (spec.text !== undefined) el.textContent = spec.text;
    }
  }
}
