import type { VaultPath } from "../value-objects/identifiers";
import type { CardType, StoryMapCardId } from "./story-map-card";

/** A Story Map identifier, e.g. "SM-001". */
export type StoryMapId = string;

/** The reserved root product (PRD id) a Story Map anchors to by default (ADR-0027). */
export const STORY_MAP_DEFAULT_PRODUCT = "PRD-000";

export const STORY_MAP_STATUSES = ["draft", "active", "deprecated"] as const;
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
  /** Assigned when the card is persisted as a note (later task). */
  id?: StoryMapCardId;
  /** Drives the legend colour; absent ⇒ treated as "task". */
  cardType?: CardType;
  /** Index within its cell (later task). */
  order?: number;
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

/** Field delimiter for the parser-safe string encoding of steps. */
const FIELD_DELIMITER = "|";

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
 * A canonical Use Case id: `UC-` + a zero-padded number (≥ 3 digits, matching
 * `use-case-service`'s `UC-${n.padStart(3, "0")}` generation). The single source
 * of truth for the card-ref format, shared by the application-layer placement
 * validator and the card-note parser — so a hand-edited card ref can't smuggle a
 * non-id ref (shorthand like `UC-37`, or an injection payload like
 * `UC-001]] ![[Other]]`) into the grid renderer, which wraps `ref` in a bare
 * `[[…]]` wikilink.
 */
export const isValidUseCaseRef = (ref: string): boolean => /^UC-\d{3,}$/.test(ref);

/**
 * A stable per-card signature over every persisted field (id + placement +
 * attributes). The optimistic-concurrency unit for a single card row and the
 * per-card component of {@link storyMapSignature}. Joined with `|` (the fields
 * themselves never contain `|` — labels are cleaned via {@link normalizeLabels}/
 * cleanLabel and tags via comma). Pure: no I/O.
 */
export const cardSignature = (c: StoryMapCard): string =>
  [
    c.id ?? "",
    c.cardType ?? "task",
    c.ref ?? "",
    c.status ?? "",
    c.points ?? "",
    c.tags.join(","),
    c.color ?? "",
    c.activity,
    c.step ?? "",
    c.slice,
    c.title,
  ].join("|");

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
  /** Count of cards in this slice whose status is "done". */
  done: number;
  /** Total count of cards in this slice. */
  total: number;
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
 * Adjusts a drop indicator's in-cell index for {@link moveCard}. The indicator is
 * computed from the RENDERED (pre-removal) cell stack, but `moveCard` removes the
 * dragged card before inserting; for a same-cell FORWARD drag that shifts every
 * later slot left by one, so the persisted position would land one past the
 * indicator. When the dragged card already sits in the target cell at a rank
 * before `indexInCell`, decrement so the drop matches the preview. Cross-cell and
 * backward drags are unchanged. Pure.
 */
export const dropIndexForMove = (
  map: StoryMap,
  cardIndex: number,
  target: CardTarget,
  indexInCell: number,
): number => {
  const rank = cellIndices(map.cards, target).indexOf(cardIndex);
  return rank >= 0 && rank < indexInCell ? indexInCell - 1 : indexInCell;
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

/**
 * Removes the activity at `index` and its steps. REJECTS (returns null) when any
 * card references it — the product-owner policy is "reject if cards" so a card is
 * never silently orphaned. Null also on an out-of-range index. Pure: no I/O.
 */
export const removeActivity = (map: StoryMap, index: number): StoryMap | null => {
  const activity = map.activities[index];
  if (activity === undefined) return null;
  // A map needs at least one activity (saveMap rejects an empty backbone), so
  // reject removing the last one rather than let the board make a doomed edit.
  if (map.activities.length <= 1) return null;
  if (map.cards.some((c) => c.activity === activity)) return null;
  return {
    ...map,
    activities: map.activities.filter((_, i) => i !== index),
    steps: map.steps.filter((s) => s.activity !== activity),
  };
};

/** Removes the slice at `index`. Rejects when a card references it. Same contract as {@link removeActivity}. */
export const removeSlice = (map: StoryMap, index: number): StoryMap | null => {
  const slice = map.slices[index];
  if (slice === undefined) return null;
  // A map needs at least one release slice (saveMap rejects an empty set), so
  // reject removing the last one rather than let the board make a doomed edit.
  if (map.slices.length <= 1) return null;
  if (map.cards.some((c) => c.slice === slice)) return null;
  return { ...map, slices: map.slices.filter((_, i) => i !== index) };
};

/**
 * Removes step `step` under `activity`; its cards DEGRADE to no-step (the `step`
 * key is dropped so they hang directly under the activity). Returns null when the
 * step does not exist. Steps degrade rather than reject (product-owner policy).
 * Pure: no I/O.
 */
export const removeStep = (map: StoryMap, activity: string, step: string): StoryMap | null => {
  const exists = map.steps.some((s) => s.activity === activity && s.step === step);
  if (!exists) return null;
  return {
    ...map,
    steps: map.steps.filter((s) => !(s.activity === activity && s.step === step)),
    cards: map.cards.map((c) => {
      if (c.activity !== activity || c.step !== step) return c;
      const { step: _drop, ...noStep } = c;
      return noStep;
    }),
  };
};

/**
 * Reorders step `fromStep` to `toStep`'s position among `activity`'s own steps
 * (by label — the view drags one step header onto another of the same activity).
 * Returns the SAME map on a no-op, or null when either label is not a step of
 * `activity`. Other activities' step entries keep their slots. Pure: no I/O.
 */
export const reorderStep = (
  map: StoryMap,
  activity: string,
  fromStep: string,
  toStep: string,
): StoryMap | null => {
  const own = map.steps.filter((s) => s.activity === activity);
  const from = own.findIndex((s) => s.step === fromStep);
  const to = own.findIndex((s) => s.step === toStep);
  if (from === -1 || to === -1) return null;
  const moved = moveInArray(own, from, to);
  if (moved === own) return map;
  let k = 0;
  const steps = map.steps.map((s) => (s.activity === activity ? moved[k++] : s));
  return { ...map, steps };
};

/**
 * Appends a placeholder free-text card ("New card", uniquified by title) in the
 * `target` cell, to be renamed in place (P4). No-ops (same map ref) when the
 * target activity/slice is not on the map. Pure: no I/O.
 */
export const addCard = (map: StoryMap, target: CardTarget): StoryMap => {
  if (!map.activities.includes(target.activity) || !map.slices.includes(target.slice)) return map;
  const card: StoryMapCard = {
    title: uniqueLabel(
      map.cards.map((c) => c.title),
      "New card",
    ),
    activity: target.activity,
    ...(target.step !== undefined ? { step: target.step } : {}),
    slice: target.slice,
    tags: [],
    cardType: "task",
  };
  return { ...map, cards: [...map.cards, card] };
};

/** Removes the card at `index`; no-ops (same ref) out of range. Pure: no I/O. */
export const removeCard = (map: StoryMap, index: number): StoryMap => {
  if (map.cards[index] === undefined) return map;
  return { ...map, cards: map.cards.filter((_, i) => i !== index) };
};

/** Replaces the card at `index` with `card`, returning a new map. Pure. */
const withCardAt = (map: StoryMap, index: number, card: StoryMapCard): StoryMap => ({
  ...map,
  cards: map.cards.map((c, i) => (i === index ? card : c)),
});

/**
 * Renames the card at `index`. The title is cleaned (whitespace/`|` collapsed —
 * `|` is the encoding delimiter). Returns the SAME map when unchanged, or null
 * when the cleaned title is blank (a card must carry a title) or the index is out
 * of range. Pure: no I/O.
 */
export const editCardTitle = (map: StoryMap, index: number, rawTitle: string): StoryMap | null => {
  const card = map.cards[index];
  if (card === undefined) return null;
  const title = cleanLabel(rawTitle);
  if (title === card.title) return map;
  if (title === "") return null;
  return withCardAt(map, index, { ...card, title });
};

/**
 * Sets (or clears, when `color` is "") the color of the card at `index`. Returns
 * the SAME map when unchanged, or null when the index is out of range. Pure.
 */
export const recolorCard = (map: StoryMap, index: number, color: string): StoryMap | null => {
  const card = map.cards[index];
  if (card === undefined) return null;
  const next = color.trim();
  if (next === (card.color ?? "")) return map;
  if (next === "") {
    const { color: _drop, ...noColor } = card;
    return withCardAt(map, index, noColor);
  }
  return withCardAt(map, index, { ...card, color: next });
};

/**
 * Sets the planning status of the card at `index`; "" clears it. Returns the SAME
 * map when unchanged, or null when the index is out of range or `status` is a
 * non-empty non-status string. Pure: no I/O.
 */
export const editCardStatus = (map: StoryMap, index: number, status: string): StoryMap | null => {
  const card = map.cards[index];
  if (card === undefined) return null;
  if (status === "") {
    if (card.status === undefined) return map;
    const { status: _drop, ...noStatus } = card;
    return withCardAt(map, index, noStatus);
  }
  if (!isCardStatus(status)) return null;
  if (status === card.status) return map;
  return withCardAt(map, index, { ...card, status });
};

/**
 * Sets the story points of the card at `index`; "" clears. Returns the SAME map
 * when unchanged, or null when the index is out of range or the value is not a
 * non-negative integer (a decimal/non-numeric is rejected, not truncated). Pure.
 */
export const editCardPoints = (map: StoryMap, index: number, raw: string): StoryMap | null => {
  const card = map.cards[index];
  if (card === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === "") {
    if (card.points === undefined) return map;
    const { points: _drop, ...noPoints } = card;
    return withCardAt(map, index, noPoints);
  }
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 0) return null;
  if (n === card.points) return map;
  return withCardAt(map, index, { ...card, points: n });
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

/** Appends a placeholder audience user (rename it in place after). Pure. */
export const addUser = (map: StoryMap): StoryMap => ({
  ...map,
  users: [...map.users, uniqueLabel(map.users, "New user")],
});

/**
 * Renames the user at `index`. Returns the SAME map when unchanged, or null when
 * the cleaned name is blank or duplicates another user, or the index is out of
 * range. Users carry no card references, so nothing else is rewritten. Pure.
 */
export const renameUser = (map: StoryMap, index: number, rawName: string): StoryMap | null => {
  const old = map.users[index];
  if (old === undefined) return null;
  const name = cleanLabel(rawName);
  if (name === old) return map;
  if (name === "" || map.users.includes(name)) return null;
  return { ...map, users: map.users.map((u, i) => (i === index ? name : u)) };
};

/** Removes the user at `index`; no-ops (same ref) out of range. Pure: no I/O. */
export const removeUser = (map: StoryMap, index: number): StoryMap => {
  if (map.users[index] === undefined) return map;
  return { ...map, users: map.users.filter((_, i) => i !== index) };
};

/** Appends a placeholder release slice. Pure. */
export const addSlice = (map: StoryMap): StoryMap => ({
  ...map,
  slices: [...map.slices, uniqueLabel(map.slices, "New slice")],
});

/**
 * Appends a placeholder step under `activity` (unique among that activity's
 * steps), or null when the activity is not on the backbone. Pure.
 */
export const addStepTo = (map: StoryMap, activity: string): StoryMap | null => {
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
    map.cards.map(cardSignature),
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
        total: sliceCards.length,
        done: sliceCards.filter((card) => card.status === "done").length,
        cells: columns.map((column) => ({
          column,
          cards: sliceCards.filter((card) => cardInColumn(card, column)),
        })),
      };
    }),
  };
};
