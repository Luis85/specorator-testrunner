import type { StoryMap, StoryMapCard } from "../../domain/entities/story-map";

/**
 * Pure, tested card-mutation + placement-validation helpers for the Story Map
 * authoring UI. Kept separate from the service (which does the I/O and the
 * note/grid rewrite) so the view methods stay thin and the rules stay tested
 * (AGENTS.md: testable logic lives in pure projections, not views).
 */

/** Appends a card to the list, returning a fresh array. Pure: no I/O. */
export const addCardToList = (
  cards: readonly StoryMapCard[],
  card: StoryMapCard,
): StoryMapCard[] => [...cards, card];

/**
 * Replaces the card at `index` with `card`, returning a fresh array. An
 * out-of-range index leaves the list unchanged (the service rejects it
 * separately). Pure: no I/O.
 */
export const updateCardInList = (
  cards: readonly StoryMapCard[],
  index: number,
  card: StoryMapCard,
): StoryMapCard[] => cards.map((existing, i) => (i === index ? card : existing));

/**
 * Removes the card at `index`, returning a fresh array. Out-of-range is a no-op.
 * Pure: no I/O.
 */
export const removeCardFromList = (cards: readonly StoryMapCard[], index: number): StoryMapCard[] =>
  cards.filter((_, i) => i !== index);

/** A card field is unsafe if it carries the `|` delimiter or a newline. */
const hasUnsafeChars = (value: string): boolean => /[|\r\n]/.test(value);

/** The card's free-text fields that must stay parser-safe (no `|`/newline). */
const cardTextFields = (card: StoryMapCard): string[] => [
  card.ref ?? "",
  card.title,
  card.color ?? "",
  ...card.tags,
];

/** Whether `step` is a declared step of `activity` on the map. */
const isDeclaredStep = (map: Pick<StoryMap, "steps">, activity: string, step: string): boolean =>
  map.steps.some((s) => s.activity === activity && s.step === step);

/**
 * Validates a card's placement against the map's declared axes, returning an
 * error string or `null` when valid. The single source of truth for both the
 * modal's client-side guard and the service's authoritative check:
 *
 * - `activity` must be on the backbone; `slice` must be a declared slice.
 * - a set `step` must be a declared step of that activity.
 * - a reference-less card must carry a non-empty title.
 * - `points`, if set, must be a non-negative integer.
 * - no field may contain the `|` delimiter or a newline.
 *
 * Pure: no I/O.
 */
export const validateCardPlacement = (
  map: Pick<StoryMap, "activities" | "slices" | "steps">,
  card: StoryMapCard,
): string | null => {
  if (!map.activities.includes(card.activity)) {
    return `Activity "${card.activity}" is not on this map's backbone.`;
  }
  if (!map.slices.includes(card.slice)) {
    return `Slice "${card.slice}" is not one of this map's release slices.`;
  }
  if (card.step !== undefined && !isDeclaredStep(map, card.activity, card.step)) {
    return `Step "${card.step}" is not a declared step of "${card.activity}".`;
  }
  if (card.ref === undefined && card.title.trim() === "") {
    return "A card with no Use Case reference needs a title.";
  }
  if (card.points !== undefined && !Number.isInteger(card.points)) {
    return "Points must be a whole number.";
  }
  if (card.points !== undefined && card.points < 0) {
    return "Points cannot be negative.";
  }
  if (cardTextFields(card).some(hasUnsafeChars)) {
    return "Card fields cannot contain the `|` character or line breaks.";
  }
  return null;
};
