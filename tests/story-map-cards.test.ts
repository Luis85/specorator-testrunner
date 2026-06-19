import { describe, expect, it } from "vitest";
import {
  addCardToList,
  removeCardFromList,
  updateCardInList,
  validateCardPlacement,
} from "../src/application/services/story-map-cards";
import type { StoryMap, StoryMapCard } from "../src/domain/entities/story-map";

const card = (overrides: Partial<StoryMapCard> = {}): StoryMapCard => ({
  title: "A card",
  activity: "Author spec",
  slice: "Walking skeleton",
  tags: [],
  ...overrides,
});

const map: Pick<StoryMap, "activities" | "slices" | "steps"> = {
  activities: ["Author spec", "Run tests"],
  slices: ["Walking skeleton", "Next"],
  steps: [{ activity: "Author spec", step: "Draft" }],
};

describe("addCardToList / updateCardInList / removeCardFromList", () => {
  it("appends without mutating the source array", () => {
    const original: StoryMapCard[] = [card({ title: "One" })];
    const next = addCardToList(original, card({ title: "Two" }));
    expect(next.map((c) => c.title)).toEqual(["One", "Two"]);
    expect(original).toHaveLength(1);
    expect(next).not.toBe(original);
  });

  it("replaces the card at the index, leaving siblings untouched", () => {
    const list = [card({ title: "One" }), card({ title: "Two" })];
    const next = updateCardInList(list, 1, card({ title: "Two-edited" }));
    expect(next.map((c) => c.title)).toEqual(["One", "Two-edited"]);
    expect(list[1].title).toBe("Two");
  });

  it("update is a no-op for an out-of-range index (service rejects it)", () => {
    const list = [card({ title: "One" })];
    expect(updateCardInList(list, 5, card({ title: "X" })).map((c) => c.title)).toEqual(["One"]);
  });

  it("removes the card at the index and is a no-op out of range", () => {
    const list = [card({ title: "One" }), card({ title: "Two" })];
    expect(removeCardFromList(list, 0).map((c) => c.title)).toEqual(["Two"]);
    expect(removeCardFromList(list, 9)).toHaveLength(2);
  });
});

describe("validateCardPlacement", () => {
  it("accepts a well-placed card", () => {
    expect(validateCardPlacement(map, card({ ref: "UC-001" }))).toBeNull();
    expect(validateCardPlacement(map, card({ step: "Draft" }))).toBeNull();
  });

  it("rejects an activity not on the backbone", () => {
    expect(validateCardPlacement(map, card({ activity: "Nope" }))).toMatch(/backbone/);
  });

  it("rejects a slice not in the release slices", () => {
    expect(validateCardPlacement(map, card({ slice: "Later" }))).toMatch(/release slices/);
  });

  it("rejects a step not declared for the activity", () => {
    expect(validateCardPlacement(map, card({ step: "Review" }))).toMatch(/declared step/);
    // A step valid for another activity is still rejected under this one.
    expect(validateCardPlacement(map, card({ activity: "Run tests", step: "Draft" }))).toMatch(
      /declared step/,
    );
  });

  it("rejects a reference-less card with no title", () => {
    expect(validateCardPlacement(map, card({ title: "   " }))).toMatch(/needs a title/);
  });

  it("accepts a reference-less card that has a title", () => {
    expect(validateCardPlacement(map, card({ title: "Spike" }))).toBeNull();
  });

  it("rejects non-integer or negative points", () => {
    expect(validateCardPlacement(map, card({ points: 2.5 }))).toMatch(/whole number/);
    expect(validateCardPlacement(map, card({ points: -1 }))).toMatch(/negative/);
    expect(validateCardPlacement(map, card({ points: 0 }))).toBeNull();
  });

  it("rejects a ref that is not a canonical UC-NNN id", () => {
    // Shorthand (un-padded) ids never resolve to a generated note.
    expect(validateCardPlacement(map, card({ ref: "UC-37" }))).toMatch(/not a valid Use Case id/);
    // A wikilink-injection payload must not pass as a reference.
    expect(validateCardPlacement(map, card({ ref: "UC-001]] ![[Other" }))).toMatch(
      /not a valid Use Case id/,
    );
    expect(validateCardPlacement(map, card({ ref: "nope" }))).toMatch(/not a valid Use Case id/);
  });

  it("accepts canonical UC-NNN refs, including ids past 999", () => {
    expect(validateCardPlacement(map, card({ ref: "UC-001" }))).toBeNull();
    expect(validateCardPlacement(map, card({ ref: "UC-1000" }))).toBeNull();
  });

  it("rejects a `|` or newline in any free-text field", () => {
    expect(validateCardPlacement(map, card({ title: "a | b" }))).toMatch(/cannot contain/);
    expect(validateCardPlacement(map, card({ ref: "UC|1" }))).toMatch(/cannot contain/);
    expect(validateCardPlacement(map, card({ color: "blue\nred" }))).toMatch(/cannot contain/);
    expect(validateCardPlacement(map, card({ tags: ["ok", "bad|tag"] }))).toMatch(/cannot contain/);
  });
});
