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
import { isCardDragData } from "./story-map-board-dnd";

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
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private cleanups: Array<() => void> = [];
  private unsubscribeUpdated: (() => void) | null = null;
  /** Index of the card currently being dragged; null when idle. */
  private draggingCardIndex: number | null = null;

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
    this.flushSave();
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
   * Makes each card-rect natively draggable and wires the SVG as the drop
   * surface. Uses native HTML5 drag events because SVG <rect> elements are
   * SVGRectElement (not HTMLElement), so Pragmatic-DnD's draggable() cannot
   * attach to them directly. isCardDragData from the DnD adapter validates the
   * drag payload carried via dataTransfer. All listeners stored in cleanups[].
   */
  private wireDnd(svg: SVGSVGElement, layout: BoardLayout): void {
    for (const rect of Array.from(svg.querySelectorAll("rect.sm-board-card"))) {
      this.wireCardDrag(rect);
    }
    this.wireSvgDrop(svg, layout);
  }

  /** Attaches native drag-source listeners to one card rect. */
  private wireCardDrag(rect: Element): void {
    const index = Number(rect.getAttribute("data-card-index"));
    if (Number.isNaN(index)) return;
    rect.setAttribute("draggable", "true");
    const onStart = (ev: Event) => {
      const dragData = { kind: "story-map-card" as const, cardIndex: index };
      (ev as DragEvent).dataTransfer?.setData("application/json", JSON.stringify(dragData));
      this.draggingCardIndex = index;
      rect.classList.add("is-dragging");
    };
    const onEnd = () => {
      this.draggingCardIndex = null;
      rect.classList.remove("is-dragging");
    };
    rect.addEventListener("dragstart", onStart);
    rect.addEventListener("dragend", onEnd);
    this.cleanups.push(() => {
      rect.removeEventListener("dragstart", onStart);
      rect.removeEventListener("dragend", onEnd);
    });
  }

  /** Attaches native drop-surface listeners to the whole SVG element. */
  private wireSvgDrop(svg: SVGSVGElement, layout: BoardLayout): void {
    const onDragOver = (ev: Event) => ev.preventDefault();
    const onDrop = (ev: Event) => this.onSvgDrop(ev as DragEvent, svg, layout);
    svg.addEventListener("dragover", onDragOver);
    svg.addEventListener("drop", onDrop);
    this.cleanups.push(() => {
      svg.removeEventListener("dragover", onDragOver);
      svg.removeEventListener("drop", onDrop);
    });
  }

  /**
   * Parses the drag payload (via isCardDragData from the DnD adapter), resolves
   * the drop cell from the pointer position, and returns the next model state.
   * Returns null when the drop is invalid (wrong payload, outside cells, no-op).
   */
  // fallow-ignore-next-line complexity
  private buildMove(ev: DragEvent, svg: SVGSVGElement, layout: BoardLayout): StoryMap | null {
    if (this.model === null) return null;
    const raw = ev.dataTransfer?.getData("application/json");
    const parsed: unknown = raw ? (JSON.parse(raw) as unknown) : null;
    if (!isCardDragData(parsed)) return null;
    const point = this.toBoardPoint(svg, ev.clientX, ev.clientY);
    const target = resolveDropTarget(layout, point);
    if (target === null) return null;
    return moveCard(this.model, parsed.cardIndex, target, target.indexInCell);
  }

  /** Applies the move optimistically and schedules a save. */
  private onSvgDrop(ev: DragEvent, svg: SVGSVGElement, layout: BoardLayout): void {
    const next = this.buildMove(ev, svg, layout);
    if (next === null || next === this.model) return;
    this.model = next;
    this.paint(this.contentEl);
    this.scheduleSave();
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
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flushSave(), SAVE_DEBOUNCE_MS);
  }

  // fallow-ignore-next-line complexity
  private async flushSave(): Promise<void> {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
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
