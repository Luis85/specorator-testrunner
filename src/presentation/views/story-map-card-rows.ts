import type { StoryMapCard } from "../../domain/entities/story-map";

/** A card projected to the columns the card-manager modal lists. */
export interface CardManagerRow {
  /** The card's stable index in the map's `cards` list (the mutation key). */
  index: number;
  /** Primary label: the title, falling back to the ref for a bare ref card. */
  title: string;
  /** The `(activity › step › slice)` coordinate, human-readable. */
  coordinate: string;
  /** The compact `ref · status · Npts · #tag` attribute line (may be empty). */
  attributes: string;
}

/** The human-readable coordinate of a card: activity, optional step, slice. */
const coordinateOf = (card: StoryMapCard): string => {
  const parts = [card.activity];
  if (card.step !== undefined) parts.push(card.step);
  parts.push(card.slice);
  return parts.join(" › ");
};

/** The compact attribute line: ref, status, points, and tags (each present). */
const attributesOf = (card: StoryMapCard): string => {
  const parts: string[] = [];
  if (card.ref !== undefined) parts.push(card.ref);
  if (card.status !== undefined) parts.push(card.status);
  if (card.points !== undefined) parts.push(`${card.points}pts`);
  for (const tag of card.tags) parts.push(`#${tag}`);
  return parts.join(" · ");
};

/**
 * Projects the map's cards onto the manager's rows, preserving each card's
 * index so Edit/Remove address the right card even after the list re-renders.
 * Pure: no I/O — keeps the manager modal's row shaping testable and the view
 * methods thin (AGENTS.md views rule).
 */
export const projectCardManagerRows = (cards: readonly StoryMapCard[]): CardManagerRow[] =>
  cards.map((card, index) => ({
    index,
    title: card.title.trim() !== "" ? card.title : (card.ref ?? "(untitled)"),
    coordinate: coordinateOf(card),
    attributes: attributesOf(card),
  }));
