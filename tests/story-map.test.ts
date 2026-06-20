import { describe, expect, it } from "vitest";
import {
  addActivity,
  addCard,
  addSlice,
  addStepTo,
  addUser,
  buildStoryMapGrid,
  CARD_STATUSES,
  editCardPoints,
  editCardStatus,
  editCardTitle,
  encodeCard,
  encodeStep,
  isCardStatus,
  recolorCard,
  isStoryMapStatus,
  moveCard,
  removeActivity,
  removeCard,
  removeSlice,
  removeStep,
  removeUser,
  renameActivity,
  renameSlice,
  renameStep,
  renameUser,
  reorderActivity,
  reorderCardInCell,
  reorderSlice,
  reorderStep,
  normalizeLabels,
  normalizeSteps,
  parseCard,
  parseStep,
  storyMapSignature,
  type StoryMap,
  type StoryMapCard,
} from "../src/domain/entities/story-map";
import { unsafeVaultPath } from "../src/domain/value-objects/vault-path";

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

describe("normalizeLabels / normalizeSteps", () => {
  it("collapses whitespace/pipes, drops blanks, and dedupes labels (order preserved)", () => {
    expect(normalizeLabels(["  Sign  in ", "a|b", "Sign in", "", "  "])).toEqual([
      "Sign in",
      "a b",
    ]);
    expect(normalizeLabels(undefined)).toEqual([]);
  });

  it("normalizes steps, drops off-backbone, and dedupes by (activity, step)", () => {
    const steps = normalizeSteps(
      [
        { activity: "Author  spec", step: " Draft " },
        { activity: "Author spec", step: "Draft" }, // duplicate after normalization
        { activity: "Unknown", step: "x" }, // off-backbone
      ],
      ["Author spec"],
    );
    expect(steps).toEqual([{ activity: "Author spec", step: "Draft" }]);
  });
});

