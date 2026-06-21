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
  it("falls back a referenced card's blank title to its UC ref, never the note id", () => {
    const note = buildCardNote({ ...card, title: "" }); // ref UC-003, no title
    const parsed = parseCardNote(note, card.path);
    expect(parsed?.title).toBe("UC-003");
  });
  it("falls back a reference-less blank title to the note id (last resort)", () => {
    const note = buildCardNote({ ...card, ref: undefined, title: "" });
    expect(parseCardNote(note, card.path)?.title).toBe("SMC-001");
  });
  it("writes a meaningful heading (the UC ref) for a referenced card with no title", () => {
    const note = buildCardNote({ ...card, title: "" }); // ref UC-003, no title
    expect(note).toContain("# UC-003");
    expect(note).not.toContain("# \n"); // never a bare, blank heading
  });
  it("preserves the first body line when stripping a blank-title card's `# ` heading", () => {
    // A referenced card with no title emits a blank "# " heading; stripping it
    // must not consume the blank-line separator and the first real body line.
    const note = buildCardNote({ ...card, title: "", body: "First line.\nSecond line." });
    expect(parseCardNote(note, card.path)?.body).toBe("First line.\nSecond line.");
  });
  it("preserves meaningful body whitespace (indented code, blank lines) across build/parse", () => {
    const body = "    indented code\n\nfoo\n\n\ntrailing blanks\n";
    const parsed = parseCardNote(buildCardNote({ ...card, body }), card.path);
    expect(parsed?.body).toBe(body);
  });
  it("rejects a non-card note and falls back an out-of-set card_type", () => {
    expect(parseCardNote("---\ntype: note\n---\n", card.path)).toBeNull();
    const bad = buildCardNote(card).replace("card_type: task", "card_type: epic");
    expect(parseCardNote(bad, card.path)?.cardType).toBe("task");
  });
  it("rejects a card id that is not SMC-NNN (unsafe file name / path traversal)", () => {
    // The id becomes the card's file name; a hand-edited `/` or `..` would escape
    // cards/ or throw in joinVaultPath, so an invalid id makes the note unparsable.
    for (const badId of ["../evil", "SMC-1/x", "SMC-01", "nope"]) {
      const note = buildCardNote(card).replace("id: SMC-001", `id: ${badId}`);
      expect(parseCardNote(note, card.path)).toBeNull();
    }
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
