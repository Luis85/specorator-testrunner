import { Notice, type WorkspaceLeaf } from "obsidian";
import type { StoryMapService } from "../../application/services/story-map-service";
import type { UseCaseService } from "../../application/services/use-case-service";
import type { DomainEventType } from "../../domain/events/domain-event";
import type { CardTarget, StoryMap } from "../../domain/entities/story-map";
import {
  addActivity,
  addCard,
  addSlice,
  addStepTo,
  addUser,
  dropIndexForMove,
  editCardStatus,
  editCardTitle,
  moveCard,
  recolorCard,
  removeActivity,
  removeCard,
  removeSlice,
  removeStep,
  removeUser,
  renameActivity,
  renameSlice,
  renameStep,
  renameUser,
  reorderActivity,
  reorderSlice,
  reorderStep,
  storyMapSignature,
} from "../../domain/entities/story-map";
import type { EventBus } from "../../shared/event-bus/event-bus";
import { LiveDashboardView } from "./live-dashboard-view";
import { artifactTarget, type NavigationTarget } from "../navigation/navigation-target";
import { renderLoadError } from "./modal-helpers";
import { buildBoardScene, type SvgNodeSpec } from "./story-map-board-scene";
import { StoryMapCardModal } from "./story-map-card-modal";
import {
  type BoardLayout,
  computeBoardLayout,
  type DropCellIndicator,
  dropIndicator,
  headerDropIndicator,
  neighborCell,
  resolveActivityDropIndex,
  resolveColumnAt,
  resolveDropTarget,
  resolveSliceDropIndex,
} from "./story-map-board-layout";
import { makeDraggable } from "./story-map-board-dnd";

export const STORY_MAP_BOARD_VIEW_TYPE = "e2e-test-hub-story-map-board";

// Both storymap.updated and storymap.deleted are handled manually (filtered by id
// + the dirty-save guard), so LiveDashboardView does no blind reload — only its
// initial render. An UNRELATED map's update/delete must not reload this board.
const REFRESH_ON: DomainEventType[] = [];
const SAVE_DEBOUNCE_MS = 300;

export interface StoryMapBoardDeps {
  storyMapService: Pick<StoryMapService, "findById" | "saveMap" | "addCard" | "updateCard">;
  /** Passed to the Card modal for the reference picker + Promote-to-Use-Case. */
  useCaseService: Pick<UseCaseService, "create" | "assignToPrd" | "findAll">;
  eventBus: EventBus;
  // WS-A4/B4 deep-link port: clicking a card's `UC-NNN` ref opens that Use Case's
  // detail (01-§3.2). The board already resolves refs; this navigates to them.
  navigate: (target: NavigationTarget) => void;
}

interface BoardState {
  storyMapId?: string;
}

/**
 * Reads a non-negative integer index attribute (e.g. `data-card-index`), or null
 * when missing/non-numeric (`Number(null)`/`Number("")` are 0, so guard
 * explicitly rather than silently targeting index 0).
 */
const indexAttr = (el: Element, name: string): number | null => {
  const raw = el.getAttribute(name);
  if (raw === null || raw === "") return null;
  const index = Number(raw);
  return Number.isNaN(index) ? null : index;
};

/** A string attribute, or "" when absent (for SVG attrs that are always present). */
const attrOf = (el: Element, name: string): string => el.getAttribute(name) ?? "";

/** A header rect's current label, read from its adjacent `<text>` sibling. */
const headerLabelOf = (rect: Element): string => rect.nextElementSibling?.textContent ?? "";

/**
 * Resolves a double-clicked header rect to the matching rename op (by its data
 * attrs): activity-index → renameActivity, slice-index → renameSlice, else
 * (activity + step) → renameStep. Returns the new map, the same map (no-op), or
 * null (invalid/rejected). Pure.
 */
// fallow-ignore-next-line complexity
const renameFromHeader = (model: StoryMap, rect: Element, value: string): StoryMap | null => {
  const ui = indexAttr(rect, "data-user-index");
  if (ui !== null) return renameUser(model, ui, value);
  const ai = indexAttr(rect, "data-activity-index");
  if (ai !== null) return renameActivity(model, ai, value);
  const si = indexAttr(rect, "data-slice-index");
  if (si !== null) return renameSlice(model, si, value);
  const activity = rect.getAttribute("data-activity");
  const step = rect.getAttribute("data-step");
  if (activity === null || step === null) return null;
  return renameStep(model, activity, step, value);
};

/**
 * The dragged header's index on the axis its drop target is resolved against —
 * the activity/slice ordinal, or the dragged step's leaf-column index — so the
 * reorder preview can anchor its insertion line on the side the item will land.
 * Null when the element carries no such index (e.g. a no-step column). Pure.
 */
