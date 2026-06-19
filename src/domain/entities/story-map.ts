import type { VaultPath } from "../value-objects/identifiers";

/** A Story Map identifier, e.g. "SM-001". */
export type StoryMapId = string;

const STORY_MAP_STATUSES = ["draft", "active", "deprecated"] as const;
export type StoryMapStatus = (typeof STORY_MAP_STATUSES)[number];

export const isStoryMapStatus = (value: unknown): value is StoryMapStatus =>
  typeof value === "string" && (STORY_MAP_STATUSES as readonly string[]).includes(value);

/**
 * A placement on the map: a Use Case referenced by **id only** at a
 * (activity, slice) coordinate. The map never copies Use Case content — the id
 * is the stable key and everything renderable is resolved from the referenced
 * Use Case (the single-source-of-truth rule, see ADR "Story Map as PRD-sibling
 * overlay"). `activity` and `slice` match a label in the map's ordered lists.
 */
export interface StoryMapCard {
  ucId: string;
  activity: string;
  slice: string;
}

/**
 * Read model for a Story Map note. A Story Map is a **sibling overlay to the
 * PRD** (not a node in the Domain → PRD → Use Case tree): it anchors to the
 * product root (`product`, a PRD id) and adds the two facts the single-parent
 * tree was designed not to hold — the **backbone** (ordered `activities`) and
 * **release slices** (ordered `slices`, first = walking skeleton) — over Use
 * Cases addressed by id in `cards`.
 */
export interface StoryMap {
  id: StoryMapId;
  title: string;
  status: StoryMapStatus;
  /** The product this map shapes — a PRD id (e.g. "PRD-000"). */
  product: string;
  /** Backbone: ordered activity labels (the journey, left to right). */
  activities: string[];
  /** Release bands: ordered slice labels; the first is the walking skeleton. */
  slices: string[];
  /** Use Case placements; references by id, never copies. */
  cards: StoryMapCard[];
  /** Sibling ordering without mutating immutable ids. */
  displayOrder: number;
  /** Folder-relative note path: <storyMapsPath>/<folder>/<folder>.md */
  path: VaultPath;
}

/** Card delimiter for the parser-safe string encoding `UC | activity | slice`. */
const CARD_DELIMITER = "|";

/**
 * Encodes a card as a single parser-safe string scalar `"UC-NNN | activity |
 * slice"` (no inline arrays/objects in frontmatter — ADR-0026 parser rules).
 */
export const encodeCard = (card: StoryMapCard): string =>
  `${card.ucId} ${CARD_DELIMITER} ${card.activity} ${CARD_DELIMITER} ${card.slice}`;

/**
 * Parses the `"UC-NNN | activity | slice"` encoding back into a card. Returns
 * null when the value is malformed (not exactly three non-empty parts) so a
 * hand-edited note with a bad line is skipped rather than crashing the read.
 */
export const parseCard = (raw: string): StoryMapCard | null => {
  const parts = raw.split(CARD_DELIMITER).map((part) => part.trim());
  if (parts.length !== 3) return null;
  const [ucId, activity, slice] = parts;
  if (ucId === "" || activity === "" || slice === "") return null;
  return { ucId, activity, slice };
};

export interface StoryMapGridCell {
  activity: string;
  /** Use Case ids placed in this (activity, slice) cell, in card order. */
  ucIds: string[];
}

export interface StoryMapGridRow {
  slice: string;
  cells: StoryMapGridCell[];
}

/** A 2-D projection of a map: rows = slices, columns = activities, cells = UC ids. */
export interface StoryMapGrid {
  activities: string[];
  rows: StoryMapGridRow[];
}

/**
 * Projects the flat (activity, slice) cards onto the ordered activity × slice
 * grid. Cards whose activity or slice is not in the map's ordered lists are
 * dropped from the grid (they remain stored, but render nowhere). Pure: no I/O.
 */
export const buildStoryMapGrid = (
  map: Pick<StoryMap, "activities" | "slices" | "cards">,
): StoryMapGrid => ({
  activities: [...map.activities],
  rows: map.slices.map((slice) => ({
    slice,
    cells: map.activities.map((activity) => ({
      activity,
      ucIds: map.cards
        .filter((card) => card.activity === activity && card.slice === slice)
        .map((card) => card.ucId),
    })),
  })),
});
