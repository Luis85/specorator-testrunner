import { describe, expect, it } from "vitest";
import {
  addLabel,
  DEFAULT_SLICES,
  initialStoryMapBuilderState,
  pickProductAnchor,
  removeLabelAt,
  storyMapBuilderStepTitle,
  storyMapReviewLines,
  toCreateStoryMapRequest,
} from "../src/application/services/story-map-builder";

describe("storyMapBuilderStepTitle", () => {
  it("labels each step", () => {
    expect(storyMapBuilderStepTitle(1)).toBe("Title & product");
    expect(storyMapBuilderStepTitle(2)).toBe("Backbone (activities)");
    expect(storyMapBuilderStepTitle(3)).toBe("Release slices");
    expect(storyMapBuilderStepTitle(4)).toBe("Review");
    expect(storyMapBuilderStepTitle(9)).toBe("Unknown step");
  });
});

describe("initialStoryMapBuilderState", () => {
  it("starts on step 1 with the default slices and product anchor", () => {
    const state = initialStoryMapBuilderState();
    expect(state.currentStep).toBe(1);
    expect(state.product).toBe("PRD-000");
    expect(state.slices).toEqual([...DEFAULT_SLICES]);
    expect(state.activities).toEqual([]);
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
    // A pipe (the card delimiter) is collapsed to a space, not stored literally.
    expect(addLabel([], "a | b")).toEqual(["a b"]);
  });

  it("removes the label at an index (out-of-range is a no-op)", () => {
    expect(removeLabelAt(["a", "b", "c"], 1)).toEqual(["a", "c"]);
    expect(removeLabelAt(["a"], 9)).toEqual(["a"]);
  });
});

describe("storyMapReviewLines / toCreateStoryMapRequest", () => {
  it("summarizes the collected state for review", () => {
    const state = {
      ...initialStoryMapBuilderState("PRD-001"),
      title: "Journey",
      activities: ["Author spec", "Run tests"],
    };
    expect(storyMapReviewLines(state)).toEqual([
      "Title: Journey",
      "Product: PRD-001",
      "Activities: Author spec → Run tests",
      "Slices: Walking skeleton, Next, Later",
    ]);
  });

  it("projects builder state to the create request (no cards yet)", () => {
    const state = {
      ...initialStoryMapBuilderState("PRD-000"),
      title: "Journey",
      activities: ["Author spec"],
      slices: ["Walking skeleton"],
    };
    expect(toCreateStoryMapRequest(state)).toEqual({
      title: "Journey",
      product: "PRD-000",
      activities: ["Author spec"],
      slices: ["Walking skeleton"],
    });
  });
});
