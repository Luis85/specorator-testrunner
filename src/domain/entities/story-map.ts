import type { VaultPath } from "../value-objects/identifiers";

/** A Story Map identifier, e.g. "SM-001". */
export type StoryMapId = string;

/** The reserved root product (PRD id) a Story Map anchors to by default (ADR-0027). */
export const STORY_MAP_DEFAULT_PRODUCT = "PRD-000";

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

/** Collapse whitespace/pipe runs to a single space and trim — the label invariant. */
const cleanLabel = (raw: string): string => raw.replace(/[\s|]+/g, " ").trim();

/**
 * Normalizes a label list (users, activities, slices): collapses whitespace and
 * the reserved `|`, drops blanks, and dedupes preserving order. Applied on BOTH
 * the create path and the read model so hand-edited frontmatter can't produce
 * duplicate columns/rows or a mismatch with card placement coordinates. Pure.
 */
export const normalizeLabels = (values: readonly string[] | undefined): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values ?? []) {
    const value = cleanLabel(raw);
    if (value === "" || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
};

/**
 * Normalizes steps: cleans both fields, drops a step whose activity is not on the
 * (already-normalized) backbone, and dedupes by (activity, step). Applied on both
 * create and read so the grid columns stay duplicate-free. Pure.
 */
export const normalizeSteps = (
  steps: readonly StoryMapStep[] | undefined,
  activities: readonly string[],
): StoryMapStep[] => {
  const allowed = new Set(activities);
  const seen = new Set<string>();
  const out: StoryMapStep[] = [];
  for (const raw of steps ?? []) {
    const activity = cleanLabel(raw.activity);
    const step = cleanLabel(raw.step);
    // `|` is a safe key delimiter: cleanLabel has stripped it from both fields.
    const key = `${activity}|${step}`;
    if (activity === "" || step === "" || !allowed.has(activity) || seen.has(key)) continue;
    seen.add(key);
    out.push({ activity, step });
  }
  return out;
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

/**
 * A canonical Use Case id: `UC-` + a zero-padded number (≥ 3 digits, matching
 * `use-case-service`'s `UC-${n.padStart(3, "0")}` generation). The single source
 * of truth for the card-ref format, shared by the application-layer placement
 * validator and the frontmatter parser below — so a hand-edited `cards` entry
 * can't smuggle a non-id ref (shorthand like `UC-37`, or an injection payload
 * like `UC-001]] ![[Other]]`) into the grid renderer, which wraps `ref` in a
 * bare `[[…]]` wikilink.
 */
export const isValidUseCaseRef = (ref: string): boolean => /^UC-\d{3,}$/.test(ref);

/** Builds a rich card from the nine positional fields, validating coordinates. */
const richCard = (fields: string[]): StoryMapCard | null => {
  const [ref, activity, step, slice, status, points, tags, color, title] = fields;
  if (activity === "" || slice === "") return null;
  // Drop a non-canonical ref: the card becomes reference-less and must stand on
  // its own title — never fall back to the invalid ref as the title, since it
  // could itself carry `[[…]]` and render as a link.
  const validRef = isValidUseCaseRef(ref) ? ref : "";
  const resolvedTitle = title !== "" ? title : validRef;
  // A free-text (reference-less) card must carry its own title.
  if (validRef === "" && resolvedTitle === "") return null;
  return {
    ...(validRef !== "" ? { ref: validRef } : {}),
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
  // Collapse interior whitespace (not just trim) so a card's activity/step/slice
  // coordinate matches the normalized axis labels — otherwise "Sign  in" would
  // miss the "Sign in" column and vanish from the grid while still counting.
  const parts = raw.split(FIELD_DELIMITER).map((part) => part.replace(/\s+/g, " ").trim());
  if (parts.length === 3) {
    const [ref, activity, slice] = parts;
    if (ref === "" || activity === "" || slice === "") return null;
    // A legacy card's ref is also its title; a non-canonical value is malformed
    // — drop it rather than render a dangling/injected `[[…]]` link.
    if (!isValidUseCaseRef(ref)) return null;
    return { ref, title: ref, activity, slice, tags: [] };
  }
  // A rich row has 4..9 fields (missing trailing fields are padded). MORE than
  // nine means a stray `|` in a field (title/tags/color) — reject rather than
  // truncate, which would silently drop/shift text on the next rebuild. Service-
  // authored cards never contain `|`, so an over-delimited row is hand-edit error.
  if (parts.length < 4 || parts.length > 9) return null;
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

/** A destination cell for a card move: the (activity, optional step, slice). */
export interface CardTarget {
  activity: string;
  step?: string;
  slice: string;
}

/** Re-coordinates a card to `target`, dropping `step` when the target has none. */
const withCell = (card: StoryMapCard, target: CardTarget): StoryMapCard => {
  const rebased = { ...card, activity: target.activity, slice: target.slice };
  if (target.step === undefined) {
    // Omit the key entirely (not `step: undefined`) so it matches no-step cards.
    const { step: _step, ...noStep } = rebased;
    return noStep;
  }
  return { ...rebased, step: target.step };
};

/** The indices in `cards` of the cards already in `target`'s cell (in order). */
const cellIndices = (cards: readonly StoryMapCard[], target: CardTarget): number[] =>
  cards.reduce<number[]>((acc, c, i) => {
    const sameStep = (c.step ?? undefined) === (target.step ?? undefined);
    if (c.activity === target.activity && sameStep && c.slice === target.slice) acc.push(i);
    return acc;
  }, []);

/**
 * Moves the card at `cardIndex` into `target`'s (activity, step, slice) cell,
 * placing it at `indexInCell` among that cell's existing cards (clamped; default
 * = end of the cell). Returns a NEW StoryMap with `cards` reordered so the
 * rendered grid (which preserves `cards` order within a cell) reflects the drop.
 * An out-of-range `cardIndex` returns the same map reference. Pure: no I/O.
 */
export const moveCard = (
  map: StoryMap,
  cardIndex: number,
  target: CardTarget,
  indexInCell?: number,
): StoryMap => {
  const card = map.cards[cardIndex];
  if (card === undefined) return map;
  const moved = withCell(card, target);
  const rest = map.cards.filter((_, i) => i !== cardIndex);
  const positions = cellIndices(rest, target);
  const clamped =
    indexInCell === undefined
      ? positions.length
      : Math.max(0, Math.min(indexInCell, positions.length));
  const insertAt =
    clamped < positions.length
      ? positions[clamped]
      : positions.length > 0
        ? positions[positions.length - 1] + 1
        : rest.length;
  return { ...map, cards: [...rest.slice(0, insertAt), moved, ...rest.slice(insertAt)] };
};

/**
 * Moves the item at `from` to `to`, returning a NEW array — or the SAME reference
 * when the move is a no-op (out of range or `from === to`), so callers can detect
 * "nothing changed". Pure.
 */
const moveInArray = <T>(arr: readonly T[], from: number, to: number): readonly T[] => {
  if (from < 0 || from >= arr.length || to < 0 || to >= arr.length || from === to) return arr;
  const copy = [...arr];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
};

/**
 * Reorders the activity at `from` to position `to` on the backbone. Cards
 * reference activities by label (a string), so reordering never breaks placement.
 * Returns the same map reference on a no-op. Pure: no I/O.
 */
export const reorderActivity = (map: StoryMap, from: number, to: number): StoryMap => {
  const next = moveInArray(map.activities, from, to);
  return next === map.activities ? map : { ...map, activities: [...next] };
};

/** Reorders the release slice at `from` to position `to`. Same contract as {@link reorderActivity}. */
export const reorderSlice = (map: StoryMap, from: number, to: number): StoryMap => {
  const next = moveInArray(map.slices, from, to);
  return next === map.slices ? map : { ...map, slices: [...next] };
};

/** A label not already in `existing`: `base`, else `base 2`, `base 3`, … Pure. */
const uniqueLabel = (existing: readonly string[], base: string): string => {
  if (!existing.includes(base)) return base;
  let n = 2;
  while (existing.includes(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
};

/** Appends a placeholder activity (rename it in place after). Pure. */
export const addActivity = (map: StoryMap): StoryMap => ({
  ...map,
  activities: [...map.activities, uniqueLabel(map.activities, "New activity")],
});

/** Appends a placeholder release slice. Pure. */
export const addSlice = (map: StoryMap): StoryMap => ({
  ...map,
  slices: [...map.slices, uniqueLabel(map.slices, "New slice")],
});

/**
 * Appends a placeholder step under `activity` (unique among that activity's
 * steps), or null when the activity is not on the backbone. Pure.
 */
export const addStep = (map: StoryMap, activity: string): StoryMap | null => {
  if (!map.activities.includes(activity)) return null;
  const own = map.steps.filter((s) => s.activity === activity).map((s) => s.step);
  return { ...map, steps: [...map.steps, { activity, step: uniqueLabel(own, "New step") }] };
};

/**
 * Renames the activity at `index` to `rawName`, rewriting the label on its steps
 * and cards (the label is the join key). Returns the SAME map when unchanged, or
 * null when the cleaned name is blank or duplicates another activity. Pure.
 */
export const renameActivity = (map: StoryMap, index: number, rawName: string): StoryMap | null => {
  const old = map.activities[index];
  if (old === undefined) return null;
  const name = cleanLabel(rawName);
  if (name === old) return map;
  if (name === "" || map.activities.includes(name)) return null;
  return {
    ...map,
    activities: map.activities.map((a, i) => (i === index ? name : a)),
    steps: map.steps.map((s) => (s.activity === old ? { ...s, activity: name } : s)),
    cards: map.cards.map((c) => (c.activity === old ? { ...c, activity: name } : c)),
  };
};

/** Renames the slice at `index`, rewriting its cards. Same contract as {@link renameActivity}. */
export const renameSlice = (map: StoryMap, index: number, rawName: string): StoryMap | null => {
  const old = map.slices[index];
  if (old === undefined) return null;
  const name = cleanLabel(rawName);
  if (name === old) return map;
  if (name === "" || map.slices.includes(name)) return null;
  return {
    ...map,
    slices: map.slices.map((s, i) => (i === index ? name : s)),
    cards: map.cards.map((c) => (c.slice === old ? { ...c, slice: name } : c)),
  };
};

/**
 * Renames step `oldStep` under `activity`, rewriting that activity's cards.
 * Returns the same map when unchanged, or null when blank or duplicating another
 * step of the same activity. Pure.
 */
export const renameStep = (
  map: StoryMap,
  activity: string,
  oldStep: string,
  rawName: string,
): StoryMap | null => {
  const name = cleanLabel(rawName);
  if (name === oldStep) return map;
  const own = map.steps.filter((s) => s.activity === activity).map((s) => s.step);
  if (!own.includes(oldStep)) return null;
  if (name === "" || own.includes(name)) return null;
  return {
    ...map,
    steps: map.steps.map((s) =>
      s.activity === activity && s.step === oldStep ? { ...s, step: name } : s,
    ),
    cards: map.cards.map((c) =>
      c.activity === activity && c.step === oldStep ? { ...c, step: name } : c,
    ),
  };
};

/**
 * A stable signature of a map's STRUCTURAL fields (users, activities, steps,
 * slices, cards) — the optimistic-concurrency baseline a board carries so a save
 * can detect that another surface changed the structure since it loaded.
 * Excludes title/status/displayOrder/path (a rename must not block a board save).
 * Pure: no I/O.
 */
export const storyMapSignature = (map: StoryMap): string =>
  JSON.stringify([
    map.users,
    map.activities,
    map.steps.map(encodeStep),
    map.slices,
    map.cards.map(encodeCard),
  ]);

/**
 * Reorders the card at `cardIndex` to position `indexInCell` among the cards in
 * its OWN cell (same activity/step/slice). A thin wrapper over {@link moveCard}
 * with the card's current coordinate. Pure: no I/O.
 */
export const reorderCardInCell = (
  map: StoryMap,
  cardIndex: number,
  indexInCell: number,
): StoryMap => {
  const card = map.cards[cardIndex];
  if (card === undefined) return map;
  return moveCard(
    map,
    cardIndex,
    { activity: card.activity, step: card.step, slice: card.slice },
    indexInCell,
  );
};

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
