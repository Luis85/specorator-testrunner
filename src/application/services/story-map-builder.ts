import type { CreateStoryMapRequest } from "./story-map-service";

/** Sensible starting slices (top band = walking skeleton) the wizard pre-fills. */
export const DEFAULT_SLICES = ["Walking skeleton", "Next", "Later"] as const;

/**
 * Pure state for the Story Map builder wizard.
 * Steps: 1=title+product, 2=activities (backbone), 3=slices (release bands), 4=review.
 */
export interface StoryMapBuilderState {
  /** Current step (1-4). */
  currentStep: number;
  title: string;
  /** Product (PRD id) the map anchors to. */
  product: string;
  /** Backbone activity labels, in journey order. */
  activities: string[];
  /** Release slice labels, in order (first = walking skeleton). */
  slices: string[];
  /** Field-level error messages (keyed by field name). */
  errorMessages: Record<string, string>;
}

export const STORY_MAP_STEP_COUNT = 4;

/** The title/label for a given Story Map builder step. */
export const storyMapBuilderStepTitle = (step: number): string => {
  switch (step) {
    case 1:
      return "Title & product";
    case 2:
      return "Backbone (activities)";
    case 3:
      return "Release slices";
    case 4:
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
  prds.find((p) => p.id === "PRD-000")?.id ?? prds[0]?.id ?? "PRD-000";

/** A fresh builder state, optionally anchored to a given product. */
export const initialStoryMapBuilderState = (product = "PRD-000"): StoryMapBuilderState => ({
  currentStep: 1,
  title: "",
  product,
  activities: [],
  slices: [...DEFAULT_SLICES],
  errorMessages: {},
});

/**
 * Adds a trimmed label to a list, ignoring blanks, duplicates, and any value
 * containing the reserved `|` card delimiter. Returns the same reference on a
 * no-op so callers can skip a re-render. Pure: no I/O.
 */
export const addLabel = (list: readonly string[], raw: string): string[] => {
  const value = raw.replace(/[\s|]+/g, " ").trim();
  if (value === "" || list.includes(value)) return [...list];
  return [...list, value];
};

/** Removes the label at `index` (out-of-range is a no-op). Pure: no I/O. */
export const removeLabelAt = (list: readonly string[], index: number): string[] =>
  list.filter((_, i) => i !== index);

/**
 * The review step's summary lines — one per field in form order, with the same
 * human-readable placeholders the wizard shows for empty fields. Pure: no I/O.
 */
export const storyMapReviewLines = (state: StoryMapBuilderState): string[] => [
  `Title: ${state.title || "(none)"}`,
  `Product: ${state.product || "PRD-000"}`,
  `Activities: ${state.activities.join(" → ") || "None"}`,
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
  activities: state.activities,
  slices: state.slices,
});
