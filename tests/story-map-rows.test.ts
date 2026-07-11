import { describe, expect, it } from "vitest";
import { storyMapChips, type StoryMapChipCounts } from "../src/presentation/views/story-map-rows";

const counts = (over: Partial<StoryMapChipCounts> = {}): StoryMapChipCounts => ({
  users: [],
  activities: [],
  steps: [],
  slices: [],
  cards: [],
  ...over,
});

describe("storyMapChips", () => {
  it("renders the five chips in display order", () => {
    const chips = storyMapChips(
      counts({
        users: ["u1", "u2"],
        activities: ["a1", "a2", "a3"],
        steps: [{ activity: "a1", step: "s1" }],
        slices: ["sl1", "sl2"],
        cards: [{ title: "c1", activity: "a1", slice: "sl1", tags: [] }],
      }),
    );
    expect(chips).toEqual(["2 users", "3 activities", "1 step", "2 slices", "1 card"]);
  });

  it("pluralizes zero counts and keeps singular labels for one", () => {
    expect(storyMapChips(counts())).toEqual([
      "0 users",
      "0 activities",
      "0 steps",
      "0 slices",
      "0 cards",
    ]);
    expect(storyMapChips(counts({ users: ["u"], activities: ["a"] })).slice(0, 2)).toEqual([
      "1 user",
      "1 activity",
    ]);
  });
});
