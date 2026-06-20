import {
  draggable,
  dropTargetForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";

/**
 * The data a dragged card carries: its stable index in `map.cards`. Kept tiny so
 * the drop handler resolves everything else from the board layout (§4).
 */
export interface CardDragData {
  /** Discriminator so a drop target can recognise our payload. */
  kind: "story-map-card";
  cardIndex: number;
}

/** A cell that can receive a card: its (activity, step, slice) coordinate. */
export interface CellDropData {
  kind: "story-map-cell";
  activity: string;
  step?: string;
  slice: string;
}

/** Type guard for the dragged-card payload. */
export const isCardDragData = (data: unknown): data is CardDragData =>
  typeof data === "object" &&
  data !== null &&
  (data as Record<string, unknown>).kind === "story-map-card" &&
  typeof (data as Record<string, unknown>).cardIndex === "number";

/**
 * Makes an element a draggable card. Returns the cleanup function Pragmatic-DnD
 * hands back (call it on re-render/teardown). The board owns all geometry; this
 * adapter only carries the card index.
 */
export const makeCardDraggable = (
  element: HTMLElement,
  cardIndex: number,
  onDragStateChange: (dragging: boolean) => void,
): (() => void) =>
  draggable({
    element,
    getInitialData: (): Record<string, unknown> => ({
      kind: "story-map-card" as const,
      cardIndex,
    }),
    onDragStart: () => onDragStateChange(true),
    onDrop: () => onDragStateChange(false),
  });

/**
 * Makes an element a drop target for cards. `onDrop` fires with the dragged
 * card's index when a card is released over this cell. Returns the cleanup fn.
 */
export const makeCellDropTarget = (
  element: Element,
  cell: Omit<CellDropData, "kind">,
  onDrop: (cardIndex: number) => void,
  onDragStateChange: (over: boolean) => void,
): (() => void) =>
  dropTargetForElements({
    element,
    getData: (): Record<string, unknown> => ({
      kind: "story-map-cell" as const,
      ...cell,
    }),
    onDragEnter: () => onDragStateChange(true),
    onDragLeave: () => onDragStateChange(false),
    onDrop: ({ source }) => {
      onDragStateChange(false);
      if (isCardDragData(source.data)) onDrop(source.data.cardIndex);
    },
  });
