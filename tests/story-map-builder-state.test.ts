import { describe, expect, it } from "vitest";
import {
  addLabel,
  addStep,
  DEFAULT_SLICES,
  formatStep,
  initialStoryMapBuilderState,
  pickProductAnchor,
  removeActivityAt,
  removeLabelAt,
  removeStepAt,
  STORY_MAP_STEP_COUNT,
  storyMapBuilderStepTitle,
  storyMapReviewLines,
  toCreateStoryMapRequest,
} from "../src/application/services/story-map-builder";

describe("storyMapBuilderStepTitle", () => {
  it("labels each of the six steps", () => {
    expect(STORY_MAP_STEP_COUNT).toBe(6);
    expect(storyMapBuilderStepTitle(1)).toBe("Title & product");
    expect(storyMapBuilderStepTitle(2)).toBe("Users");
    expect(storyMapBuilderStepTitle(3)).toBe("Backbone (activities)");
    expect(storyMapBuilderStepTitle(4)).toBe("Steps");
    expect(storyMapBuilderStepTitle(5)).toBe("Release slices");
    expect(storyMapBuilderStepTitle(6)).toBe("Review");
    expect(storyMapBuilderStepTitle(9)).toBe("Unknown step");
  });
});

describe("initialStoryMapBuilderState", () => {
  it("starts on step 1 with the default slices and product anchor", () => {
    const state = initialStoryMapBuilderState();
    expect(state.currentStep).toBe(1);
    expect(state.product).toBe("PRD-000");
    expect(state.slices).toEqual([...DEFAULT_SLICES]);
    expect(state.users).toEqual([]);
    expect(state.activities).toEqual([]);
    expect(state.steps).toEqual([]);
  });
});

describe("pickProductAnchor", () => {
  it("prefers PRD-000, then the first PRD, then PRD-000 for an empty vault", () => {
    expect(pickProductAnchor([{ id: "PRD-002" }, { id: "PRD-000" }])).toBe("PRD-000");
    expect(pickProductAnchor([{ id: "PRD-007" }, { id: "PRD-009" }])).toBe("PRD-007");
    expect(pickProductAnchor([])).toBe("PRD-000");
  });
});

describe("addLabel / removeLabelAt", () => {
  it("adds trimmed labels, ignoring blanks, duplicates, and the | delimiter", () => {
    expect(addLabel([], "  Author spec  ")).toEqual(["Author spec"]);
    expect(addLabel(["Author spec"], "Author spec")).toEqual(["Author spec"]);
    expect(addLabel([], "   ")).toEqual([]);
    expect(addLabel([], "a | b")).toEqual(["a b"]);
  });

  it("removes the label at an index (out-of-range is a no-op)", () => {
    expect(removeLabelAt(["a", "b", "c"], 1)).toEqual(["a", "c"]);
    expect(removeLabelAt(["a"], 9)).toEqual(["a"]);
  });
});

describe("removeActivityAt", () => {
  it("removes the activity AND drops the steps that hang under it", () => {
    const activities = ["Browse", "Buy"];
    const steps = [
      { activity: "Browse", step: "Search" },
      { activity: "Buy", step: "Pay" },
    ];
    const next = removeActivityAt(activities, steps, 0);
    expect(next.activities).toEqual(["Buy"]);
    expect(next.steps).toEqual([{ activity: "Buy", step: "Pay" }]);
  });

  it("is a no-op on the steps for an out-of-range index", () => {
    const steps = [{ activity: "Browse", step: "Search" }];
    expect(removeActivityAt(["Browse"], steps, 9)).toEqual({
      activities: ["Browse"],
      steps,
    });
  });
});

describe("addStep / removeStepAt / formatStep", () => {
  const activities = ["Author spec", "Run tests"];

  it("adds a step under a known activity, ignoring blanks, off-backbone, and duplicates", () => {
    const one = addStep([], activities, "Author spec", "  Draft  ");
    expect(one).toEqual([{ activity: "Author spec", step: "Draft" }]);
    expect(addStep(one, activities, "Author spec", "Draft")).toEqual(one); // duplicate
    expect(addStep([], activities, "Author spec", "  ")).toEqual([]); // blank
    expect(addStep([], activities, "Unknown", "Draft")).toEqual([]); // off-backbone
  });

  it("removes a step at an index and formats it for display", () => {
    const list = [
      { activity: "Author spec", step: "Draft" },
      { activity: "Run tests", step: "Watch" },
    ];
    expect(removeStepAt(list, 0)).toEqual([{ activity: "Run tests", step: "Watch" }]);
    expect(formatStep(list[0])).toBe("Author spec → Draft");
  });
});

describe("storyMapReviewLines / toCreateStoryMapRequest", () => {
  it("summarizes the collected state for review", () => {
    const state = {
      ...initialStoryMapBuilderState("PRD-001"),
      title: "Journey",
      users: ["Test author"],
      activities: ["Author spec", "Run tests"],
      steps: [{ activity: "Author spec", step: "Draft" }],
    };
    expect(storyMapReviewLines(state)).toEqual([
      "Title: Journey",
      "Product: PRD-001",
      "Users: Test author",
      "Activities: Author spec → Run tests",
      "Steps: Author spec → Draft",
      "Slices: Walking skeleton, Next, Later",
    ]);
  });

  it("projects builder state to the create request (no cards yet)", () => {
    const state = {
      ...initialStoryMapBuilderState("PRD-000"),
      title: "Journey",
      users: ["Author"],
      activities: ["Author spec"],
      steps: [{ activity: "Author spec", step: "Draft" }],
      slices: ["Walking skeleton"],
    };
    expect(toCreateStoryMapRequest(state)).toEqual({
      title: "Journey",
      product: "PRD-000",
      users: ["Author"],
      activities: ["Author spec"],
      steps: [{ activity: "Author spec", step: "Draft" }],
      slices: ["Walking skeleton"],
    });
  });
});
