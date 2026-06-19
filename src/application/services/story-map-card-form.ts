import {
  CARD_STATUSES,
  type CardStatus,
  type StoryMap,
  type StoryMapCard,
} from "../../domain/entities/story-map";
import { isCardStatus } from "../../domain/entities/story-map";

/**
 * Pure form state + projections for the card-editor modal. The modal collects
 * raw strings; this module turns them into a {@link StoryMapCard} and supplies
 * the dropdown option lists — so the view stays thin and every branch is tested
 * (AGENTS.md: views get no unit tests, projections do).
 */

/** The "no step" / "no status" sentinel option value (an empty string). */
export const NO_STEP_OPTION = "";
export const NO_STATUS_OPTION = "";

/** Raw, string-typed values straight off the modal's fields. */
export interface CardFormValues {
  activity: string;
  /** Empty string means "(no step)". */
  step: string;
  slice: string;
  /** `UC-NNN` reference, or empty for a free-text card. */
  ref: string;
  title: string;
  /** Empty string means "no planning status". */
  status: string;
  /** Empty string means "no points"; otherwise a (possibly invalid) integer. */
  points: string;
  /** Comma-separated tags. */
  tags: string;
  color: string;
}

/** The seed form values when adding a card: defaults to the map's first axes. */
export const initialCardForm = (map: Pick<StoryMap, "activities" | "slices">): CardFormValues => ({
  activity: map.activities[0] ?? "",
  step: NO_STEP_OPTION,
  slice: map.slices[0] ?? "",
  ref: "",
  title: "",
  status: NO_STATUS_OPTION,
  points: "",
  tags: "",
  color: "",
});

/** The form values that reproduce an existing card (for the edit flow). */
export const cardToForm = (card: StoryMapCard): CardFormValues => ({
  activity: card.activity,
  step: card.step ?? NO_STEP_OPTION,
  slice: card.slice,
  ref: card.ref ?? "",
  title: card.title,
  status: card.status ?? NO_STATUS_OPTION,
  points: card.points === undefined ? "" : String(card.points),
  tags: card.tags.join(", "),
  color: card.color ?? "",
});

/** The step dropdown options for `activity`: its declared steps in order. */
export const stepOptionsFor = (map: Pick<StoryMap, "steps">, activity: string): string[] =>
  map.steps.filter((s) => s.activity === activity).map((s) => s.step);

/** The planning-status dropdown options (the four hand-set statuses). */
export const statusOptions = (): readonly CardStatus[] => CARD_STATUSES;

/** Splits the comma-separated tags field into trimmed, non-empty tags. */
const parseTags = (raw: string): string[] =>
  raw
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag !== "");

/** Parses the points field: empty → undefined; else the parsed integer (NaN-safe). */
const parsePoints = (raw: string): number | undefined => {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  return Number.parseInt(trimmed, 10);
};

/** Narrows a raw status string to a {@link CardStatus} or undefined. */
const parseStatus = (raw: string): CardStatus | undefined => (isCardStatus(raw) ? raw : undefined);

/**
 * Projects the raw form values onto a {@link StoryMapCard}: trims fields, drops
 * the optional ones when blank, and parses points/tags/status. Placement is NOT
 * validated here — the service's {@link validateCardPlacement} stays the single
 * authoritative gate (this only shapes the candidate). Pure: no I/O.
 */
export const buildCardFromForm = (values: CardFormValues): StoryMapCard => {
  const ref = values.ref.trim();
  const step = values.step.trim();
  const status = parseStatus(values.status);
  const points = parsePoints(values.points);
  const color = values.color.trim();
  return {
    ...(ref !== "" ? { ref } : {}),
    title: values.title.trim(),
    activity: values.activity,
    ...(step !== "" ? { step } : {}),
    slice: values.slice,
    ...(status !== undefined ? { status } : {}),
    ...(points !== undefined ? { points } : {}),
    tags: parseTags(values.tags),
    ...(color !== "" ? { color } : {}),
  };
};
