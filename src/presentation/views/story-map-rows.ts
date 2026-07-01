import type { StoryMap } from "../../domain/entities/story-map";

/** The count-chip inputs of one Story Map card (its backbone/slice/card sizes). */
export type StoryMapChipCounts = Pick<
  StoryMap,
  "users" | "activities" | "steps" | "slices" | "cards"
>;

/** `"<n> <singular|plural>"`, pluralizing on the count (1 stays singular). */
const count = (n: number, singular: string, plural = `${singular}s`): string =>
  `${n} ${n === 1 ? singular : plural}`;

/**
 * The five count chips shown on a Story Map card, in display order
 * (users → activities → steps → slices → cards). Pure so the pluralization is
 * unit-tested once, framework-agnostic (the Vue card and any future host render
 * the same strings).
 */
export const storyMapChips = (map: StoryMapChipCounts): string[] => [
  count(map.users.length, "user"),
  count(map.activities.length, "activity", "activities"),
  count(map.steps.length, "step"),
  count(map.slices.length, "slice"),
  count(map.cards.length, "card"),
];
