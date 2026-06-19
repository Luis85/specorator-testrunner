import { describe, expect, it } from "vitest";
import { projectCardManagerRows } from "../src/presentation/views/story-map-card-rows";
import type { StoryMapCard } from "../src/domain/entities/story-map";

describe("projectCardManagerRows", () => {
  it("projects index, title, coordinate, and attributes", () => {
    const cards: StoryMapCard[] = [
      {
        ref: "UC-037",
        title: "Author a UC",
        activity: "Author spec",
        step: "Draft",
        slice: "Walking skeleton",
        status: "planned",
        points: 3,
        tags: ["auth"],
      },
    ];
    expect(projectCardManagerRows(cards)).toEqual([
      {
        index: 0,
        title: "Author a UC",
        coordinate: "Author spec › Draft › Walking skeleton",
        attributes: "UC-037 · planned · 3pts · #auth",
      },
    ]);
  });

  it("omits the step from the coordinate when there is none", () => {
    const cards: StoryMapCard[] = [
      { title: "Stepless", activity: "Run tests", slice: "Next", tags: [] },
    ];
    const [row] = projectCardManagerRows(cards);
    expect(row.coordinate).toBe("Run tests › Next");
    expect(row.attributes).toBe("");
  });

  it("falls back to the ref then a placeholder when the title is blank", () => {
    const cards: StoryMapCard[] = [
      { ref: "UC-009", title: "   ", activity: "A", slice: "S", tags: [] },
    ];
    expect(projectCardManagerRows(cards)[0].title).toBe("UC-009");
  });

  it("preserves each card's index for the second card", () => {
    const cards: StoryMapCard[] = [
      { title: "One", activity: "A", slice: "S", tags: [] },
      { title: "Two", activity: "A", slice: "S", tags: [] },
    ];
    expect(projectCardManagerRows(cards)[1].index).toBe(1);
  });
});
