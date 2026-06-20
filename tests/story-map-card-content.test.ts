import { describe, it, expect } from "vitest";
import {
  buildCardNote,
  parseCardNote,
  cardFileName,
} from "../src/application/content/story-map-card-content";
import type { StoryMapCardNote } from "../src/domain/entities/story-map-card";

const card: StoryMapCardNote = {
  id: "SMC-001",
  map: "SM-001",
  cardType: "task",
  ref: "UC-003",
  status: "planned",
  points: 3,
  tags: ["frontend"],
  color: undefined,
  activity: "Find & Cook",
  step: "Browse",
  slice: "MVP",
  order: 0,
  title: "Search by name",
  body: "",
  path: "Story Maps/SM-001-x/cards/SMC-001.md" as StoryMapCardNote["path"],
};

describe("card note content", () => {
  it("round-trips through build/parse", () => {
    const parsed = parseCardNote(buildCardNote(card), card.path);
    expect(parsed).toEqual(card);
  });
  it("omits empty optionals from frontmatter", () => {
    const note = buildCardNote({
      ...card,
      ref: undefined,
      points: undefined,
      status: undefined,
      tags: [],
    });
    expect(note).not.toContain("ref:");
    expect(note).not.toContain("points:");
    expect(note).not.toContain("tags:");
  });
  it("rejects a non-card note and falls back an out-of-set card_type", () => {
    expect(parseCardNote("---\ntype: note\n---\n", card.path)).toBeNull();
    const bad = buildCardNote(card).replace("card_type: task", "card_type: epic");
    expect(parseCardNote(bad, card.path)?.cardType).toBe("task");
  });
  it("rejects fractional points (drops to undefined)", () => {
    const frac = buildCardNote(card).replace("points: 3", "points: 2.5");
    expect(parseCardNote(frac, card.path)?.points).toBeUndefined();
  });
  it("parses a tagless card as empty tags, not [undefined]", () => {
    // buildCardNote omits the tags field when empty, so parseNote leaves it
    // undefined; the parser must coerce that to [] rather than a bogus tag.
    const note = buildCardNote({ ...card, tags: [] });
    expect(note).not.toContain("tags:");
    expect(parseCardNote(note, card.path)?.tags).toEqual([]);
  });
  it("names the file by stable id", () => {
    expect(cardFileName("SMC-001")).toBe("SMC-001.md");
  });
});
