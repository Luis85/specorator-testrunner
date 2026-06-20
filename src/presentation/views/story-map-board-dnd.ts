import interact from "interactjs";

/**
 * Pointer-drag callbacks for the board's cards. Coordinates are screen-space
 * (`clientX`/`clientY`); the board converts them to board space and resolves the
 * drop cell via its pure layout hit-test. Kept tiny so all geometry stays out of
 * this adapter.
 */
export interface CardDragCallbacks {
  /** A drag began on this card element. */
  onStart: (element: SVGElement) => void;
  /** The drag ended at the given screen point. */
  onEnd: (element: SVGElement, clientX: number, clientY: number) => void;
}

/** The fields we read off an interact.js drag event (it types the event loosely). */
interface DragEventLike {
  target: SVGElement;
  client: { x: number; y: number };
}

/**
 * Makes every `.sm-board-card` inside `root` draggable with interact.js — a
 * pointer-event library, so it works on SVG elements. (The board renders cards
 * as SVG `<rect>`s; both native HTML5 drag-and-drop and `@atlaskit/pragmatic-
 * drag-and-drop` require an `HTMLElement` and cannot attach to them — see the
 * ADR-0029 spike note.)
 *
 * This is the SOLE importer of interact.js, so the drag library stays a thin,
 * swappable adapter. The board owns all geometry/hit-testing; this only relays
 * pointer start/end. Returns a cleanup function that detaches the interactable.
 */
export const makeCardsDraggable = (
  root: HTMLElement,
  callbacks: CardDragCallbacks,
): (() => void) => {
  // interact.js types its listener event loosely; annotate just the fields we
  // read (the dragged element + the screen-space pointer point) so the access is
  // type-checked rather than `any`.
  const interactable = interact(".sm-board-card", { context: root }).draggable({
    listeners: {
      start: (event: DragEventLike) => callbacks.onStart(event.target),
      end: (event: DragEventLike) => callbacks.onEnd(event.target, event.client.x, event.client.y),
    },
  });
  return () => interactable.unset();
};
