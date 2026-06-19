import type { VaultPath } from "../value-objects/identifiers";

/** A Story Map identifier, e.g. "SM-001". */
export type StoryMapId = string;

const STORY_MAP_STATUSES = ["draft", "active", "deprecated"] as const;
export type StoryMapStatus = (typeof STORY_MAP_STATUSES)[number];

export const isStoryMapStatus = (value: unknown): value is StoryMapStatus =>
  typeof value === "string" && (STORY_MAP_STATUSES as readonly string[]).includes(value);

/**
 * A card's **planning** status (set by hand by the team) — deliberately distinct
 * from a Use Case's run-derived **automation** status (ADR-0028). The map owns
 * this axis; it does not mirror the Use Case rollup.
 */
export const CARD_STATUSES = ["planned", "in-progress", "done", "blocked"] as const;
export type CardStatus = (typeof CARD_STATUSES)[number];

export const isCardStatus = (value: unknown): value is CardStatus =>
  typeof value === "string" && (CARD_STATUSES as readonly string[]).includes(value);

/**
 * A task-level step between an activity and a card (storymaps.io's Activity →
 * Step → Story). A step belongs to exactly one activity. Steps are optional — a
 * card may sit directly under an activity with no step.
 */
export interface StoryMapStep {
  activity: string;
  step: string;
}

/**
 * A placement on the map. A card keeps its **optional `UC-NNN` reference** (so
 * the single-source-of-truth rule of ADR-0027 still holds for referenced Use
 * Cases) but also carries map-owned planning attributes — a free-text title, a
 * planning status, story points, tags, and a color — that do not duplicate the
 * Use Case. A card may also be reference-less (a free-text story not yet promoted
 * to a Use Case). `activity`/`step`/`slice` match labels in the map's lists.
 */
export interface StoryMapCard {
  /** `UC-NNN` reference, or undefined for a free-text (reference-less) card. */
  ref?: string;
  /** Free-text title; falls back to `ref` when a ref-only card omits a title. */
  title: string;
  activity: string;
  /** Undefined when the card hangs directly under the activity (no step). */
  step?: string;
  slice: string;
  /** Planning status (hand-set), distinct from automation status. */
  status?: CardStatus;
  /** Non-negative integer story points, or undefined. */
  points?: number;
  tags: string[];
  /** Short token or hex color, or undefined. */
  color?: string;
}

/**
 * Read model for a Story Map note. A Story Map is a **sibling overlay to the
 * PRD** (not a node in the Domain → PRD → Use Case tree): it anchors to the
 * product root (`product`, a PRD id) and adds the facts the single-parent tree
 * was designed not to hold — audience `users`, the **backbone** (ordered
 * `activities`), task-level `steps`, and **release slices** (ordered `slices`,
 * first = walking skeleton) — over the rich `cards`.
 */
export interface StoryMap {
  id: StoryMapId;
  title: string;
  status: StoryMapStatus;
  /** The product this map shapes — a PRD id (e.g. "PRD-000"). */
  product: string;
  /** Audience labels: the "who" of the journey (a flat ordered list). */
  users: string[];
  /** Backbone: ordered activity labels (the journey, left to right). */
  activities: string[];
  /** Task-level steps, each bound to one activity (ordered). */
  steps: StoryMapStep[];
  /** Release bands: ordered slice labels; the first is the walking skeleton. */
  slices: string[];
  /** Rich card placements; references Use Cases by id, never copies content. */
  cards: StoryMapCard[];
  /** Sibling ordering without mutating immutable ids. */
  displayOrder: number;
  /** Folder-relative note path: <storyMapsPath>/<folder>/<folder>.md */
  path: VaultPath;
}

/** Field delimiter for the parser-safe string encodings (steps and cards). */
const FIELD_DELIMITER = "|";
/** Tags are comma-separated inside the single tags field. */
const TAG_DELIMITER = ",";

/** Encodes a step as a single parser-safe string scalar `"activity | step"`. */
export const encodeStep = (step: StoryMapStep): string =>
  `${step.activity} ${FIELD_DELIMITER} ${step.step}`;

/**
 * Parses the `"activity | step"` encoding. Returns null unless there are exactly
 * two non-empty parts, so a hand-edited bad line is skipped rather than crashing.
 */
export const parseStep = (raw: string): StoryMapStep | null => {
  const parts = raw.split(FIELD_DELIMITER).map((part) => part.trim());
  if (parts.length !== 2) return null;
  const [activity, step] = parts;
  if (activity === "" || step === "") return null;
  return { activity, step };
};

/**
 * A non-negative integer or undefined, parsed from a (possibly empty) field.
 * Uses the FULL numeric value (not `parseInt`), so a hand-edited non-integer
 * like `1.5` is dropped rather than truncated to `1`.
 */
const parsePoints = (raw: string): number | undefined => {
  if (raw === "") return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
};

/** Splits the comma-separated tags field into trimmed, non-empty tags. */
const parseTags = (raw: string): string[] =>
  raw
    .split(TAG_DELIMITER)
    .map((tag) => tag.trim())
    .filter((tag) => tag !== "");

/**
 * Encodes a rich card as the nine positional, pipe-delimited fields
 * `ref | activity | step | slice | status | points | tags | color | title`.
 * Always emits nine fields (empty fields allowed); `title` is last so it may
 * contain anything except `|`/newline. Parser-safe (ADR-0026/0028 rules).
 */
