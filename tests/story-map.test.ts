import { describe, expect, it } from "vitest";
import {
  buildStoryMapGrid,
  encodeCard,
  isStoryMapStatus,
  parseCard,
  type StoryMap,
} from "../src/domain/entities/story-map";

describe("isStoryMapStatus", () => {
  it("accepts the known statuses and rejects everything else", () => {
    expect(isStoryMapStatus("draft")).toBe(true);
    expect(isStoryMapStatus("active")).toBe(true);
    expect(isStoryMapStatus("deprecated")).toBe(true);
    expect(isStoryMapStatus("archived")).toBe(false);
    expect(isStoryMapStatus(42)).toBe(false);
  });
});

describe("encodeCard / parseCard", () => {
  it("round-trips a card through the parser-safe string encoding", () => {
    const encoded = encodeCard({
      ucId: "UC-013",
      activity: "Configure SUT",
      slice: "Walking skeleton",
    });
    expect(encoded).toBe("UC-013 | Configure SUT | Walking skeleton");
    expect(parseCard(encoded)).toEqual({
      ucId: "UC-013",
      activity: "Configure SUT",
      slice: "Walking skeleton",
    });
  });

  it("returns null for malformed encodings", () => {
    expect(parseCard("UC-013 | only-two")).toBeNull();
    expect(parseCard("UC-013 |  | slice")).toBeNull();
    expect(parseCard("")).toBeNull();
  });
});

describe("buildStoryMapGrid", () => {
  const map: Pick<StoryMap, "activities" | "slices" | "cards"> = {
    activities: ["Author spec", "Run tests"],
    slices: ["Walking skeleton", "Next"],
    cards: [
      { ucId: "UC-037", activity: "Author spec", slice: "Walking skeleton" },
      { ucId: "UC-011", activity: "Run tests", slice: "Walking skeleton" },
      { ucId: "UC-035", activity: "Author spec", slice: "Next" },
      // A card whose activity isn't on the backbone is dropped from the grid.
      { ucId: "UC-099", activity: "Unknown", slice: "Next" },
    ],
  };

  it("places cards at their (activity, slice) coordinate in order", () => {
    const grid = buildStoryMapGrid(map);
    expect(grid.activities).toEqual(["Author spec", "Run tests"]);
    expect(grid.rows).toHaveLength(2);

    const skeleton = grid.rows[0];
    expect(skeleton.slice).toBe("Walking skeleton");
    expect(skeleton.cells[0]).toEqual({ activity: "Author spec", ucIds: ["UC-037"] });
    expect(skeleton.cells[1]).toEqual({ activity: "Run tests", ucIds: ["UC-011"] });

    const next = grid.rows[1];
    expect(next.cells[0].ucIds).toEqual(["UC-035"]);
    expect(next.cells[1].ucIds).toEqual([]);
  });

  it("drops cards whose activity or slice is not in the ordered lists", () => {
    const grid = buildStoryMapGrid(map);
    const placed = grid.rows.flatMap((r) => r.cells.flatMap((c) => c.ucIds));
    expect(placed).not.toContain("UC-099");
  });
});
