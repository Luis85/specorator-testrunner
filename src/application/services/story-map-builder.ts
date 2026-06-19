import type { CreateStoryMapRequest } from "./story-map-service";
import { STORY_MAP_DEFAULT_PRODUCT, type StoryMapStep } from "../../domain/entities/story-map";

/** Sensible starting slices (top band = walking skeleton) the wizard pre-fills. */
export const DEFAULT_SLICES = ["Walking skeleton", "Next", "Later"] as const;

/**
 * Pure state for the Story Map builder wizard.
 * Steps: 1=title+product, 2=users, 3=activities, 4=steps, 5=slices, 6=review.
 */
export interface StoryMapBuilderState {
  /** Current step (1-6). */
  currentStep: number;
  title: string;
  /** Product (PRD id) the map anchors to. */
  product: string;
  /** Audience/persona labels, in order. */
  users: string[];
  /** Backbone activity labels, in journey order. */
  activities: string[];
  /** Task-level steps, each bound to a backbone activity, in order. */
  steps: StoryMapStep[];
  /** Release slice labels, in order (first = walking skeleton). */
  slices: string[];
  /** Field-level error messages (keyed by field name). */
  errorMessages: Record<string, string>;
}

export const STORY_MAP_STEP_COUNT = 6;

/** The title/label for a given Story Map builder step. */
export const storyMapBuilderStepTitle = (step: number): string => {
  switch (step) {
    case 1:
      return "Title & product";
    case 2:
      return "Users";
    case 3:
      return "Backbone (activities)";
    case 4:
      return "Steps";
    case 5:
      return "Release slices";
    case 6:
      return "Review";
    default:
      return "Unknown step";
  }
};

/**
 * Picks the product (PRD) a new map should anchor to: the root product vision
 * (PRD-000) when present, else the first PRD, else PRD-000 for an empty vault.
 * Pure: no I/O — keeps the builder modal's PRD load thin (AGENTS.md views rule).
 */
export const pickProductAnchor = (prds: readonly { id: string }[]): string =>
  prds.find((p) => p.id === STORY_MAP_DEFAULT_PRODUCT)?.id ??
  prds[0]?.id ??
  STORY_MAP_DEFAULT_PRODUCT;

/** A fresh builder state, optionally anchored to a given product. */
export const initialStoryMapBuilderState = (
  product = STORY_MAP_DEFAULT_PRODUCT,
): StoryMapBuilderState => ({
  currentStep: 1,
  title: "",
  product,
  users: [],
  activities: [],
  steps: [],
  slices: [...DEFAULT_SLICES],
  errorMessages: {},
});

/** Collapses a raw label: pipes/whitespace → single spaces, trimmed. Pure. */
const cleanLabel = (raw: string): string => raw.replace(/[\s|]+/g, " ").trim();

/**
 * Adds a trimmed label to a list, ignoring blanks, duplicates, and any value
 * containing the reserved `|` card delimiter. Returns a fresh array. Pure: no I/O.
 */
export const addLabel = (list: readonly string[], raw: string): string[] => {
  const value = cleanLabel(raw);
  if (value === "" || list.includes(value)) return [...list];
  return [...list, value];
};

/** Removes the label at `index` (out-of-range is a no-op). Pure: no I/O. */
export const removeLabelAt = (list: readonly string[], index: number): string[] =>
  list.filter((_, i) => i !== index);

/**
 * Adds a step for `activity` with label `raw` to the list, ignoring blanks, an
 * activity not on the backbone, and (activity, step) duplicates. Returns a fresh
 * array. Pure: no I/O.
 */
export const addStep = (
  list: readonly StoryMapStep[],
  activities: readonly string[],
  activity: string,
  raw: string,
): StoryMapStep[] => {
  const step = cleanLabel(raw);
  const exists = list.some((s) => s.activity === activity && s.step === step);
  if (step === "" || !activities.includes(activity) || exists) return [...list];
  return [...list, { activity, step }];
};

/** Removes the step at `index` (out-of-range is a no-op). Pure: no I/O. */
export const removeStepAt = (list: readonly StoryMapStep[], index: number): StoryMapStep[] =>
  list.filter((_, i) => i !== index);

/** Human-readable label for a step in the wizard list, e.g. "Configure SUT → Pick browser". */
export const formatStep = (step: StoryMapStep): string => `${step.activity} → ${step.step}`;

/**
 * The review step's summary lines — one per field in form order, with the same
 * human-readable placeholders the wizard shows for empty fields. Pure: no I/O.
 */
export const storyMapReviewLines = (state: StoryMapBuilderState): string[] => [
  `Title: ${state.title || "(none)"}`,
  `Product: ${state.product || STORY_MAP_DEFAULT_PRODUCT}`,
  `Users: ${state.users.join(", ") || "None"}`,
  `Activities: ${state.activities.join(" → ") || "None"}`,
  `Steps: ${state.steps.map(formatStep).join(", ") || "None"}`,
  `Slices: ${state.slices.join(", ") || "None"}`,
];

/**
 * Projects the collected wizard state onto the {@link CreateStoryMapRequest} the
 * service validates. Cards are added later by editing the note, so the request
 * carries none. Type-only import keeps this a compile-time contract. Pure: no I/O.
 */
export const toCreateStoryMapRequest = (state: StoryMapBuilderState): CreateStoryMapRequest => ({
  title: state.title,
  product: state.product,
  users: state.users,
  activities: state.activities,
  steps: state.steps,
  slices: state.slices,
});