// fallow-ignore-next-line complexity
const headerDragFromIndex = (
  el: Element,
  kind: "activity" | "slice" | "step",
  layout: BoardLayout,
): number | null => {
  if (kind === "activity") return indexAttr(el, "data-activity-index");
  if (kind === "slice") return indexAttr(el, "data-slice-index");
  const activity = el.getAttribute("data-activity");
  const step = el.getAttribute("data-step");
  if (activity === null || step === null) return null;
  const i = layout.columns.findIndex((c) => c.activity === activity && c.step === step);
  return i === -1 ? null : i;
};

/** Applies an activity/slice header reorder, or null when either index is missing. */
const applyHeaderReorder = (
  model: StoryMap,
  kind: "activity" | "slice",
  from: number | null,
  to: number | null,
): StoryMap | null => {
  if (from === null || to === null) return null;
  return kind === "activity" ? reorderActivity(model, from, to) : reorderSlice(model, from, to);
};

/** Builds the add-card target from a clicked `+ card` affordance's cell attrs, or null. */
const cardTargetOf = (el: Element): CardTarget | null => {
  const activity = el.getAttribute("data-activity");
  const slice = el.getAttribute("data-slice");
  if (activity === null || slice === null) return null;
  const step = el.getAttribute("data-step");
  return step !== null ? { activity, slice, step } : { activity, slice };
};

/**
 * Resolves a dragged step header (its `data-activity`/`data-step`) dropped over
 * `drop` to the reordered model, or null when invalid (missing attrs, dropped
 * off a column, on a no-step column, or over a different activity). Pure.
 */
// fallow-ignore-next-line complexity
const stepReorderFrom = (
  model: StoryMap,
  el: Element,
  drop: { activity: string; step?: string } | null,
): StoryMap | null => {
  const fromActivity = el.getAttribute("data-activity");
  const fromStep = el.getAttribute("data-step");
  if (fromActivity === null || fromStep === null) return null;
  if (drop === null) return null;
  if (drop.step === undefined || drop.activity !== fromActivity) return null;
  return reorderStep(model, fromActivity, fromStep, drop.step);
};

/**
 * Resolves a clicked `×` remove affordance to the removal op result (new map,
 * same map on a no-op, or null on reject/invalid) by its `data-remove` kind. An
 * out-of-range index falls through the ops' own guards (e.g. `-1`). Pure.
 */
// fallow-ignore-next-line complexity
const removeFromButton = (model: StoryMap, el: Element): StoryMap | null => {
  const kind = el.getAttribute("data-remove");
  if (kind === "user") return removeUser(model, indexAttr(el, "data-user-index") ?? -1);
  if (kind === "activity") return removeActivity(model, indexAttr(el, "data-activity-index") ?? -1);
  if (kind === "slice") return removeSlice(model, indexAttr(el, "data-slice-index") ?? -1);
  if (kind === "card") return removeCard(model, indexAttr(el, "data-card-index") ?? -1);
  if (kind === "step") {
    const activity = el.getAttribute("data-activity");
    const step = el.getAttribute("data-step");
    return activity !== null && step !== null ? removeStep(model, activity, step) : null;
  }
  return null;
};

/** Maps an arrow key to the cell direction a focused card moves. */
const ARROW_DIR: Record<string, "left" | "right" | "up" | "down"> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

/** Resolves a focused header element to its removal op (mirrors {@link renameFromHeader}). Pure. */
// fallow-ignore-next-line complexity
const removeHeaderOf = (model: StoryMap, el: Element): StoryMap | null => {
  const ui = indexAttr(el, "data-user-index");
  if (ui !== null) return removeUser(model, ui);
  const ai = indexAttr(el, "data-activity-index");
  if (ai !== null) return removeActivity(model, ai);
  const si = indexAttr(el, "data-slice-index");
  if (si !== null) return removeSlice(model, si);
  const activity = el.getAttribute("data-activity");
  const step = el.getAttribute("data-step");
  return activity !== null && step !== null ? removeStep(model, activity, step) : null;
};

/** The board's quick-cycle color palette (click a swatch to advance; wraps to "" = no color). */
const CARD_PALETTE = ["#fca5a5", "#fdba74", "#fde047", "#86efac", "#93c5fd", "#c4b5fd"] as const;
/** The planning-status cycle order; "" clears the status. */
const STATUS_CYCLE = ["planned", "in-progress", "done", "blocked", ""] as const;

/** The next palette color after `current` ("" / unknown → first; last → "" to clear). Pure. */
const nextColor = (current: string | undefined): string => {
  const i = CARD_PALETTE.indexOf((current ?? "") as (typeof CARD_PALETTE)[number]);
  if (i === -1) return CARD_PALETTE[0];
  return i + 1 < CARD_PALETTE.length ? CARD_PALETTE[i + 1] : "";
};