export const encodeCard = (card: StoryMapCard): string =>
  [
    card.ref ?? "",
    card.activity,
    card.step ?? "",
    card.slice,
    card.status ?? "",
    card.points === undefined ? "" : String(card.points),
    card.tags.join(TAG_DELIMITER),
    card.color ?? "",
    card.title,
  ].join(` ${FIELD_DELIMITER} `);

/** The optional planning attributes of a card (omitted when empty/invalid). */
const cardPlanningFields = (
  status: string,
  points: string,
  color: string,
): Pick<StoryMapCard, "status" | "points" | "color"> => {
  const out: Pick<StoryMapCard, "status" | "points" | "color"> = {};
  if (isCardStatus(status)) out.status = status;
  const parsedPoints = parsePoints(points);
  if (parsedPoints !== undefined) out.points = parsedPoints;
  if (color !== "") out.color = color;
  return out;
};

/** Builds a rich card from the nine positional fields, validating coordinates. */
const richCard = (fields: string[]): StoryMapCard | null => {
  const [ref, activity, step, slice, status, points, tags, color, title] = fields;
  if (activity === "" || slice === "") return null;
  const resolvedTitle = title !== "" ? title : ref;
  // A free-text (reference-less) card must carry its own title.
  if (ref === "" && resolvedTitle === "") return null;
  return {
    ...(ref !== "" ? { ref } : {}),
    title: resolvedTitle,
    activity,
    ...(step !== "" ? { step } : {}),
    slice,
    tags: parseTags(tags),
    ...cardPlanningFields(status, points, color),
  };
};

/**
 * Parses a card encoding. EXACTLY three fields → ADR-0027 legacy back-compat
 * `(ref, activity, slice)` with title=ref and no step/attributes (so existing
 * minimal notes keep working). Four or more fields → the rich positional form
 * (missing trailing fields padded). Returns null when the activity/slice is
 * empty, or a free-text card has no title.
 */
export const parseCard = (raw: string): StoryMapCard | null => {
  const parts = raw.split(FIELD_DELIMITER).map((part) => part.trim());
  if (parts.length === 3) {
    const [ref, activity, slice] = parts;
    if (ref === "" || activity === "" || slice === "") return null;
    return { ref, title: ref, activity, slice, tags: [] };
  }
  if (parts.length < 4) return null;
  const padded = [...parts, "", "", "", "", "", "", "", "", ""].slice(0, 9);
  return richCard(padded);
};

/** A leaf grid column: an activity, optionally narrowed to one of its steps. */
export interface StoryMapGridColumn {
  activity: string;
  /** Undefined for the column that holds cards with no step. */
  step?: string;
}

export interface StoryMapGridCell {
  column: StoryMapGridColumn;
  /** Cards placed in this (activity, step, slice) cell, in card order. */
  cards: StoryMapCard[];
}

export interface StoryMapGridRow {
  slice: string;
  /** Per-slice points roll-up: sum of points of ALL cards in this slice. */
  points: number;
  cells: StoryMapGridCell[];
}

/** A 2-D projection: rows = slices (with a points roll-up), columns = leaves. */
export interface StoryMapGrid {
  columns: StoryMapGridColumn[];
  rows: StoryMapGridRow[];
}

/**
 * Leaf columns: for each activity in order, one column per declared step of that
 * activity (in `steps` order). An activity also gets a `{ activity, step:
 * undefined }` no-step column when it has no declared steps, OR when a card hangs
 * directly under it (no `step`) — so no-step and legacy three-field cards are
 * never dropped from the rendered grid even after steps are defined.
 */
const buildGridColumns = (
  activities: readonly string[],
  steps: readonly StoryMapStep[],
  cards: readonly StoryMapCard[],
): StoryMapGridColumn[] =>
  activities.flatMap((activity) => {
    const ownSteps = steps.filter((s) => s.activity === activity);
    const columns: StoryMapGridColumn[] = ownSteps.map((s) => ({ activity, step: s.step }));
    const hasNoStepCard = cards.some((c) => c.activity === activity && c.step === undefined);
    if (ownSteps.length === 0 || hasNoStepCard) columns.push({ activity });
    return columns;
  });

/** Whether a card belongs in a given leaf column (a no-step column matches no-step cards). */
const cardInColumn = (card: StoryMapCard, column: StoryMapGridColumn): boolean =>
  card.activity === column.activity && card.step === column.step;

/**
 * Projects rich cards onto the leaf-column × slice grid. Each row carries the
 * per-slice points roll-up (sum of ALL cards' points in that slice, even those
 * dropped from the grid). Cards whose (activity, step) match no column are
 * dropped from the grid (they remain stored). Pure: no I/O.
 */
export const buildStoryMapGrid = (
  map: Pick<StoryMap, "activities" | "steps" | "slices" | "cards">,
): StoryMapGrid => {
  const columns = buildGridColumns(map.activities, map.steps, map.cards);
  return {
    columns,
    rows: map.slices.map((slice) => {
      const sliceCards = map.cards.filter((card) => card.slice === slice);
      return {
        slice,
        points: sliceCards.reduce((sum, card) => sum + (card.points ?? 0), 0),
        cells: columns.map((column) => ({
          column,
          cards: sliceCards.filter((card) => cardInColumn(card, column)),
        })),
      };
    }),
  };
};
