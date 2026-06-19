import { describe, expect, it } from "vitest";
import {
  buildStoryMapGrid,
  CARD_STATUSES,
  encodeCard,
  encodeStep,
  isCardStatus,
  isStoryMapStatus,
  parseCard,
  parseStep,
  type StoryMap,
  type StoryMapCard,
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

describe("isCardStatus", () => {
  it("accepts the four planning statuses and rejects everything else", () => {
    for (const status of CARD_STATUSES) expect(isCardStatus(status)).toBe(true);
    expect(isCardStatus("passing")).toBe(false);
    expect(isCardStatus(undefined)).toBe(false);
  });
});

describe("encodeStep / parseStep", () => {
  it("round-trips a step through the `activity | step` encoding", () => {
    const encoded = encodeStep({ activity: "Configure SUT", step: "Pick a browser" });
    expect(encoded).toBe("Configure SUT | Pick a browser");
    expect(parseStep(encoded)).toEqual({ activity: "Configure SUT", step: "Pick a browser" });
  });

  it("returns null unless there are exactly two non-empty parts", () => {
    expect(parseStep("only one")).toBeNull();
    expect(parseStep("a | ")).toBeNull();
    expect(parseStep(" | b")).toBeNull();
    expect(parseStep("a | b | c")).toBeNull();
  });
});

describe("encodeCard / parseCard (rich)", () => {
  it("round-trips a fully-populated rich card through the 9-field encoding", () => {
    const card: StoryMapCard = {
      ref: "UC-013",
      title: "Configure the SUT",
      activity: "Configure SUT",
      step: "Pick a browser",
      slice: "Walking skeleton",
      status: "in-progress",
      points: 3,
      tags: ["auth", "infra"],
      color: "blue",
    };
    const encoded = encodeCard(card);
    expect(encoded).toBe(
      "UC-013 | Configure SUT | Pick a browser | Walking skeleton | in-progress | 3 | auth,infra | blue | Configure the SUT",
    );
    expect(parseCard(encoded)).toEqual(card);
  });

  it("always emits nine fields and round-trips a sparse ref-only card", () => {
    const card: StoryMapCard = {
      ref: "UC-001",
      title: "UC-001",
      activity: "Author spec",
      slice: "Next",
      tags: [],
    };
    const encoded = encodeCard(card);
    expect(encoded.split("|")).toHaveLength(9);
    expect(parseCard(encoded)).toEqual(card);
  });

  it("parses a free-text (reference-less) card with no ref", () => {
    const encoded = encodeCard({
      title: "Spike: choose a parser",
      activity: "Author spec",
      slice: "Later",
      tags: ["spike"],
    });
    const parsed = parseCard(encoded);
    expect(parsed).toEqual({
      title: "Spike: choose a parser",
      activity: "Author spec",
      slice: "Later",
      tags: ["spike"],
    });
    expect(parsed?.ref).toBeUndefined();
  });

  it("keeps the LEGACY 3-field encoding parsing (ADR-0027 back-compat)", () => {
    const parsed = parseCard("UC-013 | Configure SUT | Walking skeleton");
    expect(parsed).toEqual({
      ref: "UC-013",
      title: "UC-013",
      activity: "Configure SUT",
      slice: "Walking skeleton",
      tags: [],
    });
  });

  it("falls back to the ref as the title when a rich ref card omits one", () => {
    const parsed = parseCard("UC-009 | Run tests |  | Next |  |  |  |  | ");
    expect(parsed?.title).toBe("UC-009");
  });

  it("drops invalid status, negative/NaN points, and empty tags", () => {
    const parsed = parseCard("UC-009 | A | s | Sl | nope | -2 | , a , | | T");
    expect(parsed?.status).toBeUndefined();
    expect(parsed?.points).toBeUndefined();
    expect(parsed?.tags).toEqual(["a"]);
  });

  it("drops a hand-edited fractional points value (1.5) instead of truncating to 1", () => {
    expect(parseCard("UC-009 | A | s | Sl |  | 1.5 |  |  | T")?.points).toBeUndefined();
  });

  it("returns null for malformed encodings", () => {
    // Empty activity / slice.
    expect(parseCard("UC-013 |  | Walking skeleton")).toBeNull();
    expect(parseCard("UC-013 | A |  | Sl |  |  |  |  | T".replace("| A |", "|  |"))).toBeNull();
    // A free-text card with neither ref nor title.
    expect(parseCard(" | A |  | Sl |  |  |  |  | ")).toBeNull();
    // Too few fields.
    expect(parseCard("only-two | x")).toBeNull();
    expect(parseCard("")).toBeNull();
  });
});

describe("buildStoryMapGrid", () => {
  const map: Pick<StoryMap, "activities" | "steps" | "slices" | "cards"> = {
    activities: ["Author spec", "Run tests"],
    steps: [
      { activity: "Author spec", step: "Draft" },
      { activity: "Author spec", step: "Review" },
      // "Run tests" has no declared steps → a single no-step column.
    ],
    slices: ["Walking skeleton", "Next"],
    cards: [
      {
        ref: "UC-037",
        title: "UC-037",
        activity: "Author spec",
        step: "Draft",
        slice: "Walking skeleton",
        points: 2,
        tags: [],
      },
      {
        ref: "UC-011",
        title: "UC-011",
        activity: "Run tests",
        slice: "Walking skeleton",
        points: 5,
        tags: [],
      },
      {
        ref: "UC-035",
        title: "UC-035",
        activity: "Author spec",
        step: "Review",
        slice: "Next",
        points: 3,
        tags: [],
      },
      // A card whose activity isn't on the backbone is dropped from the grid,
      // but its points still count toward the slice roll-up.
      { ref: "UC-099", title: "UC-099", activity: "Unknown", slice: "Next", points: 8, tags: [] },
    ],
  };

  it("builds leaf columns per declared step, with a no-step column for stepless activities", () => {
    const grid = buildStoryMapGrid(map);
    expect(grid.columns).toEqual([
      { activity: "Author spec", step: "Draft" },
      { activity: "Author spec", step: "Review" },
      { activity: "Run tests" },
    ]);
  });

  it("keeps a no-step card visible under a stepped activity (adds a no-step column)", () => {
    const withNoStepCard: typeof map = {
      ...map,
      cards: [
        ...map.cards,
        // A card hanging directly under the stepped "Author spec" activity.
        { ref: "UC-050", title: "Direct", activity: "Author spec", slice: "Next", tags: [] },
      ],
    };
    const grid = buildStoryMapGrid(withNoStepCard);
    // "Author spec" now has a trailing no-step column in addition to its steps.
    expect(grid.columns).toContainEqual({ activity: "Author spec" });
    const placed = grid.rows.flatMap((r) =>
      r.cells.flatMap((c) => c.cards.map((card) => card.ref)),
    );
    expect(placed).toContain("UC-050");
  });

  it("places cards at their (activity, step, slice) coordinate in order", () => {
    const grid = buildStoryMapGrid(map);
    const skeleton = grid.rows[0];
    expect(skeleton.slice).toBe("Walking skeleton");
    expect(skeleton.cells[0].cards.map((c) => c.ref)).toEqual(["UC-037"]);
    expect(skeleton.cells[1].cards).toEqual([]);
    expect(skeleton.cells[2].cards.map((c) => c.ref)).toEqual(["UC-011"]);

    const next = grid.rows[1];
    expect(next.cells[1].cards.map((c) => c.ref)).toEqual(["UC-035"]);
  });

  it("rolls up points per slice over ALL cards (even dropped ones)", () => {
    const grid = buildStoryMapGrid(map);
    expect(grid.rows[0].points).toBe(7); // 2 + 5
    expect(grid.rows[1].points).toBe(11); // 3 + 8 (UC-099 dropped from grid, counted here)
  });

  it("drops cards whose (activity, step) match no column", () => {
    const grid = buildStoryMapGrid(map);
    const placed = grid.rows.flatMap((r) =>
      r.cells.flatMap((c) => c.cards.map((card) => card.ref)),
    );
    expect(placed).not.toContain("UC-099");
  });
});