describe("encodeCard / parseCard (rich)", () => {
  it("collapses interior whitespace in coordinates so a card matches its axis label", () => {
    const card = parseCard("UC-001 | Sign  in |  | Walking  skeleton |  |  |  |  | T");
    expect(card?.activity).toBe("Sign in");
    expect(card?.slice).toBe("Walking skeleton");
  });

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

  it("drops a non-canonical rich ref (keeps the card as reference-less)", () => {
    // Shorthand `UC-37` and an injection payload both fail the UC-id format;
    // the card survives on its own title with NO ref (so the renderer can't
    // wrap a dangling/injected `[[…]]` link).
    const shorthand = parseCard("UC-37 | A | s | Sl |  |  |  |  | Real title");
    expect(shorthand).toMatchObject({ title: "Real title", activity: "A", slice: "Sl" });
    expect(shorthand?.ref).toBeUndefined();
    const injection = parseCard("UC-001]] ![[Other | A | s | Sl |  |  |  |  | T");
    expect(injection?.ref).toBeUndefined();
    expect(injection?.title).toBe("T");
  });

  it("drops a rich card whose only identity is an invalid ref (no title)", () => {
    // No title to fall back to, and the bad ref must not become the title.
    expect(parseCard("UC-37 | A | s | Sl |  |  |  |  | ")).toBeNull();
    expect(parseCard("UC-001]] ![[Other | A | s | Sl |  |  |  |  | ")).toBeNull();
  });

  it("drops a legacy 3-field card with a non-canonical ref", () => {
    expect(parseCard("UC-37 | Configure SUT | Walking skeleton")).toBeNull();
    expect(parseCard("UC-001]] ![[Other | Configure SUT | Walking skeleton")).toBeNull();
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
    // Too many fields: a stray `|` in a field — reject, don't truncate/shift.
    expect(parseCard("UC-001 | A | s | Sl |  |  |  |  | Title | extra")).toBeNull();
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

describe("moveCard", () => {
  const baseMap = (): StoryMap => ({
    id: "SM-001",
    title: "J",
    status: "draft",
    product: "PRD-000",
    users: [],
    activities: ["Browse", "Order"],
    steps: [{ activity: "Browse", step: "Filter" }],
    slices: ["Walking skeleton", "Next"],
    cards: [
      { title: "A", activity: "Browse", step: "Filter", slice: "Walking skeleton", tags: [] },
      { title: "B", activity: "Browse", step: "Filter", slice: "Walking skeleton", tags: [] },
      { title: "C", activity: "Order", slice: "Next", tags: [] },
    ],
    displayOrder: 0,
    path: unsafeVaultPath("Story Maps/SM-001/SM-001.md"),
  });

  it("moves a card to a new (activity, slice) cell, dropping the step when none given", () => {
    const next = moveCard(baseMap(), 0, { activity: "Order", slice: "Next" });
    expect(next.cards[2]).toMatchObject({ title: "A", activity: "Order", slice: "Next" });
    expect(next.cards[2].step).toBeUndefined();
    // Source array is untouched.
    expect(baseMap().cards[0].activity).toBe("Browse");
  });

  it("places the moved card at indexInCell among the destination cell's cards", () => {
    // Move C (index 2) into Browse/Filter/Walking skeleton at position 1 (between A and B).
    const next = moveCard(
      baseMap(),
      2,
      { activity: "Browse", step: "Filter", slice: "Walking skeleton" },
      1,
    );
    const cell = next.cards.filter(
      (c) => c.activity === "Browse" && c.step === "Filter" && c.slice === "Walking skeleton",
    );
    expect(cell.map((c) => c.title)).toEqual(["A", "C", "B"]);
  });

  it("appends to the destination cell when indexInCell is omitted", () => {
    const next = moveCard(baseMap(), 2, {
      activity: "Browse",
      step: "Filter",
      slice: "Walking skeleton",
    });
    const cell = next.cards.filter(
      (c) => c.activity === "Browse" && c.step === "Filter" && c.slice === "Walking skeleton",
    );
    expect(cell.map((c) => c.title)).toEqual(["A", "B", "C"]);
  });

  it("places the card as the sole occupant of an empty destination cell", () => {
    // Order / Walking skeleton has no cards in baseMap → the insert-at-end branch.
    const next = moveCard(baseMap(), 0, { activity: "Order", slice: "Walking skeleton" });
    const cell = next.cards.filter(
      (c) => c.activity === "Order" && c.step === undefined && c.slice === "Walking skeleton",
    );
    expect(cell.map((c) => c.title)).toEqual(["A"]);
  });

  it("returns the map unchanged for an out-of-range index", () => {
    const map = baseMap();
    expect(moveCard(map, 9, { activity: "Order", slice: "Next" })).toBe(map);
  });
});

describe("reorderCardInCell", () => {
  const map = (): StoryMap => ({
    id: "SM-001",
    title: "J",
    status: "draft",
    product: "PRD-000",
    users: [],
    activities: ["Browse"],
    steps: [],
    slices: ["Walking skeleton"],
    cards: [
      { title: "A", activity: "Browse", slice: "Walking skeleton", tags: [] },
      { title: "B", activity: "Browse", slice: "Walking skeleton", tags: [] },
      { title: "C", activity: "Browse", slice: "Walking skeleton", tags: [] },
    ],
    displayOrder: 0,
    path: unsafeVaultPath("Story Maps/SM-001/SM-001.md"),
  });

  it("moves a card to a new position within its own cell", () => {
    // Move C (index 2) to the front of the cell.
    const next = reorderCardInCell(map(), 2, 0);
    expect(next.cards.map((c) => c.title)).toEqual(["C", "A", "B"]);
  });

  it("is a no-op for an out-of-range index", () => {
    const m = map();
    expect(reorderCardInCell(m, 9, 0)).toBe(m);
  });
});

describe("reorderActivity / reorderSlice", () => {
  const map = (): StoryMap => ({
    id: "SM-001",
    title: "J",
    status: "draft",
    product: "PRD-000",
    users: [],
    activities: ["Browse", "Order", "Pay"],
    steps: [{ activity: "Browse", step: "Filter" }],
    slices: ["Walking skeleton", "Next", "Later"],
    cards: [{ title: "A", activity: "Order", slice: "Next", tags: [] }],
    displayOrder: 0,
    path: unsafeVaultPath("Story Maps/SM-001/SM-001.md"),
  });

  it("moves an activity to a new position, leaving cards' labels intact", () => {
    const next = reorderActivity(map(), 2, 0); // Pay → front
    expect(next.activities).toEqual(["Pay", "Browse", "Order"]);
    expect(next.cards[0].activity).toBe("Order"); // card still references its label
  });

  it("moves a slice to a new position", () => {
    expect(reorderSlice(map(), 0, 2).slices).toEqual(["Next", "Later", "Walking skeleton"]);
  });

  it("returns the same map reference for a no-op (equal or out-of-range index)", () => {
    const m = map();
    expect(reorderActivity(m, 1, 1)).toBe(m);
    expect(reorderActivity(m, 9, 0)).toBe(m);
    expect(reorderSlice(m, 0, 9)).toBe(m);
  });
});

describe("storyMapSignature", () => {
  const base: StoryMap = {
    id: "SM-001",
    title: "J",
    status: "draft",
    product: "PRD-000",
    users: ["U"],
    activities: ["Browse", "Order"],
    steps: [{ activity: "Browse", step: "Filter" }],
    slices: ["Walking skeleton"],
    cards: [{ title: "A", activity: "Browse", slice: "Walking skeleton", tags: [] }],
    displayOrder: 0,
    path: unsafeVaultPath("Story Maps/SM-001/SM-001.md"),
  };

  it("is stable for the same structure and changes when structure changes", () => {
    expect(storyMapSignature(base)).toBe(storyMapSignature({ ...base }));
    expect(storyMapSignature(base)).not.toBe(
      storyMapSignature({ ...base, activities: ["Order", "Browse"] }),
    );
    expect(storyMapSignature(base)).not.toBe(
      storyMapSignature({ ...base, slices: ["Walking skeleton", "Next"] }),
    );
  });

  it("ignores non-structural fields (title/status/displayOrder/path)", () => {
    expect(storyMapSignature(base)).toBe(
      storyMapSignature({ ...base, title: "Renamed", status: "active", displayOrder: 9 }),
    );
  });
});

describe("addActivity / addSlice / addStepTo", () => {
  const map = (over: Partial<StoryMap> = {}): StoryMap => ({
    id: "SM-001",
    title: "J",
    status: "draft",
    product: "PRD-000",
    users: [],
    activities: ["Browse"],
    steps: [{ activity: "Browse", step: "Filter" }],
    slices: ["Walking skeleton"],
    cards: [],
    displayOrder: 0,
    path: unsafeVaultPath("Story Maps/SM-001/SM-001.md"),
    ...over,
  });

  it("appends a uniquely-named placeholder activity / slice", () => {
    expect(addActivity(map()).activities).toEqual(["Browse", "New activity"]);
    expect(addActivity(map({ activities: ["Browse", "New activity"] })).activities).toEqual([
      "Browse",
      "New activity",
      "New activity 2",
    ]);
    expect(addSlice(map()).slices).toEqual(["Walking skeleton", "New slice"]);
  });

  it("appends a uniquely-named placeholder step under an existing activity", () => {
    const next = addStepTo(map(), "Browse");
    expect(next?.steps).toEqual([
      { activity: "Browse", step: "Filter" },
      { activity: "Browse", step: "New step" },
    ]);
  });

  it("returns null when adding a step to an unknown activity", () => {
    expect(addStepTo(map(), "Nope")).toBeNull();
  });
});

describe("renameActivity / renameSlice / renameStep", () => {
  const map = (): StoryMap => ({
    id: "SM-001",
    title: "J",
    status: "draft",
    product: "PRD-000",
    users: [],
    activities: ["Browse", "Order"],
    steps: [{ activity: "Browse", step: "Filter" }],
    slices: ["Walking skeleton", "Next"],
    cards: [
      { title: "A", activity: "Browse", step: "Filter", slice: "Walking skeleton", tags: [] },
    ],
    displayOrder: 0,
    path: unsafeVaultPath("Story Maps/SM-001/SM-001.md"),
  });

  it("renames an activity and rewrites its steps + cards", () => {
    const next = renameActivity(map(), 0, "Discover");
    expect(next?.activities).toEqual(["Discover", "Order"]);
    expect(next?.steps).toEqual([{ activity: "Discover", step: "Filter" }]);
    expect(next?.cards[0].activity).toBe("Discover");
  });

  it("renames a slice and rewrites its cards", () => {
    const next = renameSlice(map(), 0, "Skeleton");
    expect(next?.slices).toEqual(["Skeleton", "Next"]);
    expect(next?.cards[0].slice).toBe("Skeleton");
  });

  it("renames a step and rewrites its cards (within the activity)", () => {
    const next = renameStep(map(), "Browse", "Filter", "Sort");
    expect(next?.steps).toEqual([{ activity: "Browse", step: "Sort" }]);
    expect(next?.cards[0].step).toBe("Sort");
  });

  it("rejects a blank or duplicate rename, and no-ops an unchanged one", () => {
    expect(renameActivity(map(), 0, "  ")).toBeNull();
    expect(renameActivity(map(), 0, "Order")).toBeNull(); // dup
    const m = map();
    expect(renameActivity(m, 0, "Browse")).toBe(m); // unchanged → same reference
    expect(renameSlice(map(), 0, "Next")).toBeNull();
    expect(renameStep(map(), "Browse", "Filter", "Filter")).toEqual(map()); // unchanged
  });
});

describe("removeActivity / removeSlice", () => {
  const base: StoryMap = {
    id: "SM-001",
    title: "J",
    status: "draft",
    product: "PRD-000",
    users: [],
    activities: ["Browse", "Buy"],
    steps: [{ activity: "Browse", step: "Search" }],
    slices: ["MVP", "Later"],
    cards: [{ title: "C", activity: "Buy", slice: "MVP", tags: [] }],
    displayOrder: 0,
    path: unsafeVaultPath("Story Maps/SM-001/SM-001.md"),
  };

  it("removes an activity with no cards, dropping its steps", () => {
    const next = removeActivity(base, 0); // Browse has steps but no cards
    expect(next).not.toBeNull();
    expect(next?.activities).toEqual(["Buy"]);
    expect(next?.steps).toEqual([]);
  });

  it("rejects (null) removing an activity that has cards", () => {
    expect(removeActivity(base, 1)).toBeNull(); // Buy has a card
  });

  it("rejects an out-of-range activity index", () => {
    expect(removeActivity(base, 9)).toBeNull();
  });

  it("removes an unreferenced slice and rejects a referenced one", () => {
    expect(removeSlice(base, 1)?.slices).toEqual(["MVP"]); // Later has no cards
    expect(removeSlice(base, 0)).toBeNull(); // MVP has a card
    expect(removeSlice(base, 9)).toBeNull();
  });
});

describe("addUser / renameUser / removeUser", () => {
  const map = (over: Partial<StoryMap> = {}): StoryMap => ({
    id: "SM-001",
    title: "J",
    status: "draft",
    product: "PRD-000",
    users: ["Customer", "Admin"],
    activities: ["Browse"],
    steps: [],
    slices: ["Walking skeleton"],
    cards: [],
    displayOrder: 0,
    path: unsafeVaultPath("Story Maps/SM-001/SM-001.md"),
    ...over,
  });

  it("appends a uniquely-named placeholder user", () => {
    expect(addUser(map({ users: [] })).users).toEqual(["New user"]);
    expect(addUser(map({ users: ["New user"] })).users).toEqual(["New user", "New user 2"]);
  });

  it("renames a user at an index", () => {
    expect(renameUser(map(), 0, "Buyer")?.users).toEqual(["Buyer", "Admin"]);
  });

  it("no-ops (same ref) an unchanged rename", () => {
    const m = map();
    expect(renameUser(m, 0, "Customer")).toBe(m);
  });

  it("rejects a blank, a duplicate, and an out-of-range rename", () => {
    expect(renameUser(map(), 0, "  ")).toBeNull();
    expect(renameUser(map(), 0, "Admin")).toBeNull(); // dup of another user
    expect(renameUser(map(), 9, "Buyer")).toBeNull();
  });

  it("removes a user at an index and no-ops (same ref) out of range", () => {
    expect(removeUser(map(), 0).users).toEqual(["Admin"]);
    const m = map();
    expect(removeUser(m, 9)).toBe(m);
  });
});

describe("removeStep / reorderStep", () => {
  const base: StoryMap = {
    id: "SM-001",
    title: "J",
    status: "draft",
    product: "PRD-000",
    users: [],
    activities: ["Browse"],
    steps: [
      { activity: "Browse", step: "Search" },
      { activity: "Browse", step: "Filter" },
    ],
    slices: ["MVP"],
    cards: [{ title: "C", activity: "Browse", step: "Search", slice: "MVP", tags: [] }],
    displayOrder: 0,
    path: unsafeVaultPath("Story Maps/SM-001/SM-001.md"),
  };

  it("removes a step and degrades its cards to no-step", () => {
    const next = removeStep(base, "Browse", "Search");
    expect(next?.steps).toEqual([{ activity: "Browse", step: "Filter" }]);
    expect(next?.cards[0].step).toBeUndefined(); // card now hangs under the activity
  });

  it("returns null when the step does not exist", () => {
    expect(removeStep(base, "Browse", "Nope")).toBeNull();
  });

  it("reorders a step within its activity by label", () => {
    const next = reorderStep(base, "Browse", "Filter", "Search"); // Filter before Search
    expect(next?.steps.map((s) => s.step)).toEqual(["Filter", "Search"]);
  });

  it("no-ops (same ref) when from===to and null on an unknown step", () => {
    expect(reorderStep(base, "Browse", "Search", "Search")).toBe(base);
    expect(reorderStep(base, "Browse", "Search", "Ghost")).toBeNull();
  });
});

describe("addCard / removeCard", () => {
  const base: StoryMap = {
    id: "SM-001",
    title: "J",
    status: "draft",
    product: "PRD-000",
    users: [],
    activities: ["Browse"],
    steps: [{ activity: "Browse", step: "Search" }],
    slices: ["MVP"],
    cards: [{ title: "Existing", activity: "Browse", slice: "MVP", tags: [] }],
    displayOrder: 0,
    path: unsafeVaultPath("Story Maps/SM-001/SM-001.md"),
  };

  it("appends a placeholder card in the target cell (with step)", () => {
    const next = addCard(base, { activity: "Browse", step: "Search", slice: "MVP" });
    const added = next.cards[next.cards.length - 1];
    expect(added).toMatchObject({
      title: "New card",
      activity: "Browse",
      step: "Search",
      slice: "MVP",
    });
    expect(added.tags).toEqual([]);
  });

  it("appends a no-step placeholder and uniquifies the title", () => {
    const once = addCard(base, { activity: "Browse", slice: "MVP" });
    const twice = addCard(once, { activity: "Browse", slice: "MVP" });
    expect(twice.cards[twice.cards.length - 1].title).toBe("New card 2");
    expect(twice.cards[twice.cards.length - 1].step).toBeUndefined();
  });

  it("no-ops (same ref) when the target axis is off the map", () => {
    expect(addCard(base, { activity: "Ghost", slice: "MVP" })).toBe(base);
    expect(addCard(base, { activity: "Browse", slice: "Ghost" })).toBe(base);
  });

  it("removes the card at an index and no-ops out of range", () => {
    expect(removeCard(base, 0).cards).toEqual([]);
    expect(removeCard(base, 9)).toBe(base);
  });
});

describe("card edits", () => {
  const base: StoryMap = {
    id: "SM-001",
    title: "J",
    status: "draft",
    product: "PRD-000",
    users: [],
    activities: ["Browse"],
    steps: [],
    slices: ["MVP"],
    cards: [{ title: "Old", activity: "Browse", slice: "MVP", tags: [] }],
    displayOrder: 0,
    path: unsafeVaultPath("Story Maps/SM-001/SM-001.md"),
  };

  it("editCardTitle renames a card, rejects blank, no-ops unchanged", () => {
    expect(editCardTitle(base, 0, "New title")?.cards[0].title).toBe("New title");
    expect(editCardTitle(base, 0, "  Old  ")).toBe(base); // cleanLabel-equal → no-op
    expect(editCardTitle(base, 0, "   ")).toBeNull(); // blank rejected
    expect(editCardTitle(base, 9, "x")).toBeNull(); // out of range
  });

  /** Narrows an op result to a non-null StoryMap (lint forbids `!` and `as`). */
  const ok = (map: StoryMap | null): StoryMap => {
    if (map === null) throw new Error("expected a non-null StoryMap");
    return map;
  };

  it("recolorCard sets and clears the color, no-ops unchanged", () => {
    expect(recolorCard(base, 0, "#f00")?.cards[0].color).toBe("#f00");
    const colored = ok(recolorCard(base, 0, "#f00"));
    expect(recolorCard(colored, 0, "")?.cards[0].color).toBeUndefined(); // "" clears
    expect(recolorCard(base, 0, "")).toBe(base); // already no color → no-op
    expect(recolorCard(base, 9, "#f00")).toBeNull();
  });

  it("editCardStatus sets a valid status, clears on '', rejects invalid", () => {
    expect(editCardStatus(base, 0, "done")?.cards[0].status).toBe("done");
    const done = ok(editCardStatus(base, 0, "done"));
    expect(editCardStatus(done, 0, "")?.cards[0].status).toBeUndefined();
    expect(editCardStatus(base, 0, "bogus")).toBeNull();
    expect(editCardStatus(base, 0, "")).toBe(base); // already none → no-op
  });

  it("editCardPoints sets a non-negative int, clears on '', rejects bad input", () => {
    expect(editCardPoints(base, 0, "5")?.cards[0].points).toBe(5);
    const five = ok(editCardPoints(base, 0, "5"));
    expect(editCardPoints(five, 0, "")?.cards[0].points).toBeUndefined();
    expect(editCardPoints(base, 0, "1.5")).toBeNull();
    expect(editCardPoints(base, 0, "-1")).toBeNull();
  });
});