/** The next status after `current` in the cycle order (wraps). Pure. */
const nextStatus = (current: string | undefined): string => {
  const i = STATUS_CYCLE.indexOf((current ?? "") as (typeof STATUS_CYCLE)[number]);
  return STATUS_CYCLE[(i + 1) % STATUS_CYCLE.length];
};

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
  /**
   * Every card id seen this session (loaded or freshly minted), never pruned on
   * delete. Seeds {@link addCard} so a card deleted before the debounce save runs
   * can't have its id re-minted and its on-disk note grafted onto a new card.
   */
  private readonly reservedCardIds = new Set<string>();
  /** The map signature last persisted — the optimistic-concurrency baseline for saves. */
  private baseline = "";
  /** Set when the model has unsaved edits; drained by the serialized save loop. */
  private dirty = false;
  /**
   * The in-flight save chain (one save at a time), or null when idle. Resolves
   * `true` when the model was persisted cleanly, `false` when a save error /
   * stale-signature conflict reloaded the board — so dependent ops (e.g. opening
   * the card editor) can abort instead of acting on a now-stale index.
   */
  private saving: Promise<boolean> | null = null;
  private readonly origin = `board-${Math.random().toString(36).slice(2)}`;
  private saveTimer: number | null = null;
  private cleanups: (() => void)[] = [];
  private unsubscribeUpdated: (() => void) | null = null;
  private unsubscribeDeleted: (() => void) | null = null;
  /** The open in-place rename editor's `<foreignObject>`, or null when none. */
  private editor: Element | null = null;
  /** Commits (true) / cancels (false) the open rename editor, or null when none. */
  private commitEditor: ((save: boolean) => void) | null = null;
  /** Top-most `<g>` holding transient drag feedback (drop-cell highlight + insertion line). */
  private overlay: SVGGElement | null = null;
  /** Board-space point where the active card drag began (for the live translate). */
  private dragOriginBoard: { x: number; y: number } | null = null;

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
      // Commit any open inline edit FIRST so its scheduleSave marks the (old) model
      // dirty and the flush below persists it under the OLD id — otherwise the
      // retarget resets model/id and the teardown blur commits against the wrong
      // target, dropping the rename. Same teardown-blur guard as onClose.
      this.commitEditor?.(true);
      // Persist the previous map's pending move (bound to its own id/model) BEFORE
      // retargeting, so a debounced save can't land the old model under the new id.
      await this.flushSave();
      this.storyMapId = next;
      this.model = null;
      this.baseline = "";
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
        void this.onExternalUpdate();
      },
    );
    // Only OUR map's deletion matters; an unrelated map's delete must not reload
    // this board (which would clobber an unsaved edit via the pending save).
    this.unsubscribeDeleted = this.deps.eventBus.subscribe(
      "storymap.deleted",
      (event: { payload: unknown }) => {
        const payload = event.payload as { storyMapId?: string };
        this.onMapDeleted(payload.storyMapId);
      },
    );
    await this.live.open(this.refreshOn);
  }

  /** Reloads only when THIS board's map was deleted; discards its pending save. */
  private onMapDeleted(deletedId: string | undefined): void {
    if (deletedId !== this.storyMapId) return;
    // The map is gone — CANCEL (not commit) any open rename so the reload's
    // teardown blur can't arm a doomed save against the deleted note.
    this.commitEditor?.(false);
    this.dirty = false;
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    void this.live.schedule();
  }

  /**
   * Handles an external `storymap.updated` (another surface changed this map).
   * Flush our own pending/in-flight save FIRST — the flush compares our now-stale
   * baseline against the externally-changed note and surfaces a conflict (Notice +
   * reload), and it drains the still-armed debounced save so it can't later clobber
   * the reloaded state with the user's stale drag. THEN reload to render the
   * external write — including when our save was merely in-flight (`saving !== null`)
   * with no new dirty edits, where awaiting the flush alone would leave the board on
   * a stale model until the next edit.
   */
  private async onExternalUpdate(): Promise<void> {
    // Commit any open inline rename FIRST so it counts as a pending edit (dirty)
    // and is flushed below, not dropped by the reload's editor teardown (the
    // blur would otherwise commit + schedule a save against the stale model).
    this.commitEditor?.(true);
    if (this.dirty || this.saving !== null) await this.flushSave();
    await this.live.schedule();
  }

  // fallow-ignore-next-line unused-class-member
  async onClose(): Promise<void> {
    this.isOpen = false;
    // Commit any open inline rename FIRST so its scheduleSave marks the model
    // dirty and the single awaited flush below persists it. Otherwise teardownDnd
    // removes the focused input, whose blur commits + schedules a NEW debounced
    // save AFTER the only flush — leaving the rename best-effort.
    this.commitEditor?.(true);
    // Await the pending debounced save so closing the leaf durably persists (or
    // reports) the last board edit; Obsidian waits on the promise onClose returns.
    await this.flushSave();
    this.teardownDnd();
    this.unsubscribeUpdated?.();
    this.unsubscribeUpdated = null;
    this.unsubscribeDeleted?.();
    this.unsubscribeDeleted = null;
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
    this.reserveCardIds(found.value);
    this.baseline = storyMapSignature(found.value);
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
    container.createEl("p", {
      cls: "sm-board-hint",
      text: "Hover a cell for + card · ✎ a card for full details (points, tags, reference, promote to Use Case) · hover a card to color, set status, or remove · double-click any header or card to rename · drag to move and reorder.",
    });
    const layout = computeBoardLayout(this.model);
    const svg = this.renderSvg(container, layout);
    // The overlay is created last so it paints on top of the scene; the view
    // fills it with the drop-cell highlight + insertion line during a drag.
    this.overlay = svg.createSvg("g", { cls: "sm-board-overlay" });
    this.wireDnd(svg, layout);
    this.wireControls(svg);
    this.wireKeyboard(svg, layout);
  }

  /** Binds keyboard operation of the focused card/header (a11y). Cleaned up on teardown. */
  private wireKeyboard(svg: SVGSVGElement, layout: BoardLayout): void {
    const onKey = (e: Event): void => this.onKeyDown(e as KeyboardEvent, layout);
    svg.addEventListener("keydown", onKey);
    this.cleanups.push(() => svg.removeEventListener("keydown", onKey));
  }

  /** Routes a keydown from a focused card/header to its keyboard action. */
  // fallow-ignore-next-line complexity
  private onKeyDown(e: KeyboardEvent, layout: BoardLayout): void {
    if (this.model === null) return;
    const el = e.target as Element;
    const cardIndex = indexAttr(el, "data-card-index");
    if (cardIndex !== null) {
      this.onCardKey(e, el as SVGElement, cardIndex, layout);
      return;
    }
    if (
      el.hasAttribute("data-user-index") ||
      el.hasAttribute("data-activity-index") ||
      el.hasAttribute("data-slice-index") ||
      el.getAttribute("data-step") !== null
    ) {
      this.onHeaderKey(e, el as SVGElement);
    }
  }

  /** Card keyboard ops: Enter/F2 rename · Delete remove · c/s cycle color/status · arrows move. */
  // fallow-ignore-next-line complexity
  private onCardKey(
    e: KeyboardEvent,
    el: SVGElement,
    cardIndex: number,
    layout: BoardLayout,
  ): void {
    if (this.model === null) return;
    const dir = ARROW_DIR[e.key];
    if (dir !== undefined) {
      e.preventDefault();
      const target = neighborCell(layout, cardIndex, dir);
      if (target !== null) this.applyCardEdit(moveCard(this.model, cardIndex, target));
      return;
    }
    if (e.key === "Enter" || e.key === "F2") {
      this.editFromKey(e, () => this.onEditCardTitle(el));
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      this.applyCardEdit(removeCard(this.model, cardIndex));
      return;
    }
    if (e.key === "c") {
      e.preventDefault();
      const next = recolorCard(
        this.model,
        cardIndex,
        nextColor(this.model.cards[cardIndex]?.color),
      );
      this.applyCardEdit(next);
      return;
    }
    if (e.key === "s") {
      e.preventDefault();
      const next = editCardStatus(
        this.model,
        cardIndex,
        nextStatus(this.model.cards[cardIndex]?.status),
      );
      this.applyCardEdit(next);
    }
  }

  /** Header keyboard ops: Enter/F2 rename · Delete remove. */
  // fallow-ignore-next-line complexity
  private onHeaderKey(e: KeyboardEvent, el: SVGElement): void {
    if (this.model === null) return;
    if (e.key === "Enter" || e.key === "F2") {
      this.editFromKey(e, () => this.onEditHeader(el));
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      this.applyCardEdit(removeHeaderOf(this.model, el));
    }
  }

  /** Prevents the key's default then runs an inline-edit opener. */
  private editFromKey(e: KeyboardEvent, open: () => void): void {
    e.preventDefault();
    open();
  }

  /**
   * Binds `type` on every element matching `selector` to `handler`, registering a
   * cleanup. Selectors scope to the `rect` (not its pointer-events:none label) so
   * each click/dblclick binds exactly once.
   */
  private bindEvent(
    svg: SVGSVGElement,
    selector: string,
    type: "click" | "dblclick",
    handler: (el: Element) => void,
  ): void {
    for (const el of Array.from(svg.querySelectorAll(selector))) {
      const fn = (): void => handler(el);
      el.addEventListener(type, fn);
      this.cleanups.push(() => el.removeEventListener(type, fn));
    }
  }

  /** Wires the add/remove/recolor/status controls + double-click-to-rename (headers and cards). */
  private wireControls(svg: SVGSVGElement): void {
    this.bindEvent(svg, "rect[data-add]", "click", (el) => this.onAdd(el));
    this.bindEvent(svg, "rect[data-remove]", "click", (el) => this.onRemove(el));
    this.bindEvent(svg, "rect[data-color-index]", "click", (el) => this.onCycleColor(el));
    this.bindEvent(svg, "rect[data-status-index]", "click", (el) => this.onCycleStatus(el));
    this.bindEvent(svg, "rect[data-edit]", "click", (el) => this.onEditCardDetails(el));
    // WS-A4: a card's `UC-NNN` ref deep-links to its Use Case detail.
    this.bindEvent(svg, "text[data-card-ref]", "click", (el) => this.onOpenCardRef(el));
    const headers =
      "rect.sm-board-activity, rect.sm-board-slice, rect.sm-board-step, rect.sm-board-user-card";
    this.bindEvent(svg, headers, "dblclick", (el) => this.onEditHeader(el as SVGElement));
    this.bindEvent(svg, ".sm-board-card-group", "dblclick", (el) =>
      this.onEditCardTitle(el as SVGElement),
    );
  }

  /** Inserts a placeholder activity/slice/step/card from a clicked `+`, repaints, and saves. */
  private onAdd(el: Element): void {
    const next = this.addByKind(el);
    if (next === null || next === this.model) return;
    this.model = next;
    this.paint(this.contentEl);
    this.scheduleSave();
  }

  // fallow-ignore-next-line complexity
  private addByKind(el: Element): StoryMap | null {
    if (this.model === null) return null;
    const kind = el.getAttribute("data-add");
    if (kind === "user") return addUser(this.model);
    if (kind === "activity") return addActivity(this.model);
    if (kind === "slice") return addSlice(this.model);
    if (kind === "step") {
      const activity = el.getAttribute("data-activity");
      return activity !== null ? addStepTo(this.model, activity) : null;
    }
    if (kind === "card") {
      const target = cardTargetOf(el);
      if (target === null) return null;
      const next = addCard(this.model, target, [...this.reservedCardIds]);
      this.reserveCardIds(next);
      return next;
    }
    return null;
  }

  /** Records `map`'s card ids as reserved (monotonic; never reused this session). */
  private reserveCardIds(map: StoryMap): void {
    for (const card of map.cards) if (card.id !== undefined) this.reservedCardIds.add(card.id);
  }

  /** Applies a `×` removal (activity/slice/step/card), repaints, and saves. */
  private onRemove(el: Element): void {
    if (this.model === null) return;
    const next = removeFromButton(this.model, el);
    if (next === null || next === this.model) return;
    this.model = next;
    this.paint(this.contentEl);
    this.scheduleSave();
  }

  /** Advances the clicked card's color to the next palette entry and saves. */
  private onCycleColor(el: Element): void {
    if (this.model === null) return;
    const index = indexAttr(el, "data-color-index");
    if (index === null) return;
    this.applyCardEdit(recolorCard(this.model, index, nextColor(this.model.cards[index]?.color)));
  }

  /** Advances the clicked card's planning status to the next in the cycle and saves. */
  private onCycleStatus(el: Element): void {
    if (this.model === null) return;
    const index = indexAttr(el, "data-status-index");
    if (index === null) return;
    this.applyCardEdit(
      editCardStatus(this.model, index, nextStatus(this.model.cards[index]?.status)),
    );
  }

  /** Commits a card-edit op result: repaints + schedules a save, or ignores a no-op/reject. */
  private applyCardEdit(next: StoryMap | null): void {
    if (next === null || next === this.model) return;
    this.model = next;
    this.paint(this.contentEl);
    this.scheduleSave();
  }

  /**
   * Mounts an inline `<input>` over `rect` (seeded from its label text), wires the
   * Enter/blur-commit + Escape-cancel lifecycle, and routes the committed value to
   * `apply`. Registers the commit handle so onClose/onExternalUpdate/onMapDeleted
   * can flush or cancel it. Shared by header rename and card-title edit.
   */
  private mountInlineEditor(rect: SVGElement, apply: (value: string) => void): void {
    const input = this.mountHeaderInput(rect);
    if (input === null) return;
    let done = false;
    const commit = (save: boolean): void => {
      if (done) return;
      done = true;
      const value = input.value;
      this.clearEditor();
      if (save) apply(value);
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") commit(true);
      else if (e.key === "Escape") commit(false);
    });
    input.addEventListener("blur", () => commit(true));
    input.focus();
    input.select();
    this.commitEditor = commit;
  }

  /** Mounts an inline editor over a double-clicked header; commits the rename on Enter/blur. */
  private onEditHeader(rect: SVGElement): void {
    if (this.model === null) return;
    this.mountInlineEditor(rect, (value) => this.commitRename(rect, value));
  }

  /**
   * Mounts an inline editor over a double-clicked card; commits the new title on
   * Enter/blur. The passed element is the card GROUP (it carries `data-card-index`);
   * the editor mounts over the child `rect.sm-board-card` tile (still at absolute x/y).
   */
  private onEditCardTitle(rect: SVGElement): void {
    const index = indexAttr(rect, "data-card-index");
    if (index === null || this.model === null) return;
    const tile = rect.querySelector<SVGElement>("rect.sm-board-card");
    if (tile === null) return;
    this.mountInlineEditor(tile, (value) => {
      if (this.model === null) return;
      this.applyCardEdit(editCardTitle(this.model, index, value));
    });
  }

  /** Opens the deep Card modal for the clicked card's `data-card-index`. */
  private onEditCardDetails(el: Element): void {
    const index = indexAttr(el, "data-card-index");
    if (index !== null) void this.openCardEditor(index);
  }

  /** WS-A4/B4: opens the Use Case detail named by a clicked card's `UC-NNN` ref. */
  private onOpenCardRef(el: Element): void {
    const ref = el.getAttribute("data-card-ref");
    if (ref !== null && ref !== "") this.deps.navigate(artifactTarget(ref));
  }

  /**
   * Opens {@link StoryMapCardModal} in edit mode for the card at `index` (points,
   * tags, reference, status, color, coordinate, Promote to Use Case). Flushes any
   * pending board save FIRST so the on-disk card list matches our in-memory model
   * — otherwise the modal's `updateCard` index/`expected` guard would target a
   * different on-disk card. The modal's write publishes `storymap.updated` (no
   * origin), which the board's `onExternalUpdate` reloads — so no explicit refresh.
   */
  private async openCardEditor(index: number): Promise<void> {
    // If the pre-open flush hit a conflict (or retargeted), the board reloaded and
    // `index` may now point at a different card — abort rather than seed the modal's
    // `expected` guard from the wrong card and risk editing it.
    if (!(await this.flushSave())) return;
    if (this.model === null) return;
    const card = this.model.cards[index];
    if (card === undefined) return;
    new StoryMapCardModal(this.app, {
      storyMapService: this.deps.storyMapService,
      useCaseService: this.deps.useCaseService,
      map: this.model,
      editIndex: index,
      card,
    }).open();
  }

  /** Applies a header rename to the model, repaints, and saves. */
  private commitRename(rect: SVGElement, value: string): void {
    if (this.model === null) return;
    const next = renameFromHeader(this.model, rect, value);
    if (next === null || next === this.model) return;
    this.model = next;
    this.paint(this.contentEl);
    this.scheduleSave();
  }

  /**
   * Mounts an `<input>` (in a `<foreignObject>`) over the header rect, seeded with
   * its current label, and returns it (or null if the SVG isn't available).
   */
  private mountHeaderInput(rect: SVGElement): HTMLInputElement | null {
    const svg = rect.ownerSVGElement;
    if (svg === null) return null;
    this.clearEditor();
    const fo = svg.createSvg("foreignObject", {
      attr: {
        x: attrOf(rect, "x"),
        y: attrOf(rect, "y"),
        width: attrOf(rect, "width"),
        height: attrOf(rect, "height"),
        class: "sm-board-edit-fo",
      },
    });
    this.editor = fo;
    const input = fo.createEl("input", { cls: "sm-board-edit-input" });
    input.value = headerLabelOf(rect);
    return input;
  }

  /** Removes any open inline editor. */
  private clearEditor(): void {
    this.editor?.remove();
    this.editor = null;
    this.commitEditor = null;
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
    for (const spec of buildBoardScene(layout)) this.appendSpec(svg, spec);
    return svg;
  }

  /** Renders one scene spec (and its children, recursively) as an SVG element under `parent`. */
  // CRAP is a 0-coverage artifact on this trivial untested view helper (cyclomatic 5).
  // fallow-ignore-next-line complexity
  private appendSpec(parent: Element, spec: SvgNodeSpec): void {
    const el = parent.createSvg(spec.tag, { cls: spec.class });
    for (const [k, v] of Object.entries(spec.attrs)) el.setAttribute(k, String(v));
    if (spec.text !== undefined) el.textContent = spec.text;
    for (const child of spec.children ?? []) this.appendSpec(el, child);
  }

  /**
   * Makes each card draggable via interact.js (pointer-based, so it works on the
   * SVG `<rect>` cards — see ADR-0029 / story-map-board-dnd). On drop, the pointer
   * position resolves the target cell through the pure hit-test. The interactable
   * is detached on the next teardown (paint/close).
   */
  private wireDnd(svg: SVGSVGElement, layout: BoardLayout): void {
    this.cleanups.push(
      makeDraggable(this.contentEl, ".sm-board-card-group", {
        onStart: (el, x, y) => this.onCardDragStart(el, x, y, svg),
        onMove: (el, x, y) => this.onCardDragMove(el, x, y, svg, layout),
        onEnd: (el, x, y) => this.onCardDrop(el, x, y, svg, layout),
      }),
      makeDraggable(this.contentEl, ".sm-board-activity", {
        onStart: (el) => el.classList.add("is-dragging"),
        onMove: (el, x, y) => this.onHeaderDragMove(el, "activity", x, y, svg, layout),
        onEnd: (el, x, y) => this.onHeaderDrop(el, "activity", x, y, svg, layout),
      }),
      makeDraggable(this.contentEl, ".sm-board-slice", {
        onStart: (el) => el.classList.add("is-dragging"),
        onMove: (el, x, y) => this.onHeaderDragMove(el, "slice", x, y, svg, layout),
        onEnd: (el, x, y) => this.onHeaderDrop(el, "slice", x, y, svg, layout),
      }),
      makeDraggable(this.contentEl, ".sm-board-step", {
        onStart: (el) => el.classList.add("is-dragging"),
        onMove: (el, x, y) => this.onHeaderDragMove(el, "step", x, y, svg, layout),
        onEnd: (el, x, y) => this.onStepDrop(el, x, y, svg, layout),
      }),
    );
  }

  /** A card drag began: dim it, record the origin, and raise it above its siblings. */
  private onCardDragStart(
    el: SVGElement,
    clientX: number,
    clientY: number,
    svg: SVGSVGElement,
  ): void {
    el.classList.add("is-dragging");
    this.dragOriginBoard = this.toBoardPoint(svg, clientX, clientY);
    // Raise the dragged card above its siblings (but below the overlay) so it
    // never slides under other cards as it moves.
    if (this.overlay !== null) svg.insertBefore(el, this.overlay);
  }

  /** A card drag moved: translate it to follow the pointer + show the drop target. */
  private onCardDragMove(
    el: SVGElement,
    clientX: number,
    clientY: number,
    svg: SVGSVGElement,
    layout: BoardLayout,
  ): void {
    if (this.dragOriginBoard === null) return;
    const pt = this.toBoardPoint(svg, clientX, clientY);
    const dx = pt.x - this.dragOriginBoard.x;
    const dy = pt.y - this.dragOriginBoard.y;
    el.setAttribute("transform", `translate(${dx} ${dy})`);
    this.paintDropCell(dropIndicator(layout, pt), el);
  }

  /** Draws (or clears) the card drop-cell highlight + insertion line in the overlay. */
  private paintDropCell(indicator: DropCellIndicator | null, el: SVGElement): void {
    if (this.overlay === null) return;
    this.overlay.empty();
    el.classList.toggle("is-no-drop", indicator === null);
    if (indicator === null) return;
    this.overlay.createSvg("rect", {
      cls: "sm-board-drop-cell",
      attr: { ...indicator.cell, rx: 4 },
    });
    this.overlayLine(indicator.line);
  }

  /** A header drag moved: show the reorder insertion line at the target slot. */
  private onHeaderDragMove(
    el: SVGElement,
    kind: "activity" | "slice" | "step",
    clientX: number,
    clientY: number,
    svg: SVGSVGElement,
    layout: BoardLayout,
  ): void {
    if (this.overlay === null) return;
    this.overlay.empty();
    const from = headerDragFromIndex(el, kind, layout);
    const point = this.toBoardPoint(svg, clientX, clientY);
    const indicator = headerDropIndicator(layout, kind, point, from);
    if (indicator !== null) this.overlayLine(indicator.line);
  }

  /** Appends an insertion line to the overlay. */
  private overlayLine(line: { x1: number; y1: number; x2: number; y2: number }): void {
    this.overlay?.createSvg("line", { cls: "sm-board-drop-line", attr: { ...line } });
  }

  /** Clears the transient drag overlay + the dragged element's live-drag transform. */
  private clearDragFeedback(el: SVGElement): void {
    el.classList.remove("is-dragging", "is-no-drop");
    el.removeAttribute("transform");
    this.overlay?.empty();
    this.dragOriginBoard = null;
  }

  /**
   * Reorders a step when its header is dropped over another step OF THE SAME
   * activity (steps belong to one activity; cross-activity moves are ignored). A
   * no-step column header carries no `data-step` and is not reorderable. The
   * branchy resolution lives in the pure `stepReorderFrom` helper.
   */
  private onStepDrop(
    el: SVGElement,
    clientX: number,
    clientY: number,
    svg: SVGSVGElement,
    layout: BoardLayout,
  ): void {
    this.overlay?.empty();
    el.classList.remove("is-dragging");
    if (this.model === null) return;
    const drop = resolveColumnAt(layout, this.toBoardPoint(svg, clientX, clientY).x);
    const next = stepReorderFrom(this.model, el, drop);
    if (next === null || next === this.model) return;
    this.model = next;
    this.paint(this.contentEl);
    this.scheduleSave();
  }

  /** Reorders an activity or slice when its header is dropped over another. */
  private onHeaderDrop(
    el: SVGElement,
    kind: "activity" | "slice",
    clientX: number,
    clientY: number,
    svg: SVGSVGElement,
    layout: BoardLayout,
  ): void {
    this.overlay?.empty();
    el.classList.remove("is-dragging");
    const next = this.buildReorder(el, kind, clientX, clientY, svg, layout);
    if (next === null || next === this.model) return;
    this.model = next;
    this.paint(this.contentEl);
    this.scheduleSave();
  }

  /** Resolves a header drop to the reordered model, or null when invalid/no-op. */
  private buildReorder(
    el: SVGElement,
    kind: "activity" | "slice",
    clientX: number,
    clientY: number,
    svg: SVGSVGElement,
    layout: BoardLayout,
  ): StoryMap | null {
    if (this.model === null) return null;
    const point = this.toBoardPoint(svg, clientX, clientY);
    const from = indexAttr(el, kind === "activity" ? "data-activity-index" : "data-slice-index");
    const to =
      kind === "activity"
        ? resolveActivityDropIndex(layout, point.x)
        : resolveSliceDropIndex(layout, point.y);
    return applyHeaderReorder(this.model, kind, from, to);
  }

  /** Applies the dropped card's move optimistically and schedules a save. */
  private onCardDrop(
    el: SVGElement,
    clientX: number,
    clientY: number,
    svg: SVGSVGElement,
    layout: BoardLayout,
  ): void {
    this.clearDragFeedback(el);
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
    const cardIndex = indexAttr(el, "data-card-index");
    if (this.model === null || cardIndex === null) return null;
    const target = resolveDropTarget(layout, this.toBoardPoint(svg, clientX, clientY));
    if (target === null) return null;
    // The indicator's index comes from the rendered (pre-removal) stack; adjust it
    // so a same-cell forward drop lands where the preview showed (see dropIndexForMove).
    const index = dropIndexForMove(this.model, cardIndex, target, target.indexInCell);
    return moveCard(this.model, cardIndex, target, index);
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

  /** Marks the model dirty and (re)arms the debounce. */
  private scheduleSave(): void {
    this.dirty = true;
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.flushSave(), SAVE_DEBOUNCE_MS);
  }

  /**
   * Runs (or joins) the serialized save chain and resolves when no work remains.
   * Only one save is ever in flight; a drop queued behind it re-runs the loop
   * against the just-advanced baseline (so it can't false-conflict with our own
   * prior save). Callers (e.g. setState before retargeting) can await the chain.
   */
  private flushSave(): Promise<boolean> {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.saving !== null) return this.saving;
    if (!this.dirty) return Promise.resolve(true);
    this.saving = this.runSaveLoop().finally(() => {
      this.saving = null;
    });
    return this.saving;
  }

  /**
   * Drains the serialized save chain. Resolves `true` when the model was persisted
   * cleanly (or there was nothing to save), `false` when a save error / conflict
   * reloaded the board or the leaf retargeted mid-save — in those cases the
   * in-memory model and any caller-held index are now stale.
   */
  // fallow-ignore-next-line complexity
  private async runSaveLoop(): Promise<boolean> {
    while (this.dirty) {
      if (this.model === null || this.storyMapId === null) {
        this.dirty = false;
        return true;
      }
      this.dirty = false;
      const id = this.storyMapId;
      const model = this.model;
      // Treat an unexpected throw like a failed Result (the service is Result-based,
      // but never lose an edit silently to an unhandled rejection).
      const outcome = await this.trySave(id, model);
      // The leaf retargeted to another map mid-save: our model/index context is
      // gone, so report not-clean so dependent ops abort.
      if (id !== this.storyMapId) return false;
      if ("error" in outcome) {
        new Notice(`Could not save the board: ${outcome.error}`);
        // Revert the optimistic edits to the last-saved state — but not while
        // closing (onClose awaits this flush), where a repaint is pointless and
        // would re-render a view about to be torn down.
        if (this.isOpen) await this.live.schedule();
        return false;
      }
      // Advance the baseline to what's now ON DISK — the composed map saveMap wrote
      // and reloaded — not the optimistic model we sent. saveMap normalizes on
      // persist (labels/steps, and each card through the buildCardNote→parseCardNote
      // round-trip), so a model-derived baseline would make the next save see a
      // phantom external change ("changed elsewhere").
      const saved = outcome.saved;
      const drifted = storyMapSignature(saved) !== storyMapSignature(model);
      this.baseline = storyMapSignature(saved);
      // Rebase the rendered model to the persisted, canonicalized one (reloadCards
      // sorts cards by cell/order) so data-card-index matches on-disk order and the
      // card modal's index/expected guard targets the right card. Only when the
      // board is idle — no edit arrived mid-save, the saved model is still current,
      // and no inline editor is open — so we never clobber newer optimistic state or
      // tear down an in-progress rename. The assign+paint is synchronous, so no edit
      // can interleave between them.
      if (drifted && !this.dirty && this.model === model && this.commitEditor === null) {
        this.model = saved;
        if (this.isOpen) this.paint(this.contentEl);
      }
    }
    return true;
  }

  /**
   * Persists one save. Returns the composed (persisted) map on success, or an
   * error message — never throws.
   */
  private async trySave(
    id: string,
    model: StoryMap,
  ): Promise<{ saved: StoryMap } | { error: string }> {
    try {
      const result = await this.deps.storyMapService.saveMap(id, model, this.origin, this.baseline);
      return result.ok ? { saved: result.value } : { error: result.error.message };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  private teardownDnd(): void {
    this.clearEditor();
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups = [];
  }
}
