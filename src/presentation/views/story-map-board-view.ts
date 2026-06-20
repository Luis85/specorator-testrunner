import { Notice, type WorkspaceLeaf } from "obsidian";
import type { StoryMapService } from "../../application/services/story-map-service";
import type { DomainEventType } from "../../domain/events/domain-event";
import type { StoryMap } from "../../domain/entities/story-map";
import { moveCard } from "../../domain/entities/story-map";
import type { EventBus } from "../../shared/event-bus/event-bus";
import { LiveDashboardView } from "./live-dashboard-view";
import { renderLoadError } from "./modal-helpers";
import { buildBoardScene } from "./story-map-board-scene";
import { type BoardLayout, computeBoardLayout, resolveDropTarget } from "./story-map-board-layout";
import { makeCardsDraggable } from "./story-map-board-dnd";

export const STORY_MAP_BOARD_VIEW_TYPE = "e2e-test-hub-story-map-board";

/** Close the board if its map is deleted; updated events are handled manually (origin guard). */
const REFRESH_ON: DomainEventType[] = ["storymap.deleted"];
const SAVE_DEBOUNCE_MS = 300;

export interface StoryMapBoardDeps {
  storyMapService: Pick<StoryMapService, "findById" | "saveMap">;
  eventBus: EventBus;
}

interface BoardState {
  storyMapId?: string;
}

/**
 * Interactive Story Map board (P2): drag a card to another cell and the move is
 * persisted via debounced saveMap. Holds an in-memory working model; ignores the
 * storymap.updated event its own save publishes (origin guard) and reloads only
 * on external updates. Thin: geometry + ops live in the pure modules.
 */
export class StoryMapBoardView extends LiveDashboardView {
  private storyMapId: string | null = null;
  private isOpen = false;
  private model: StoryMap | null = null;
  private readonly origin = `board-${Math.random().toString(36).slice(2)}`;
  private saveTimer: number | null = null;
  private cleanups: (() => void)[] = [];
  private unsubscribeUpdated: (() => void) | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: StoryMapBoardDeps,
  ) {
    super(leaf, deps.eventBus, REFRESH_ON);
  }

  // fallow-ignore-next-line unused-class-member
  getViewType(): string {
    return STORY_MAP_BOARD_VIEW_TYPE;
  }

  // fallow-ignore-next-line unused-class-member
  getDisplayText(): string {
    return "Story Map board";
  }

  // fallow-ignore-next-line unused-class-member
  getIcon(): string {
    return "layout-grid";
  }

  /** Persist the target map id so the leaf survives a workspace reload. */
  // fallow-ignore-next-line unused-class-member
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

  // fallow-ignore-next-line unused-class-member
  async onOpen(): Promise<void> {
    this.isOpen = true;
    // Manual subscription so we can inspect the payload's origin (LiveDashboardView
    // refreshes blindly). External updates reload; our own saves are ignored.
    this.unsubscribeUpdated = this.deps.eventBus.subscribe(
      "storymap.updated",
      (event: { payload: unknown }) => {
        const payload = event.payload as { storyMapId?: string; origin?: string };
        if (payload.storyMapId !== this.storyMapId) return;
        if (payload.origin === this.origin) return;
        void this.live.schedule();
      },
    );
    await this.live.open(this.refreshOn);
  }

  // fallow-ignore-next-line unused-class-member
  async onClose(): Promise<void> {
    this.isOpen = false;
    void this.flushSave();
    this.teardownDnd();
    this.unsubscribeUpdated?.();
    this.unsubscribeUpdated = null;
    this.live.close();
  }

  // Untested view render method (views are unit-test-exempt, AGENTS.md).
  // fallow-ignore-next-line complexity
  protected async render(): Promise<void> {
    const container = this.contentEl;
    this.teardownDnd();
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
    this.model = found.value;
    this.paint(container);
  }

  /** Renders the current working model + wires drag/drop. Re-callable after a move. */
  private paint(container: HTMLElement): void {
    if (this.model === null) return;
    // Detach prior drag wiring before re-rendering (an optimistic repaint after a
    // drop calls paint directly, without going through render's teardown).
    this.teardownDnd();
    container.empty();
    container.createEl("h2", { text: this.model.title, cls: "sm-board-title" });
    const layout = computeBoardLayout(this.model);
    const svg = this.renderSvg(container, layout);
    this.wireDnd(svg, layout);
  }

  /** Builds the `<svg>` from the scene specs and returns it. */
  private renderSvg(container: HTMLElement, layout: BoardLayout): SVGSVGElement {
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
    return svg;
  }

  /**
   * Makes each card draggable via interact.js (pointer-based, so it works on the
   * SVG `<rect>` cards — see ADR-0029 / story-map-board-dnd). On drop, the pointer
   * position resolves the target cell through the pure hit-test. The interactable
   * is detached on the next teardown (paint/close).
   */
  private wireDnd(svg: SVGSVGElement, layout: BoardLayout): void {
    this.cleanups.push(
      makeCardsDraggable(this.contentEl, {
        onStart: (el) => el.classList.add("is-dragging"),
        onEnd: (el, clientX, clientY) => this.onCardDrop(el, clientX, clientY, svg, layout),
      }),
    );
  }

  /** Applies the dropped card's move optimistically and schedules a save. */
  private onCardDrop(
    el: SVGElement,
    clientX: number,
    clientY: number,
    svg: SVGSVGElement,
    layout: BoardLayout,
  ): void {
    el.classList.remove("is-dragging");
    const next = this.buildMove(el, clientX, clientY, svg, layout);
    if (next === null || next === this.model) return;
    this.model = next;
    this.paint(this.contentEl);
    this.scheduleSave();
  }

  /**
   * Resolves the dropped card + pointer position to the next model state via the
   * pure `resolveDropTarget` + `moveCard`. Returns null when the drop is invalid
   * (no card index, or released outside every cell).
   */
  private buildMove(
    el: SVGElement,
    clientX: number,
    clientY: number,
    svg: SVGSVGElement,
    layout: BoardLayout,
  ): StoryMap | null {
    if (this.model === null) return null;
    const cardIndex = Number(el.getAttribute("data-card-index"));
    if (Number.isNaN(cardIndex)) return null;
    const target = resolveDropTarget(layout, this.toBoardPoint(svg, clientX, clientY));
    if (target === null) return null;
    return moveCard(this.model, cardIndex, target, target.indexInCell);
  }

  /** Screen → board coordinates using the SVG's CTM (identity-ish at P2). */
  private toBoardPoint(
    svg: SVGSVGElement,
    clientX: number,
    clientY: number,
  ): { x: number; y: number } {
    const ctm = svg.getScreenCTM();
    if (ctm === null) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const local = pt.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.flushSave(), SAVE_DEBOUNCE_MS);
  }

  // fallow-ignore-next-line complexity
  private async flushSave(): Promise<void> {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.model === null || this.storyMapId === null) return;
    const snapshot = this.model;
    const result = await this.deps.storyMapService.saveMap(this.storyMapId, snapshot, this.origin);
    if (!result.ok) {
      new Notice(`Could not save the board: ${result.error.message}`);
      await this.live.schedule(); // reload the last-saved state (revert the optimistic move)
    }
  }

  private teardownDnd(): void {
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups = [];
  }
}
